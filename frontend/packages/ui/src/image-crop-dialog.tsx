import {useEffect, useState} from 'react'
import Cropper, {type Area, type Point} from 'react-easy-crop'
import {Button} from './button'
import {Dialog, DialogContent, DialogTitle} from './components/dialog'
import {cropImageFile, type CropFormat, type CropState} from './image-crop'
import {SizableText} from './text'

export type ImageCropDialogInput = {
  file: File
  /** Width/height ratio the selection is locked to. */
  aspect: number
  /** `round` previews the selection as a circle, for avatars and icons. */
  cropShape?: 'rect' | 'round'
  /** Longest edge of the exported image, in pixels. */
  maxDimension: number
  /** Overrides the encoding chosen from the source's type. */
  format?: CropFormat
  /** Framing to restore, so reopening continues from the last crop. */
  initialCrop?: CropState
  /** Receives the exported image and the framing that produced it. */
  onCropped: (result: {file: File; crop: CropState}) => void
}

const MIN_ZOOM = 1
const MAX_ZOOM = 4

/**
 * Crop dialog, controlled by input. Pass a request to open it and null to close.
 */
export function ImageCropDialog({input, onClose}: {input: ImageCropDialogInput | null; onClose: () => void}) {
  return (
    <Dialog
      open={!!input}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      {/* DialogContent drops its default sizing whenever a className is given,
          so the width has to be restated here in full. */}
      <DialogContent className="max-h-[calc(100dvh-4rem)] w-full max-w-3xl">
        {input ? <ImageCropForm input={input} onClose={onClose} /> : null}
      </DialogContent>
    </Dialog>
  )
}

function ImageCropForm({input, onClose}: {input: ImageCropDialogInput; onClose: () => void}) {
  // Created inside the effect rather than in a memo: React's development double
  // mount runs the cleanup once before settling, and a memoised URL would stay
  // revoked, leaving the cropper loading a dead blob.
  const [imageUrl, setImageUrl] = useState('')
  useEffect(() => {
    const url = URL.createObjectURL(input.file)
    setImageUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [input.file])

  const [crop, setCrop] = useState<Point>({x: input.initialCrop?.x ?? 0, y: input.initialCrop?.y ?? 0})
  const [zoom, setZoom] = useState(input.initialCrop?.zoom ?? MIN_ZOOM)
  const [selection, setSelection] = useState<Area | null>(null)
  const [isExporting, setIsExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function applyCrop() {
    if (!selection) return
    setIsExporting(true)
    setError(null)
    try {
      const file = await cropImageFile(input.file, selection, {
        maxDimension: input.maxDimension,
        format: input.format,
      })
      input.onCropped({file, crop: {x: crop.x, y: crop.y, zoom}})
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not crop this image')
      setIsExporting(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <DialogTitle>Crop image</DialogTitle>
      <div className="bg-muted relative h-[26rem] max-h-[60vh] w-full overflow-hidden rounded-md">
        {imageUrl ? (
          <Cropper
            image={imageUrl}
            crop={crop}
            zoom={zoom}
            aspect={input.aspect}
            cropShape={input.cropShape ?? 'rect'}
            showGrid={input.cropShape !== 'round'}
            minZoom={MIN_ZOOM}
            maxZoom={MAX_ZOOM}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={(_area, areaPixels) => setSelection(areaPixels)}
          />
        ) : null}
      </div>
      <div className="flex items-center gap-3">
        <SizableText size="xs" className="text-muted-foreground">
          Zoom
        </SizableText>
        <input
          type="range"
          aria-label="Zoom"
          min={MIN_ZOOM}
          max={MAX_ZOOM}
          step={0.01}
          value={zoom}
          onChange={(event) => setZoom(Number(event.target.value))}
          className="accent-primary h-1 flex-1 cursor-pointer"
        />
      </div>
      {error ? (
        <SizableText size="xs" className="text-destructive">
          {error}
        </SizableText>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose} disabled={isExporting}>
          Cancel
        </Button>
        <Button variant="default" onClick={() => void applyCrop()} disabled={isExporting || !selection}>
          {isExporting ? 'Applying…' : 'Apply'}
        </Button>
      </div>
    </div>
  )
}

/** The parts of a crop request that a field decides up front. */
export type ImageCropConfig = Pick<ImageCropDialogInput, 'aspect' | 'cropShape' | 'maxDimension' | 'format'>

/**
 * Adds "choose a file, frame it, hand back the result" to a component that owns
 * a file input, so the several image pickers in the app can share one cropper.
 */
export function useImageCropper({crop, onCropped}: {crop?: ImageCropConfig; onCropped: (file: File) => void}) {
  const [request, setRequest] = useState<ImageCropDialogInput | null>(null)
  // The file as chosen. Kept so the framing can be revisited against the whole
  // picture instead of against an already cropped copy of it.
  const [source, setSource] = useState<File | null>(null)
  const [lastCrop, setLastCrop] = useState<CropState | undefined>(undefined)

  function open(file: File, initialCrop?: CropState) {
    if (!crop) return
    setRequest({
      ...crop,
      file,
      initialCrop,
      onCropped: ({file: cropped, crop: applied}) => {
        setLastCrop(applied)
        onCropped(cropped)
      },
    })
  }

  return {
    // Hands a freshly chosen file to the cropper.
    pick(file: File) {
      if (!crop) return false
      setSource(file)
      setLastCrop(undefined)
      open(file)
      return true
    },
    source: crop ? source : null,
    // Reopens the cropper on the kept original, restoring the last framing.
    reopen() {
      if (source) open(source, lastCrop)
    },
    // Clears the kept original, for when the image is removed.
    clear() {
      setSource(null)
      setLastCrop(undefined)
    },
    // Dialot to render in a component for the cropper to appear.
    dialog: <ImageCropDialog input={request} onClose={() => setRequest(null)} />,
  }
}
