import {fileUpload} from '@/utils/file-upload'
import {UIAvatar} from '@shm/ui/avatar'
import {Button} from '@shm/ui/button'
import {SizableText} from '@shm/ui/text'
import {Tooltip} from '@shm/ui/tooltip'
import {X} from 'lucide-react'
import {ChangeEvent} from 'react'

export function IconForm({
  url,
  label,
  id,
  size = 140,
  onIconUpload,
  onRemoveIcon,
  emptyLabel,
  marginTop,
  borderRadius = size,
  ...props
}: {
  label?: string
  url: string
  id?: string
  emptyLabel?: string
  size?: number
  marginTop?: number
  borderRadius?: number
  onIconUpload?: (avatar: string) => Awaited<void>
  onRemoveIcon?: () => void
}) {
  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    event.stopPropagation()
    const fileList = event.target.files
    const file = fileList?.[0]
    if (!file) return
    if (!onIconUpload) return
    fileUpload(file)
      .then((data) => {
        onIconUpload(data)
      })
      .catch((error) => {
        console.error(`Failed to upload icon: ${error.message}`, error)
      })
      .finally(() => {
        event.target.value = ''
      })
  }

  const iconImage = (
    <UIAvatar label={label} id={id} url={url} size={size} color="$brand12" />
  )
  if (!onIconUpload) return iconImage
  return (
    <div
      className="group flex w-auto items-end gap-2 self-start"
      data-group="icon"
    >
      <div
        className="relative overflow-hidden"
        style={{
          marginTop,
          width: size,
          height: size,
          borderRadius,
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
            right: 0,
            top: 0,
            bottom: 0,
            zIndex: 100,
          }}
        />
        {emptyLabel && !url ? (
          <div
            className="pointer-events-none absolute flex h-full w-full items-center justify-center gap-2 bg-black/30 opacity-100 group-hover:opacity-0"
            style={{zIndex: 5}}
          >
            <SizableText size="xs" className="text-center text-white">
              {emptyLabel}
            </SizableText>
          </div>
        ) : null}
        <div
          className="pointer-events-none absolute flex h-full w-full items-center justify-center gap-2 bg-black/30 opacity-0 group-hover:opacity-100"
          style={{zIndex: 5}}
        >
          <SizableText size="xs" className="text-center text-white">
            {url ? 'UPDATE' : emptyLabel || 'ADD ICON'}
          </SizableText>
        </div>
        {iconImage}
      </div>
      {onRemoveIcon && url ? (
        <Tooltip content="Remove Icon">
          <Button
            className="opacity-0 group-hover:pointer-events-auto group-hover:opacity-100"
            variant="destructive"
            size="sm"
            style={{zIndex: 5}}
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onRemoveIcon()
            }}
          >
            <X className="size-3" />
          </Button>
        </Tooltip>
      ) : null}
    </div>
  )
}
