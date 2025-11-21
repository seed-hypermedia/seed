import {copyUrlToClipboardWithFeedback} from '@shm/ui/copy-to-clipboard'
import {Link} from '@shm/ui/icons'
import {HMBlockSchema} from '../../../../../../schema'
import {DragHandleMenuProps} from '../DragHandleMenu'
import {DragHandleMenuItem} from '../DragHandleMenuItem'

export function CopyLinkToBlockButton<BSchema extends HMBlockSchema>({
  block,
  editor,
}: DragHandleMenuProps<BSchema>) {
  const url = editor.getResourceUrl?.(block.id)
  if (!url) return null
  return (
    <DragHandleMenuItem
      onClick={() => {
        copyUrlToClipboardWithFeedback(url, 'Block')
      }}
    >
      <div className="flex gap-2">
        <Link size={14} />
        Copy link to Block
      </div>
    </DragHandleMenuItem>
  )
}
