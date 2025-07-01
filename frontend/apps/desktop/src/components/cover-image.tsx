import {fileUpload} from '@/utils/file-upload'
import {Button} from '@shm/ui/button'
import {Tooltip} from '@shm/ui/tooltip'
import {cn} from '@shm/ui/utils'
import {Trash} from 'lucide-react'
import {ChangeEvent} from 'react'
import appError from '../errors'

export function CoverImage({
  url,
  label,
  showOutline = true,
  show = true,
  onCoverUpload,
  onRemoveCover,
}: {
  label?: string
  url?: string
  showOutline?: boolean
  show: boolean
  onCoverUpload?: (avatar: string) => void
  onRemoveCover?: () => void
}) {
  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const fileList = event.target.files
    const file = fileList?.[0]
    if (!file || !onCoverUpload) return
    fileUpload(file)
      .then((data) => {
        onCoverUpload(data)
      })
      .catch((error) => {
        appError(`Failed to upload avatar: ${e.message}`, {error})
      })
      .finally(() => {
        event.target.value = ''
      })
  }

  const coverImage = (
    <div
      className={cn(
        'relative h-0 w-full bg-transparent opacity-0 transition-all duration-300',
        show && 'h-[25vh] opacity-100',
        url && 'bg-secondary',
      )}
    >
      {url ? (
        <img
          src={url}
          title={label}
          style={{
            width: '100%',
            height: '100%',
            position: 'absolute',
            top: 0,
            left: 0,
            objectFit: 'cover',
          }}
        />
      ) : null}
    </div>
  )
  if (!onCoverUpload) return coverImage
  return (
    <div className="group">
      {show ? (
        <div className="absolute top-0 right-0 left-0 z-10 w-full">
          {showOutline ? <div /> : null}
          <div className="px-2">
            <div className="flex items-center justify-end gap-2 px-4 pt-6 opacity-0 group-hover:opacity-100">
              <div className="relative flex items-center justify-center">
                <input
                  type="file"
                  onChange={handleFileChange}
                  style={{
                    height: '100%',
                    opacity: 0,
                    display: 'flex',
                    position: 'absolute',
                    left: 0,
                    right: -12,
                    top: 0,
                    zIndex: 100,
                    backgroundColor: '#666666',
                  }}
                />
                <Button variant="ghost" className="bg-background">{`${
                  url ? 'CHANGE' : 'ADD'
                } COVER`}</Button>
              </div>
              <Tooltip content="Remove Cover image">
                <Button variant="destructive" onClick={onRemoveCover}>
                  <Trash className="size-4" />
                </Button>
              </Tooltip>
            </div>
          </div>
        </div>
      ) : null}
      {coverImage}
    </div>
  )
}
