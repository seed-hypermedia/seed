import type {HMMetadata, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {Image as ImageIcon, Plus} from 'lucide-react'
import {useEffect, useState, type ReactNode} from 'react'
import {UIAvatar} from './avatar'
import {Button} from './button'
import {Input} from './components/input'
import {useImageUrl} from './get-file-url'
import type {ImageCropConfig} from './image-crop-dialog'
import {ImageForm} from './image-form'
import {
  AVATAR_IMAGE_POLICY,
  CONTENT_IMAGE_POLICY,
  COVER_IMAGE_POLICY,
  type ImageProcessingPolicy,
} from './image-processing'
import {useReportDirty, type SpaceHomeUpdater} from './space-settings'
import {SizableText} from './text'
import {toast} from './toast'

/** A picked image is either an existing metadata value or a freshly selected file. */
type ImageValue = string | File | null

/** The identity tab of space settings */
export function SpaceSettingsIdentity({
  siteId,
  metadata,
  updateHome,
  uploadImage,
  onDirtyChange,
}: {
  siteId: UnpackedHypermediaId
  metadata: HMMetadata
  updateHome: SpaceHomeUpdater
  uploadImage: (file: File, policy: ImageProcessingPolicy) => Promise<string>
  onDirtyChange: (isDirty: boolean) => void
}) {
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

  /** Upload a picked file and return its ipfs ref, or pass through an existing ref. */
  async function resolveImageValue(value: ImageValue, policy: ImageProcessingPolicy): Promise<string> {
    return value instanceof File ? `ipfs://${await uploadImage(value, policy)}` : value ?? ''
  }

  async function handleSave() {
    if (!canSave) return
    try {
      const changes: Partial<HMMetadata> = {}
      if (name !== null) changes.name = nameValue.trim()
      if (logo !== undefined) changes.seedExperimentalLogo = await resolveImageValue(logo, CONTENT_IMAGE_POLICY)
      if (favicon !== undefined) changes.icon = await resolveImageValue(favicon, AVATAR_IMAGE_POLICY)
      if (cover !== undefined) changes.cover = await resolveImageValue(cover, COVER_IMAGE_POLICY)
      await updateHome.mutateAsync({updateMetadata: (current) => ({...current, ...changes})})
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
        <Input
          id="space-settings-name"
          aria-label="Space name"
          value={nameValue}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your space name"
        />
      </SettingsField>

      <SettingsField label="Space logo">
        <div className="flex flex-wrap gap-4">
          <div className="w-56 shrink-0">
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
  const imageUrl = useImageUrl()
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
  return value instanceof File ? pickedUrl : value ? imageUrl(value) : ''
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
