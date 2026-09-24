import {Crop, X} from 'lucide-react'
import {ChangeEvent, ReactNode, useState} from 'react'
import {Button} from './button'
import type {CropState} from './image-crop'
import {ImageCropDialog, type ImageCropDialogInput} from './image-crop-dialog'
import {SizableText} from './text'
import {cn} from './utils'

/** Props for the ImageForm component. */
export interface ImageFormProps {
  label?: string
  emptyLabel?: string
  suggestedSize?: string
  id?: string
  url?: string
  uploadOnChange?: boolean
  height?: number
  width?: number
  emptyContent?: ReactNode
  /**
   * Enables cropping. Choosing a file opens the cropper rather than accepting
   * the image as-is, and only the cropped result reaches onImageUpload.
   */
  crop?: Pick<ImageCropDialogInput, 'aspect' | 'cropShape' | 'maxDimension' | 'format'>
  /**
   * Optional async function that uploads a File and resolves to its URL.
   * When omitted and `uploadOnChange` is true, the upload step is skipped.
   */
  fileUpload?: (file: File) => Promise<string>
  onImageUpload?: (avatar: string | File) => Awaited<void>
  onRemove?: () => void
}

/**
 * Form control for selecting, previewing, and optionally uploading an image.
 * Renders an image preview when `url` is set, and an overlaid file input for
 * picking a replacement. Pass `fileUpload` to have the selected file uploaded
 * automatically when `uploadOnChange` is true; omit it to receive the raw File
 * via `onImageUpload` instead.
 */
export function ImageForm({
  url,
  label,
  id,
  onImageUpload,
  onRemove,
  emptyLabel,
  suggestedSize = '1920px x 1080px',
  uploadOnChange = true,
  height,
  width,
  fileUpload,
  emptyContent,
  crop,
  ...props
}: ImageFormProps) {
  const [cropRequest, setCropRequest] = useState<ImageCropDialogInput | null>(null)
  // The image as chosen, before cropping. Held so reopening the cropper shows
  // the whole picture again rather than the already-cropped result.
  const [cropSource, setCropSource] = useState<File | null>(null)
  const [cropState, setCropState] = useState<CropState | undefined>(undefined)

  const deliver = (file: File, resetInput?: () => void) => {
    if (!onImageUpload) return
    if (uploadOnChange) {
      if (!fileUpload) return
      fileUpload(file)
        .then((data) => {
          onImageUpload(data)
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error)
          console.error(`Failed to upload icon: ${message}`, error)
        })
        .finally(() => {
          resetInput?.()
        })
    } else {
      onImageUpload(file)
    }
  }

  const openCropper = (source: File, initialCrop?: CropState) => {
    if (!crop) return
    setCropRequest({
      ...crop,
      file: source,
      initialCrop,
      onCropped: ({file, crop: appliedCrop}) => {
        setCropState(appliedCrop)
        deliver(file)
      },
    })
  }

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    event.stopPropagation()
    const fileList = event.target.files
    const file = fileList?.[0]
    if (!file) return
    if (!onImageUpload) return

    if (crop) {
      event.target.value = ''
      setCropSource(file)
      setCropState(undefined)
      openCropper(file)
      return
    }
    deliver(file, () => {
      event.target.value = ''
    })
  }

  const image = url ? (
    <div className="bg-muted flex-1 overflow-hidden rounded-md">
      <img
        alt="Image preview"
        src={url}
        key={url}
        style={{
          width: '100%',
          height: '100%',
          position: 'absolute',
          top: 0,
          left: 0,
          objectFit: 'cover',
        }}
      />
    </div>
  ) : null

  if (!onImageUpload) return image

  return (
    <div
      className="group group-icon relative flex w-auto items-end self-stretch overflow-hidden rounded-md"
      style={width ? {width, flex: 'none'} : undefined}
    >
      <div
        className="relative w-full self-stretch overflow-hidden"
        style={{
          minHeight: height || 60,
        }}
        {...props}
      >
        <input
          type="file"
          onChange={handleFileChange}
          style={{
            opacity: 0,
            display: 'flex',
            position: 'absolute',
            left: 0,
            backgroundColor: 'blue',
            right: 0,
            top: 0,
            bottom: 0,
            zIndex: 20,
            cursor: 'pointer',
          }}
        />
        {emptyLabel && !url && !emptyContent ? (
          <div className="bg-muted pointer-events-none absolute z-50 h-full items-center justify-center gap-2 opacity-100">
            <SizableText size="xs" className="text-muted-foreground text-center">
              {emptyLabel}
            </SizableText>
          </div>
        ) : null}

        {image || (
          <div className="bg-muted border-border group-hover:border-muted-foreground/50 group-focus-within:border-muted-foreground/50 group-hover:bg-muted/70 pointer-events-none absolute z-50 flex h-full w-full flex-col items-center justify-center gap-0 rounded-md border border-dashed opacity-100 transition-colors">
            {emptyContent ?? (
              <>
                <SizableText size="xs" weight="bold" className="text-muted-foreground text-center">
                  {url ? 'Update Cover' : emptyLabel || 'Add Cover'}
                </SizableText>
                <SizableText size="xs" className="text-muted-foreground text-center">
                  {suggestedSize}
                </SizableText>
              </>
            )}
          </div>
        )}
      </div>
      {crop && cropSource && url ? (
        <Button
          size="icon"
          aria-label="Adjust crop"
          className={cn('absolute top-0 z-50 opacity-0 group-hover:opacity-100', onRemove ? 'right-8' : 'right-0')}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            openCropper(cropSource, cropState)
          }}
        >
          <Crop className="size-3" />
        </Button>
      ) : null}
      {onRemove && url ? (
        <Button
          size="icon"
          className="grouo-hover:pointer-events-all absolute top-0 right-0 z-50 opacity-0 group-hover:opacity-100"
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            setCropSource(null)
            setCropState(undefined)
            onRemove()
          }}
        >
          <X className="size-3" />
        </Button>
      ) : null}
      <ImageCropDialog input={cropRequest} onClose={() => setCropRequest(null)} />
    </div>
  )
}
