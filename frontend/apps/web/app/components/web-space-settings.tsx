import {useLocalKeyPair, useLocalKeyPairLoaded} from '@/auth'
import {makeWebFileUpload} from '@/document-edit/web-image-upload'
import {useUpdateHomeDocument} from '@/models/site'
import {hmId, useUniversalClient} from '@shm/shared'
import {useResource} from '@shm/shared/models/entity'
import {useNavigate} from '@shm/shared/utils/navigation'
import {Button} from '@shm/ui/button'
import {ScrollArea} from '@shm/ui/components/scroll-area'
import type {ImageProcessingPolicy} from '@shm/ui/image-processing'
import {
  DiscardChangesDialog,
  SpaceSettingsBackLink,
  SpaceSettingsGeneralTab,
  SpaceSettingsNav,
} from '@shm/ui/space-settings'
import {SpaceSettingsIdentity} from '@shm/ui/space-settings-identity'
import {SpaceSettingsNavigation} from '@shm/ui/space-settings-navigation'
import {Spinner} from '@shm/ui/spinner'
import {cn} from '@shm/ui/utils'
import {ArrowLeft, Globe, Image as ImageIcon, MonitorCog, Navigation as NavigationIcon} from 'lucide-react'
import {useEffect, useMemo, useState} from 'react'
import {WebDomainSettings} from './web-hosting'

const SETTINGS_SECTIONS = [
  {key: 'general', label: 'General', icon: MonitorCog},
  {key: 'identity', label: 'Identity', icon: ImageIcon},
  {key: 'navigation', label: 'Navigation', icon: NavigationIcon},
  {key: 'web-domain', label: 'Web Domain', icon: Globe},
] as const

/** Full-page browser settings use the desktop master/detail layout and owner delegation. */
export function WebSpaceSettingsPage({
  siteUid,
  section,
}: {
  siteUid: string
  section?: 'general' | 'identity' | 'navigation' | 'web-domain'
}) {
  const identity = useLocalKeyPair()
  const identityLoaded = useLocalKeyPairLoaded()
  const navigate = useNavigate()
  const siteId = useMemo(() => hmId(siteUid, {latest: true}), [siteUid])
  const resource = useResource(siteId)
  const document = resource.data?.type === 'document' ? resource.data.document : undefined
  // Ownership follows the delegated account, independent of the site serving this page.
  const canManage = identity?.delegatedAccountUid === siteId.uid && !!identity?.capabilityCid
  const activeSection = section ?? 'general'
  const updateHome = useUpdateHomeDocument(siteId.uid)
  const client = useUniversalClient()
  const uploadImage = useMemo(
    () => (file: File, policy: ImageProcessingPolicy) => makeWebFileUpload(client, policy)(file),
    [client],
  )
  // Whether the open tab has unsaved edits.
  const [isDirty, setIsDirty] = useState(false)
  const [pendingDiscard, setPendingDiscard] = useState<(() => void) | null>(null)
  // Leaving a tab drops its edits, so show confirm discard dialog.
  const leave = (action: () => void) => (isDirty ? setPendingDiscard(() => action) : action())

  // Fix mobile keyboard scrolling the settings page and not scrolling back.
  useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) return
    const resetWindowScroll = () => {
      const isKeyboardOpen = window.innerHeight - viewport.height > 150
      if (!isKeyboardOpen && window.scrollY) window.scrollTo(0, 0)
    }
    viewport.addEventListener('resize', resetWindowScroll)
    return () => viewport.removeEventListener('resize', resetWindowScroll)
  }, [])

  return (
    <div className="bg-panel flex h-full min-h-0 w-full overflow-hidden">
      <SpaceSettingsNav
        tabs={SETTINGS_SECTIONS}
        activeTab={activeSection}
        onSelect={(tab) => leave(() => navigate({key: 'site-settings', id: siteId, tab}))}
        className={cn(
          'border-border w-full shrink-0 overflow-y-auto sm:flex sm:w-[220px] sm:border-r',
          section && 'hidden',
        )}
      >
        <SpaceSettingsBackLink
          className="px-3 py-2 sm:hidden"
          onClick={() => leave(() => navigate({key: 'document', id: siteId}))}
        />
      </SpaceSettingsNav>
      <ScrollArea className={cn('min-w-0 flex-1 sm:block', section ? 'block' : 'hidden')}>
        <div className="flex flex-col gap-6 p-4 sm:p-6">
          <Button
            variant="ghost"
            className="self-start sm:hidden"
            onClick={() => leave(() => navigate({key: 'site-settings', id: siteId}))}
          >
            <ArrowLeft className="size-4" />
            Space Settings
          </Button>
          <SpaceSettingsBackLink
            className="hidden sm:flex"
            onClick={() => leave(() => navigate({key: 'document', id: siteId}))}
          />
          {!identityLoaded ? (
            <div role="status" aria-label="Loading account" className="flex justify-center py-10">
              <Spinner />
            </div>
          ) : !canManage ? (
            <p className="text-muted-foreground">Sign in as the space owner to change these settings.</p>
          ) : resource.isInitialLoading ? (
            <div className="flex justify-center py-10">
              <Spinner />
            </div>
          ) : !document ? (
            <div className="flex flex-col gap-3">
              <p role="alert">
                {resource.isError ? 'Could not load your space.' : 'Publish your space before changing its settings.'}
              </p>
              {resource.isError ? <Button onClick={() => resource.refetch()}>Retry</Button> : null}
            </div>
          ) : (
            <div
              key={`${siteId.uid}:${identity?.id}:${identity?.capabilityCid}:${activeSection}`}
              className="flex flex-col gap-6"
            >
              {activeSection === 'general' && (
                <SpaceSettingsGeneralTab siteId={siteId} updateHome={updateHome} onDirtyChange={setIsDirty} />
              )}
              {activeSection === 'identity' && (
                <SpaceSettingsIdentity
                  siteId={siteId}
                  metadata={document.metadata}
                  updateHome={updateHome}
                  uploadImage={uploadImage}
                  onDirtyChange={setIsDirty}
                />
              )}
              {activeSection === 'navigation' && (
                <SpaceSettingsNavigation
                  siteId={siteId}
                  document={document}
                  updateHome={updateHome}
                  onDirtyChange={setIsDirty}
                />
              )}
              {activeSection === 'web-domain' && <WebDomainSettings siteId={siteId} page />}
            </div>
          )}
        </div>
      </ScrollArea>
      <DiscardChangesDialog onDiscard={pendingDiscard} onCancel={() => setPendingDiscard(null)} />
    </div>
  )
}
