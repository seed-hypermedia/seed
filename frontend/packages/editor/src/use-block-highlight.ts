import {useEffect, useMemo} from 'react'
import type {BlockNoteEditor} from './blocknote'
import {blockHighlightPluginKey} from './blocknote/core/extensions/BlockHighlight/BlockHighlightPlugin'
import type {HMBlockSchema} from './schema'
import type {DocumentContentProps} from '@shm/shared/document-content-props'

export function useBlockHighlight({
  editor,
  focusBlockId,
  focusBlockRange,
}: {
  editor: BlockNoteEditor<HMBlockSchema>
  focusBlockId?: string
  focusBlockRange?: DocumentContentProps['focusBlockRange']
}) {
  const rangeStart = useMemo(() => {
    return focusBlockRange && 'start' in focusBlockRange ? focusBlockRange.start : null
  }, [focusBlockRange])
  const rangeEnd = useMemo(() => {
    return focusBlockRange && 'end' in focusBlockRange ? focusBlockRange.end : null
  }, [focusBlockRange])

  useEffect(() => {
    const view = editor._tiptapEditor?.view
    if (!view) return

    if (focusBlockId && rangeStart != null && rangeEnd != null) {
      view.dispatch(
        view.state.tr.setMeta(blockHighlightPluginKey, {
          type: 'rangeFocus',
          blockId: focusBlockId,
          start: rangeStart,
          end: rangeEnd,
        }),
      )
    } else if (focusBlockId) {
      view.dispatch(view.state.tr.setMeta(blockHighlightPluginKey, {type: 'focus', blockId: focusBlockId}))
    } else {
      view.dispatch(view.state.tr.setMeta(blockHighlightPluginKey, {type: 'clear'}))
    }
  }, [editor, focusBlockId, rangeStart, rangeEnd])
}
