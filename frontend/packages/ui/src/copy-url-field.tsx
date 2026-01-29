import {useUniversalAppContext} from '@shm/shared/routing'
import {Button} from './button'
import {copyTextToClipboard} from './copy-to-clipboard'
import {Copy, ExternalLink} from './icons'
import {Text} from './text'
import {toast} from './toast'
import {Tooltip} from './tooltip'
import {cn} from './utils'

export function CopyUrlField({
  url,
  label,
  size = 'md',
}: {
  url: string
  label: string
  size?: 'sm' | 'md'
}) {
  const {openUrl} = useUniversalAppContext()
  return (
    <div
      className={cn(
        'flex items-center rounded-md border border-gray-200',
        size == 'md' ? 'gap-2 p-2.5' : 'gap-1 p-1',
      )}
    >
      <div className="flex-1 truncate overflow-hidden whitespace-nowrap">
        <Text size={size} color="muted">
          {url}
        </Text>
      </div>
      <Tooltip content="Copy URL">
        <Button
          variant="ghost"
          size={size == 'md' ? 'sm' : 'xs'}
          onClick={() => {
            copyTextToClipboard(url).then(() => {
              toast.success(`Copied ${label} URL`)
            })
          }}
        >
          <Copy className="size-4" />
        </Button>
      </Tooltip>
      <Tooltip content="Open URL">
        <Button
          onClick={() => openUrl(url)}
          variant="ghost"
          size={size == 'md' ? 'sm' : 'xs'}
        >
          <ExternalLink className="size-4" />
        </Button>
      </Tooltip>
    </div>
  )
}
