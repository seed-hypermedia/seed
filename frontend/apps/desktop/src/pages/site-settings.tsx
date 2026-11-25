import {MembersSettings} from '@/components/site-settings-members'
import {WebDomainSettings} from '@/components/site-settings-web-domain'
import {useUpdateHomeDocument} from '@/models/site'
import {fileUpload} from '@/utils/file-upload'
import {useNavigate} from '@/utils/useNavigate'
import type {HMDocument, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {hmId} from '@shm/shared'
import {useIsSiteOwner} from '@shm/shared/models/capabilities'
import {useResource} from '@shm/shared/models/entity'
import type {SiteSettingsTab} from '@shm/shared/routes'
import {
  findLastRouteInSpace,
  useNavigationDispatch,
  useNavigationState,
  useNavRoute,
} from '@shm/shared/utils/navigation'
import {UIAvatar} from '@shm/ui/avatar'
import {ScrollArea} from '@shm/ui/components/scroll-area'
import {panelContainerStyles, windowContainerStyles} from '@shm/ui/container'
import {
  DiscardChangesDialog,
  SpaceSettingsBackLink,
  SpaceSettingsGeneralTab,
  SpaceSettingsNav,
} from '@shm/ui/space-settings'
import {SpaceSettingsIdentity} from '@shm/ui/space-settings-identity'
import {SpaceSettingsNavigation} from '@shm/ui/space-settings-navigation'
import {Spinner} from '@shm/ui/spinner'
import {SizableText} from '@shm/ui/text'
import {cn} from '@shm/ui/utils'
import {Globe, Image as ImageIcon, MonitorCog, Navigation as NavigationIcon, Users, type LucideIcon} from 'lucide-react'
import {type ReactNode, useState} from 'react'

// Tabs of the site settings page
type SiteSettingsSection = 'general' | 'identity' | 'navigation' | 'web-domain' | 'members'

type SiteSettingsTabConfig = {
  key: SiteSettingsSection
  icon: LucideIcon
  label: string
}

const SITE_SETTINGS_TAB_CONFIG: SiteSettingsTabConfig[] = [
  {key: 'general', icon: MonitorCog, label: 'General'},
  {key: 'identity', icon: ImageIcon, label: 'Identity'},
  {key: 'navigation', icon: NavigationIcon, label: 'Navigation'},
  {key: 'web-domain', icon: Globe, label: 'Web Domain'},
  {key: 'members', icon: Users, label: 'Members'},
]

/** Map a URL subpath to its tab. */
function sectionForTab(tab: SiteSettingsTab | undefined): SiteSettingsSection {
  if (tab === 'identity') return 'identity'
  if (tab === 'navigation') return 'navigation'
  if (tab === 'web-domain') return 'web-domain'
  if (tab === 'members' || tab === 'writers' || tab === 'email-subscribers') return 'members'
  return 'general'
}

export default function SiteSettings() {
  const route = useNavRoute()
  const navigate = useNavigate('replace')
  const pushRoute = useNavigate('push')
  const navState = useNavigationState()
  const dispatch = useNavigationDispatch()
  // Whether the open tab has unsaved edits.
  const [isDirty, setIsDirty] = useState(false)
  const [pendingDiscard, setPendingDiscard] = useState<(() => void) | null>(null)
  if (route.key !== 'site-settings') return null
  const activeSection = sectionForTab(route.tab)
  // Leaving a tab drops its edits, so show confirm discard dialog.
  const leave = (action: () => void) => (isDirty ? setPendingDiscard(() => action) : action())
  const setActiveTab = (tab: SiteSettingsTab) => leave(() => navigate({key: 'site-settings', id: route.id, tab}))
  const backToSpace = () =>
    leave(() => {
      // Redirect back to where the user was in the space.
      const last = navState ? findLastRouteInSpace(navState, route.id.uid) : null
      if (last && last.index === navState!.routeIndex - 1) dispatch({type: 'pop'})
      else pushRoute(last?.route ?? {key: 'document', id: hmId(route.id.uid)})
    })
  return (
    <div className={cn(windowContainerStyles, 'h-full max-h-full min-h-0 w-full overflow-hidden pt-0')}>
      <div className={panelContainerStyles}>
        <div className="flex flex-1 overflow-hidden">
          <div className="flex flex-1 overflow-hidden rounded-lg">
            {/* Sidebar */}
            <SpaceSettingsNav
              tabs={SITE_SETTINGS_TAB_CONFIG}
              activeTab={activeSection}
              onSelect={setActiveTab}
              className="border-border w-[220px] shrink-0 border-r"
            />
            {/* Content */}
            <ScrollArea className="flex-1">
              <div className="flex flex-col gap-6 p-6">
                <SpaceSettingsBackLink onClick={backToSpace} />
                {activeSection === 'general' && (
                  <OwnerTab siteId={route.id} title="General">
                    {(_document, updateHome) => (
                      <SpaceSettingsGeneralTab siteId={route.id} updateHome={updateHome} onDirtyChange={setIsDirty} />
                    )}
                  </OwnerTab>
                )}
                {activeSection === 'identity' && (
                  <OwnerTab siteId={route.id} title="Identity">
                    {(document, updateHome) => (
                      <SpaceSettingsIdentity
                        siteId={route.id}
                        metadata={document.metadata}
                        updateHome={updateHome}
                        uploadImage={fileUpload}
                        onDirtyChange={setIsDirty}
                      />
                    )}
                  </OwnerTab>
                )}
                {activeSection === 'navigation' && (
                  <OwnerTab siteId={route.id} title="Navigation">
                    {(document, updateHome) => (
                      <SpaceSettingsNavigation
                        siteId={route.id}
                        document={document}
                        updateHome={updateHome}
                        onDirtyChange={setIsDirty}
                      />
                    )}
                  </OwnerTab>
                )}
                {activeSection === 'web-domain' && <WebDomainSettings siteId={route.id} />}
                {activeSection === 'members' && <MembersSettings siteId={route.id} activeTab={route.tab} />}
              </div>
            </ScrollArea>
          </div>
        </div>
      </div>
      <DiscardChangesDialog onDiscard={pendingDiscard} onCancel={() => setPendingDiscard(null)} />
    </div>
  )
}

/** Loads the home document and limits a tab to the space's owner. */
function OwnerTab({
  siteId,
  title,
  children,
}: {
  siteId: UnpackedHypermediaId
  title: string
  children: (document: HMDocument, updateHome: ReturnType<typeof useUpdateHomeDocument>) => ReactNode
}) {
  const resource = useResource(siteId)
  const document = resource.data?.type === 'document' ? resource.data.document : undefined
  const {isSiteOwner, isLoading: isOwnerLoading} = useIsSiteOwner(siteId.uid)
  const updateHome = useUpdateHomeDocument(siteId.uid)

  if (resource.isInitialLoading || isOwnerLoading) {
    return (
      <div className="flex justify-center py-10">
        <Spinner />
      </div>
    )
  }
  if (!document) {
    return <SizableText color="muted">This account doesn't have a space yet.</SizableText>
  }
  if (!isSiteOwner) {
    return (
      <>
        <SizableText size="2xl" weight="bold">
          {title}
        </SizableText>
        <SizableText color="muted">Only the space owner can edit these settings.</SizableText>
      </>
    )
  }
  return <>{children(document, updateHome)}</>
}
