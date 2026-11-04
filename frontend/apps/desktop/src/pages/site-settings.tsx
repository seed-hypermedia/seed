import {MembersSettings} from '@/components/site-settings-members'
import {NavigationSettings} from '@/components/site-settings-navigation'
import {WebDomainSettings} from '@/components/site-settings-web-domain'
import {useUpdateHomeDocument} from '@/models/site'
import {fileUpload} from '@/utils/file-upload'
import {useNavigate} from '@/utils/useNavigate'
import type {HMMetadata, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
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
import {Button} from '@shm/ui/button'
import {Input} from '@shm/ui/components/input'
import {ScrollArea} from '@shm/ui/components/scroll-area'
import {panelContainerStyles, windowContainerStyles} from '@shm/ui/container'
import {getDaemonFileUrl} from '@shm/ui/get-file-url'
import type {ImageCropConfig} from '@shm/ui/image-crop-dialog'
import {ImageForm} from '@shm/ui/image-form'
import {
  AVATAR_IMAGE_POLICY,
  CONTENT_IMAGE_POLICY,
  COVER_IMAGE_POLICY,
  type ImageProcessingPolicy,
} from '@shm/ui/image-processing'
import {DiscardChangesDialog, SpaceSettingsGeneral, useSpaceSettingsForm} from '@shm/ui/space-settings'
import {Spinner} from '@shm/ui/spinner'
import {SizableText} from '@shm/ui/text'
import {toast} from '@shm/ui/toast'
import {cn} from '@shm/ui/utils'
import {ArrowLeft, Globe, Image as ImageIcon, MonitorCog, Navigation as NavigationIcon, Plus, Users} from 'lucide-react'
import {type ReactNode, useEffect, useState} from 'react'

// Tabs of the site settings page
type SiteSettingsSection = 'general' | 'identity' | 'navigation' | 'web-domain' | 'members'

type SiteSettingsTabConfig = {
  key: SiteSettingsSection
  icon: any
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
            <div className="border-border flex w-[220px] shrink-0 flex-col gap-1 border-r p-2">
              <SizableText size="xs" weight="bold" color="muted" className="px-3 py-2 uppercase">
                Space Settings
              </SizableText>
              {SITE_SETTINGS_TAB_CONFIG.map((tab) => (
                <SidebarTab
                  key={tab.key}
                  active={activeSection === tab.key}
                  icon={tab.icon}
                  label={tab.label}
                  onClick={() => setActiveTab(tab.key)}
                />
              ))}
            </div>
            {/* Content */}
            <ScrollArea className="flex-1">
              <div className="flex flex-col gap-6 p-6">
                <button
                  type="button"
                  onClick={backToSpace}
                  className="text-muted-foreground hover:text-foreground flex items-center gap-1.5 self-start text-sm transition-colors"
                >
                  <ArrowLeft className="size-4" />
                  Back to space
                </button>
                {activeSection === 'general' && <GeneralTab siteId={route.id} onDirtyChange={setIsDirty} />}
                {activeSection === 'identity' && <IdentityTab siteId={route.id} onDirtyChange={setIsDirty} />}
                {activeSection === 'navigation' && <NavigationSettings siteId={route.id} onDirtyChange={setIsDirty} />}
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

function GeneralTab({
  siteId,
  onDirtyChange,
}: {
  siteId: UnpackedHypermediaId
  onDirtyChange: (isDirty: boolean) => void
}) {
  const {isSiteOwner, isLoading: isOwnerLoading} = useIsSiteOwner(siteId.uid)
  const form = useSpaceSettingsForm(siteId.uid)
  useReportDirty(form.isDirty, onDirtyChange)

  if (isOwnerLoading || !form.isReady) {
    return (
      <div className="flex justify-center py-10">
        <Spinner />
      </div>
    )
  }
  if (!isSiteOwner) {
    return (
      <>
        <SizableText size="2xl" weight="bold">
          General
        </SizableText>
        <SizableText color="muted">Only the space owner can edit these settings.</SizableText>
      </>
    )
  }
  return (
    <>
      <div className="flex items-center justify-between">
        <SizableText size="2xl" weight="bold">
          General
        </SizableText>
        <Button variant="default" disabled={!form.isDirty || form.isSaving} onClick={form.save}>
          {form.isSaving ? 'Saving…' : 'Save'}
        </Button>
      </div>
      <SpaceSettingsGeneral
        metadata={form.metadata}
        onMetadata={form.onMetadata}
        className="grid grid-cols-1 gap-3 lg:grid-cols-2"
      />
    </>
  )
}

/** Tells the page whether a tab has unsaved edits, and that it has none once it closes. */
function useReportDirty(isDirty: boolean, onDirtyChange: (isDirty: boolean) => void) {
  useEffect(() => {
    onDirtyChange(isDirty)
  }, [isDirty, onDirtyChange])
  useEffect(() => () => onDirtyChange(false), [onDirtyChange])
}

/** A picked image is either an existing metadata value or a freshly selected file. */
type ImageValue = string | File | null

function IdentityTab({
  siteId,
  onDirtyChange,
}: {
  siteId: UnpackedHypermediaId
  onDirtyChange: (isDirty: boolean) => void
}) {
  const accountUid = siteId.uid
  const resource = useResource(siteId)
  const document = resource.data?.type === 'document' ? resource.data.document : undefined
  const {isSiteOwner, isLoading: isOwnerLoading} = useIsSiteOwner(accountUid)
  const updateHome = useUpdateHomeDocument(accountUid)

  // Form state, seeded from the published metadata once loaded.
  const [name, setName] = useState<string | null>(null)
  const [logo, setLogo] = useState<ImageValue | undefined>(undefined)
  const [favicon, setFavicon] = useState<ImageValue | undefined>(undefined)
  const [cover, setCover] = useState<ImageValue | undefined>(undefined)
  const [logoProcessing, setLogoProcessing] = useState(false)
  const [faviconProcessing, setFaviconProcessing] = useState(false)
  const [coverProcessing, setCoverProcessing] = useState(false)
  const isDirty = name !== null || logo !== undefined || favicon !== undefined || cover !== undefined
  useReportDirty(isDirty, onDirtyChange)

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
          Identity
        </SizableText>
        <SizableText color="muted">Only the space owner can edit these settings.</SizableText>
      </>
    )
  }

  const metadata = document.metadata
  // Fall back to the published value until the field has been edited.
  const nameValue = name ?? metadata.name ?? ''
  const logoValue = logo === undefined ? metadata.seedExperimentalLogo || null : logo
  const faviconValue = favicon === undefined ? metadata.icon || null : favicon
  const coverValue = cover === undefined ? metadata.cover || null : cover

  const canSave =
    isDirty &&
    nameValue.trim().length > 0 &&
    !updateHome.isPending &&
    !logoProcessing &&
    !faviconProcessing &&
    !coverProcessing

  async function handleSave() {
    if (!canSave) return
    try {
      // Pass full desired metadata. The hook diffs against the published values.
      const nextMetadata: HMMetadata = {
        ...metadata,
        name: nameValue.trim(),
        seedExperimentalLogo:
          logo !== undefined ? await resolveImageValue(logo, CONTENT_IMAGE_POLICY) : metadata.seedExperimentalLogo,
        icon: favicon !== undefined ? await resolveImageValue(favicon, AVATAR_IMAGE_POLICY) : metadata.icon,
        cover: cover !== undefined ? await resolveImageValue(cover, COVER_IMAGE_POLICY) : metadata.cover,
      }
      await updateHome.mutateAsync({metadata: nextMetadata})
      toast.success('Space identity updated')
      setName(null)
      setLogo(undefined)
      setFavicon(undefined)
      setCover(undefined)
    } catch (error) {
      // Edits stay in place, so retrying sends the same changes again.
      toast.error(error instanceof Error ? error.message : 'Failed to update space identity', {
        action: {label: 'Retry', onClick: () => void handleSave()},
      })
    }
  }

  return (
    <>
      <div className="flex items-center justify-between">
        <SizableText size="2xl" weight="bold">
          Identity
        </SizableText>
        <Button variant="default" disabled={!canSave} onClick={handleSave}>
          {updateHome.isPending ? 'Saving…' : 'Save'}
        </Button>
      </div>

      <SettingsField label="Space name">
        <Input value={nameValue} onChange={(e) => setName(e.target.value)} placeholder="Your space name" />
      </SettingsField>

      <SettingsField label="Space logo">
        <div className="flex flex-wrap gap-4">
          <div className="w-56 shrink-0">
            {/* Logos keep their own proportions, so nothing is cropped or cut off. */}
            <ImagePicker
              value={logoValue}
              onProcessingChange={setLogoProcessing}
              onChange={setLogo}
              onClear={() => setLogo(null)}
              height={100}
              fit="contain"
              emptyContent={
                <div className="flex flex-col items-center gap-2">
                  {addImageMark}
                  <SizableText size="xs" color="muted">
                    100px height JPG or PNG.
                  </SizableText>
                </div>
              }
            />
          </div>
          <SpaceLogoPreview siteId={siteId} logo={logoValue} favicon={faviconValue} name={nameValue} />
        </div>
      </SettingsField>

      <SettingsField label="Favicon">
        <div className="flex items-center gap-4">
          <ImagePicker
            value={faviconValue}
            onProcessingChange={setFaviconProcessing}
            onChange={setFavicon}
            onClear={() => setFavicon(null)}
            height={100}
            width={100}
            crop={{aspect: 1, maxDimension: 512}}
            emptyContent={addImageMark}
          />
          <SizableText size="xs" color="muted">
            512 × 512px JPG or PNG.
          </SizableText>
        </div>
      </SettingsField>

      <SettingsField label="Cover image">
        <div className="max-w-2xl">
          <ImagePicker
            value={coverValue}
            onProcessingChange={setCoverProcessing}
            onChange={setCover}
            onClear={() => setCover(null)}
            height={160}
            crop={{aspect: 4, maxDimension: 1600, format: 'image/jpeg'}}
            emptyContent={
              <>
                <div className="bg-background absolute top-3 left-3 flex items-center gap-2 rounded-md px-2 py-1 shadow-xs">
                  <ImageIcon className="text-muted-foreground size-4" />
                  <SizableText size="sm" weight="medium" color="muted">
                    Cover image
                  </SizableText>
                  <SizableText size="xs" color="muted">
                    1600 × 400px
                  </SizableText>
                </div>
                {addImageMark}
              </>
            }
          />
        </div>
      </SettingsField>
    </>
  )
}

/* Green plus icon in the empty image box. */
const addImageMark = (
  <span className="bg-brand/20 text-brand flex size-8 items-center justify-center rounded-md">
    <Plus className="size-4" />
  </span>
)

/** Upload a picked file and return its ipfs ref, or pass through an existing ref. */
async function resolveImageValue(value: ImageValue, policy: ImageProcessingPolicy): Promise<string> {
  if (value instanceof File) {
    const cid = await fileUpload(value, policy)
    return `ipfs://${cid}`
  }
  return value ?? ''
}

function SettingsField({label, hint, children}: {label: string; hint?: string; children: ReactNode}) {
  return (
    <div className="flex flex-col gap-2">
      <SizableText weight="medium">{label}</SizableText>
      {children}
      {hint ? (
        <SizableText size="xs" color="muted">
          {hint}
        </SizableText>
      ) : null}
    </div>
  )
}

/** The address to show an image at, whether it is published or freshly picked. */
function useImageValueUrl(value: ImageValue) {
  // Created inside the effect so React's development double mount, which runs
  // the cleanup once before settling, cannot leave a revoked URL behind.
  const [pickedUrl, setPickedUrl] = useState('')
  useEffect(() => {
    if (!(value instanceof File)) {
      setPickedUrl('')
      return
    }
    const objectUrl = URL.createObjectURL(value)
    setPickedUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [value])
  return value instanceof File ? pickedUrl : value ? getDaemonFileUrl(value) : ''
}

/** Site header preview, with logo or favicon and name. */
function SpaceLogoPreview({
  siteId,
  logo,
  favicon,
  name,
}: {
  siteId: UnpackedHypermediaId
  logo: ImageValue
  favicon: ImageValue
  name: string
}) {
  const logoUrl = useImageValueUrl(logo)
  const faviconUrl = useImageValueUrl(favicon)
  return (
    <div className="flex min-w-64 flex-1 flex-col gap-1">
      <SizableText size="xs" color="muted">
        Preview
      </SizableText>
      <div className="border-border flex items-center rounded-md border py-2 pr-4 pl-2">
        {logoUrl ? (
          <img alt="Space logo preview" src={logoUrl} className="h-15 object-contain" />
        ) : (
          <div className="flex min-w-0 items-center gap-2">
            <UIAvatar
              size={24}
              id={siteId.id}
              label={name}
              url={faviconUrl || undefined}
              className="flex-none rounded-full bg-white"
            />
            <p className="text-foreground min-w-0 truncate font-bold select-none">{name}</p>
          </div>
        )}
      </div>
    </div>
  )
}

function ImagePicker({
  value,
  onProcessingChange,
  onChange,
  onClear,
  height,
  width,
  fit,
  crop,
  emptyContent,
}: {
  value: ImageValue
  onProcessingChange: (processing: boolean) => void
  onChange: (file: File) => void
  onClear: () => void
  height: number
  width?: number
  fit?: 'cover' | 'contain'
  crop?: ImageCropConfig
  emptyContent?: ReactNode
}) {
  const previewUrl = useImageValueUrl(value)
  return (
    <ImageForm
      url={previewUrl}
      height={height}
      width={width}
      fit={fit}
      emptyContent={emptyContent}
      uploadOnChange={false}
      crop={crop}
      onPendingChange={onProcessingChange}
      onImageUpload={(file) => {
        if (file instanceof File) onChange(file)
      }}
      onRemove={onClear}
    />
  )
}

function SidebarTab({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean
  icon: any
  label: string
  onClick: () => void
}) {
  return (
    <button
      className={cn(
        'flex items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm transition-colors',
        active ? 'bg-brand/10 text-brand-2 font-medium' : 'text-muted-foreground hover:bg-muted',
      )}
      onClick={onClick}
    >
      <Icon className="size-4" />
      {label}
    </button>
  )
}
