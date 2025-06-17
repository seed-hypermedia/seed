import {fileUpload} from '@/utils/file-upload'
import {Button} from '@shm/ui/components/button'
import {SizableText} from '@shm/ui/text'
import {X} from 'lucide-react'
import {ChangeEvent} from 'react'
import appError from '../errors'

export function ImageForm({
  url,
  label,
  id,
  onImageUpload,
  onRemove,
  emptyLabel,
  uploadOnChange = true,
  height,
  ...props
}: {
  label?: string
  emptyLabel?: string
  id?: string
  url?: string
  uploadOnChange?: boolean
  height?: number
  onImageUpload?: (avatar: string | File) => Awaited<void>
  onRemove?: () => void
}) {
  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    event.stopPropagation()
    const fileList = event.target.files
    const file = fileList?.[0]
    if (!file) return
    if (!onImageUpload) return

    if (uploadOnChange) {
      fileUpload(file)
        .then((data) => {
          onImageUpload(data)
        })
        .catch((error) => {
          appError(`Failed to upload icon: ${error.message}`, {error})
        })
        .finally(() => {
          event.target.value = ''
        })
    } else {
      // Just call onImageUpload with the file directly to handle it at the parent level
      onImageUpload(file)
    }
  }

  const image = url ? (
    <div className="bg-muted rounded-md flex-1 overflow-hidden">
      <img
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
    <div className="group relative flex items-end group-icon w-auto self-stretch rounded-md overflow-hidden">
      <div
        className="relative overflow-hidden self-stretch w-full"
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
          }}
        />
        {emptyLabel && !url ? (
          <div className="bg-muted absolute gap-2 z-50 h-full items-center justify-center pointer-events-none opacity-100">
            <SizableText size="xs" className="text-center">
              {emptyLabel}
            </SizableText>
          </div>
        ) : null}

        {image || (
          <div className="bg-muted border border-border absolute gap-0 z-50 h-full flex flex-col items-center justify-center pointer-events-none opacity-100 rounded-md w-full">
            <SizableText size="xs" weight="bold" className="text-center">
              {url ? 'Update Cover' : emptyLabel || 'Add Cover'}
            </SizableText>
            <SizableText
              size="xs"
              className="text-center text-muted-foreground"
            >
              1920px x 1080px
            </SizableText>
          </div>
        )}
      </div>
      {onRemove && url ? (
        <Button
          size="icon"
          className="absolute z-50 right-0 top-0 opacity-0 group-hover:opacity-100 grouo-hover:pointer-events-all"
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onRemove()
          }}
        >
          <X className="size-3" />
        </Button>
      ) : null}
    </div>
  )
}
