import {useUniversalAppContext} from '@shm/shared/routing'
import {Copy, ExternalLink} from 'lucide-react'
import {useRef} from 'react'
import {Button} from './components/button'
import {copyTextToClipboard} from './copy-to-clipboard'
import {toast} from './toast'
import {Tooltip} from './tooltip'

export function CopyUrlField({url, label}: {url: string; label: string}) {
  const {openUrl} = useUniversalAppContext()
  const textRef = useRef<HTMLSpanElement>(null)

  return (
    <div className="flex border border-gray-300 dark:border-gray-600 rounded-md overflow-hidden">
      <div className="flex-1 flex items-center">
        <span
          onClick={(e) => {
            e.preventDefault()
            if (textRef.current) {
              const range = document.createRange()
              range.selectNode(textRef.current)
              window.getSelection()?.removeAllRanges()
              window.getSelection()?.addRange(range)
            }
          }}
          className="text-lg text-gray-700 dark:text-gray-300 mx-3 overflow-hidden whitespace-nowrap text-ellipsis cursor-pointer"
          ref={textRef}
        >
          {url}
        </span>
        <Tooltip content="Copy URL">
          <Button
            variant="ghost"
            size="sm"
            className="m-2"
            onClick={() => {
              copyTextToClipboard(url)
              toast(`Copied ${label} URL`)
            }}
          >
            <Copy size={16} />
          </Button>
        </Tooltip>
      </div>
      <div className="border-l border-gray-300 dark:border-gray-600">
        <Button
          variant="default"
          onClick={() => openUrl(url)}
          className="rounded-none h-full"
        >
          Open
          <ExternalLink size={16} />
        </Button>
      </div>
    </div>
  )
}
