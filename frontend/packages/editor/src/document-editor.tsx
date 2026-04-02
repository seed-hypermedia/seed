import '@/blocknote/core/style.css'
import '@/editor.css'

import {hmBlocksToEditorContent} from '@seed-hypermedia/client/hmblock-to-editorblock'
import type {DocumentContentProps} from '@shm/shared/document-content-props'
import {useOpenUrl} from '@shm/shared'
import {useImageUrl} from '@shm/ui/get-file-url'
import {useEffect, useMemo} from 'react'
import {
  BlockNoteView,
  BlockHoverActionsPositioner,
  FormattingToolbarPositioner,
  HyperlinkToolbarPositioner,
  ImageGalleryOverlay,
  LinkMenuPositioner,
  RangeSelectionPositioner,
  SlashMenuPositioner,
  SupernumbersController,
  useBlockNote,
} from './blocknote'
import {blockHighlightPluginKey} from './blocknote/core/extensions/BlockHighlight/BlockHighlightPlugin'
import {HMFormattingToolbar} from './hm-formatting-toolbar'
import {HypermediaLinkPreview} from './hm-link-preview'
import {hmBlockSchema, HMBlockSchema} from './schema'

export type {DocumentContentProps}

export function DocumentEditor({
  blocks,
  focusBlockId,
  blockCitations,
  onBlockCitationClick,
  onBlockCommentClick,
  onBlockSelect,
}: DocumentContentProps) {
  const openUrl = useOpenUrl()
  const getImageUrl = useImageUrl()

  const initialContent = useMemo(() => {
    const editorBlocks = hmBlocksToEditorContent(blocks, {childrenType: 'Group'})
    return editorBlocks.length > 0 ? editorBlocks : [{type: 'paragraph' as const, id: 'empty'}]
  }, [blocks])

  const editor = useBlockNote<HMBlockSchema>(
    {
      editable: false,
      renderType: 'document',
      blockSchema: hmBlockSchema,
      // @ts-expect-error - EditorBlock/PartialBlock type mismatch
      initialContent,
    },
    [initialContent],
  )

  // Dispatch block highlight when focusBlockId changes
  useEffect(() => {
    const view = editor._tiptapEditor?.view
    if (!view) return

    if (focusBlockId) {
      view.dispatch(view.state.tr.setMeta(blockHighlightPluginKey, {type: 'focus', blockId: focusBlockId}))
    } else {
      view.dispatch(view.state.tr.setMeta(blockHighlightPluginKey, {type: 'clear'}))
    }
  }, [editor, focusBlockId])

  const editable = editor.isEditable

  return (
    <BlockNoteView editor={editor}>
      {/* Editing-only positioners — gated behind isEditable, ready for Phase 4 */}
      {editable && (
        <>
          <FormattingToolbarPositioner editor={editor} formattingToolbar={HMFormattingToolbar} />
          <SlashMenuPositioner editor={editor} />
          <LinkMenuPositioner editor={editor} />
          <HyperlinkToolbarPositioner
            // @ts-expect-error
            hyperlinkToolbar={HypermediaLinkPreview}
            editor={editor}
            // @ts-expect-error
            openUrl={openUrl}
          />
        </>
      )}

      {/* Read-only extensions */}
      <ImageGalleryOverlay editor={editor} resolveImageUrl={getImageUrl} />
      <BlockHoverActionsPositioner
        editor={editor}
        onCopyBlockLink={onBlockCitationClick ? (blockId) => onBlockCitationClick(blockId) : undefined}
        onStartComment={onBlockCommentClick ? (blockId) => onBlockCommentClick(blockId, undefined, true) : undefined}
      />
      <RangeSelectionPositioner
        editor={editor}
        onCopyFragmentLink={
          onBlockSelect
            ? (blockId, rangeStart, rangeEnd) =>
                onBlockSelect(blockId, {start: rangeStart, end: rangeEnd, copyToClipboard: true})
            : undefined
        }
        onComment={
          onBlockCommentClick
            ? (blockId, rangeStart, rangeEnd) => onBlockCommentClick(blockId, {start: rangeStart, end: rangeEnd}, true)
            : undefined
        }
      />
      <SupernumbersController
        editor={editor}
        data={blockCitations ?? null}
        onSupernumberClick={onBlockCitationClick ? (blockId) => onBlockCitationClick(blockId) : undefined}
      />
    </BlockNoteView>
  )
}
