import {useUniversalAppContext} from '@shm/shared/routing'
import {Copy, ExternalLink} from '@tamagui/lucide-icons'
import {Button} from './button'
import {copyTextToClipboard} from './copy-to-clipboard'
import {Text} from './text'
import {toast} from './toast'
import {Tooltip} from './tooltip'

export function CopyUrlField({url, label}: {url: string; label: string}) {
  const {openUrl} = useUniversalAppContext()
  return (
    <div className="flex items-center rounded-md border border-gray-200 p-2">
      <div className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
        <Text color="muted">{url}</Text>
      </div>
      <Tooltip content="Copy URL">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            copyTextToClipboard(url).then(() => {
              toast.success(`Copied ${label} URL`)
            })
          }}
        >
          <Copy size={16} />
        </Button>
      </Tooltip>
      <Tooltip content="Open URL">
        <Button onClick={() => openUrl(url)} variant="ghost" size="sm">
          <ExternalLink size={16} />
        </Button>
      </Tooltip>
    </div>
  )
}
