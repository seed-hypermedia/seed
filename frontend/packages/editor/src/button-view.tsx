import {useOpenUrl} from '@shm/shared'
import {useEditorGate} from '@shm/shared/models/use-editor-gate'
import {Button} from '@shm/ui/button'
import {SizableText} from '@shm/ui/text'
import {cn} from '@shm/ui/utils'
import {useEffect, useState} from 'react'
import type {BlockNoteEditor} from './blocknote/core/BlockNoteEditor'
import type {Block} from './blocknote/core/extensions/Blocks/api/blockTypes'
import {useEditorSelectionChange} from './blocknote/react/hooks/useEditorSelectionChange'
import {updateSelection} from './media-render'
import type {HMBlockSchema} from './schema'

type ButtonAlignment = 'flex-start' | 'center' | 'flex-end'

/**
 * Mutable shape passed to `editor.updateBlock` when the button block's props
 * (url, name, alignment) change.
 */
export type ButtonType = {
  id: string
  props: {
    url: string
    name: string
    alignment?: string
  }
  children: []
  content: []
  type: string
}

/**
 * React view for the button block. Exported separately from
 * `createReactBlockSpec` so it can be unit-tested without pulling in the
 * (circular) full block-schema graph.
 *
 * In read-only mode (or when the user has edit permission but isn't currently
 * editing) clicking the button navigates to `block.props.url` via `useOpenUrl`.
 * In edit mode the click is a no-op so the block can be selected/focused.
 */
export function ButtonBlockView({
  block,
  editor,
}: {
  block: Block<HMBlockSchema>
  editor: BlockNoteEditor<HMBlockSchema>
}) {
  const [alignment, setAlignment] = useState<ButtonAlignment>(
    (block.props.alignment as ButtonAlignment) || 'flex-start',
  )
  const [, setSelected] = useState(false)
  const openUrl = useOpenUrl()
  const {canEdit, isEditing} = useEditorGate()

  // Navigate when the document is being viewed (read-only). In edit mode the
  // click should select/focus the block instead, mirroring `embed-block.tsx`.
  const navigateOnClick = !canEdit || !isEditing

  useEditorSelectionChange(editor, () => updateSelection(editor, block, setSelected))

  useEffect(() => {
    setAlignment(block.props.alignment as ButtonAlignment)
  }, [block.props.alignment])

  const url = block.props.url
  const handleClick = navigateOnClick && url ? () => openUrl(url) : undefined

  return (
    <div
      className="flex w-full max-w-full flex-col select-none"
      style={{
        justifyContent: alignment || 'flex-start',
      }}
      contentEditable={false}
    >
      <Button
        variant="brand"
        size="lg"
        className={cn(
          'w-auto max-w-full justify-center border-none border-transparent text-center select-none',
          alignment == 'center' ? 'self-center' : alignment == 'flex-end' ? 'self-end' : 'self-start',
        )}
        onClick={handleClick}
      >
        <SizableText size="lg" className="truncate text-center font-sans font-bold text-white">
          {block.props.name || 'Button Text'}
        </SizableText>
      </Button>
    </div>
  )
}
