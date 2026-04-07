import '@/blocknote/core/style.css'
import '@/editor.css'

import {hmBlocksToEditorContent} from '@seed-hypermedia/client/hmblock-to-editorblock'
import type {DocumentContentProps} from '@shm/shared/document-content-props'
import {useOpenUrl} from '@shm/shared'
import {
  selectCanEdit,
  selectIsEditing,
  useDocumentMachineRef,
  useDocumentSelector,
} from '@shm/shared/models/use-document-machine'
import {useImageUrl} from '@shm/ui/get-file-url'
import {useCallback, useEffect, useMemo, useRef} from 'react'
import {TextSelection} from 'prosemirror-state'
import {
  BlockNoteView,
  BlockHoverActionsPositioner,
  FormattingToolbarPositioner,
  HyperlinkToolbarPositioner,
  ImageGalleryOverlay,
  LinkMenuPositioner,
  RangeSelectionPositioner,
  SideMenuPositioner,
  SlashMenuPositioner,
  SupernumbersController,
  useBlockNote,
} from './blocknote'
import {blockHighlightPluginKey} from './blocknote/core/extensions/BlockHighlight/BlockHighlightPlugin'
import {HMFormattingToolbar} from './hm-formatting-toolbar'
import {HypermediaLinkPreview} from './hm-link-preview'
import {hmBlockSchema, HMBlockSchema} from './schema'

export type {DocumentContentProps}

/** Block types (data-content-type values) that trigger edit mode on click. */
const TEXT_BLOCK_TYPES = new Set(['paragraph', 'heading', 'code-block'])

/**
 * Walk up from `el` in the DOM looking for a `data-content-type` attribute.
 * Returns the value when found, or null if we reach `root` without finding one.
 */
function getContentTypeFromTarget(el: Element | null, root: Element): string | null {
  let node: Element | null = el
  while (node && node !== root) {
    const ct = node.getAttribute('data-content-type')
    if (ct !== null) return ct
    node = node.parentElement
  }
  return null
}

export function DocumentEditor({
  blocks,
  focusBlockId,
  blockCitations,
  onBlockCitationClick,
  onBlockCommentClick,
  onBlockSelect,
  onEditorReady,
  draftCursorPosition,
}: DocumentContentProps) {
  const openUrl = useOpenUrl()
  const getImageUrl = useImageUrl()
  const actorRef = useDocumentMachineRef()
  const canEdit = useDocumentSelector(selectCanEdit)
  const isEditing = useDocumentSelector(selectIsEditing)

  const canEditRef = useRef(canEdit)
  canEditRef.current = canEdit

  // Stores the ProseMirror position of the pending click so that when the
  // machine transitions to editing we can place the cursor there.
  const pendingClickPosRef = useRef<number | null>(null)

  // Track mousedown coords so we can distinguish a click from a drag.
  const mousedownCoordsRef = useRef<{x: number; y: number} | null>(null)

  const onEditStart = useCallback(() => {
    actorRef.send({type: 'edit.start'})
  }, [actorRef])

  // Suppress change events during programmatic content replacement
  // (e.g. when loading draft content on edit-mode entry).
  const suppressChangeRef = useRef(false)

  // Freeze blocks once editing starts so document query refetches don't
  // recreate the editor and lose the user's edits (or loaded draft content).
  const frozenBlocksRef = useRef<typeof blocks | null>(null)
  if (isEditing && !frozenBlocksRef.current) {
    frozenBlocksRef.current = blocks
    console.log('[DocumentEditor] frozenBlocksRef captured:', blocks?.length, 'blocks, isEditing:', isEditing)
  }
  if (!isEditing) {
    frozenBlocksRef.current = null
  }
  const effectiveBlocks = frozenBlocksRef.current ?? blocks

  console.log('[DocumentEditor] render:', {
    blocksCount: blocks?.length,
    frozenCount: frozenBlocksRef.current?.length,
    effectiveCount: effectiveBlocks?.length,
    isEditing,
    canEdit,
  })

  const initialContent = useMemo(() => {
    // Detect format: HMBlockNode has { block, children }, EditorBlock has { type, id } at top level.
    // Draft content is saved in EditorBlock format (editor.topLevelBlocks) and does NOT
    // need conversion. Published content is HMBlockNode format and needs hmBlocksToEditorContent.
    const first = effectiveBlocks?.[0]
    const isEditorFormat = first != null && 'type' in first && !('block' in first)
    const editorBlocks = isEditorFormat
      ? (effectiveBlocks as any[])
      : hmBlocksToEditorContent(effectiveBlocks, {childrenType: 'Group'})
    console.log('[DocumentEditor] initialContent recalc:', {
      inputBlocksCount: effectiveBlocks?.length,
      outputEditorBlocksCount: editorBlocks.length,
      isEditorFormat,
    })
    return editorBlocks.length > 0 ? editorBlocks : [{type: 'paragraph' as const, id: 'empty'}]
  }, [effectiveBlocks])

  const editor = useBlockNote<HMBlockSchema>(
    {
      editable: false,
      willBeEditable: canEdit,
      renderType: 'document',
      blockSchema: hmBlockSchema,
      onEditorContentChange() {
        if (suppressChangeRef.current) return
        actorRef.send({type: 'change'})
      },
      initialContent,
    },
    [initialContent],
  )

  // Notify parent of editor instance (used by desktop to capture ref for draft saving)
  useEffect(() => {
    onEditorReady?.(editor)
  }, [editor, onEditorReady])

  // Track editing transitions to detect enter/exit.
  const wasEditingRef = useRef(false)

  // Sync editable state with machine, replace blocks on edit entry, place cursor.
  useEffect(() => {
    const justEnteredEditing = isEditing && !wasEditingRef.current
    wasEditingRef.current = isEditing

    if (editor.isEditable !== isEditing) {
      editor.isEditable = isEditing
    }

    console.log('[DocumentEditor] edit effect:', {
      justEnteredEditing,
      isEditing,
      editorBlockCount: editor.topLevelBlocks?.length,
      initialContentCount: initialContent?.length,
    })

    if (justEnteredEditing) {
      // When entering editing mode, explicitly replace editor content with the
      // correct blocks (draft or published). This handles the race condition
      // where the editor was created before draft content was available.
      suppressChangeRef.current = true
      try {
        editor.replaceBlocks(editor.topLevelBlocks, initialContent)
      } finally {
        suppressChangeRef.current = false
      }
    }

    if (isEditing) {
      const view = editor._tiptapEditor?.view
      if (!view) return

      let pos = pendingClickPosRef.current
      pendingClickPosRef.current = null

      // Fall back to saved draft cursor position when no click position is pending
      if (pos === null && draftCursorPosition != null) {
        pos = draftCursorPosition
      }

      if (pos !== null) {
        // Clamp to valid doc range
        const safePos = Math.min(Math.max(pos, 0), view.state.doc.content.size)
        try {
          const selection = TextSelection.create(view.state.doc, safePos)
          view.dispatch(view.state.tr.setSelection(selection))
          // Scroll the cursor into view using the DOM — ProseMirror's scrollIntoView
          // doesn't work with the custom ScrollArea container used in the layout.
          const cursorDOM = view.domAtPos(safePos)
          const node = cursorDOM.node instanceof HTMLElement ? cursorDOM.node : cursorDOM.node.parentElement
          node?.scrollIntoView({block: 'center', behavior: 'instant'})
        } catch {
          // If the stored position is invalid for any reason, just focus without moving cursor
        }
      }

      view.focus()
    }
  }, [editor, isEditing, initialContent])

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

  // Attach DOM click listener for click-to-edit. Using a DOM listener (rather
  // than a ProseMirror plugin) gives us reliable access to the raw event target
  // so we can read `data-content-type` from the DOM, and lets us detect clicks
  // below the last block.
  useEffect(() => {
    const view = editor._tiptapEditor?.view
    if (!view) return

    const domRoot = view.dom as HTMLElement

    const handleMousedown = (e: MouseEvent) => {
      mousedownCoordsRef.current = {x: e.clientX, y: e.clientY}
    }

    const handleClick = (e: MouseEvent) => {
      // Only intercept when in read-only mode and the user has edit permission
      if (view.editable || !canEditRef.current) return

      // Ignore drags — if the pointer moved more than 4px from mousedown it was
      // a text-selection drag and we must not enter edit mode.
      const down = mousedownCoordsRef.current
      if (down) {
        const dx = e.clientX - down.x
        const dy = e.clientY - down.y
        if (dx * dx + dy * dy > 16) return
      }

      const target = e.target as Element

      // --- Case 1: click on a known text block ---
      const contentType = getContentTypeFromTarget(target, domRoot)
      if (contentType !== null) {
        if (!TEXT_BLOCK_TYPES.has(contentType)) return

        // Use posAtCoords to get the ProseMirror position closest to the click
        const coords = view.posAtCoords({left: e.clientX, top: e.clientY})
        pendingClickPosRef.current = coords ? coords.pos : null

        onEditStart()
        e.preventDefault()
        return
      }

      // --- Case 2: click on empty area below the last block ---
      // If posAtCoords returns null (click is outside the document body) but the
      // click is below the last rendered block, we still want to enter edit mode
      // and place the cursor at the end of the document.
      const editorRect = domRoot.getBoundingClientRect()
      if (
        e.clientX >= editorRect.left &&
        e.clientX <= editorRect.right &&
        e.clientY > editorRect.bottom
      ) {
        pendingClickPosRef.current = view.state.doc.content.size
        onEditStart()
        e.preventDefault()
      }
    }

    domRoot.addEventListener('mousedown', handleMousedown)
    domRoot.addEventListener('click', handleClick)

    return () => {
      domRoot.removeEventListener('mousedown', handleMousedown)
      domRoot.removeEventListener('click', handleClick)
    }
  }, [editor, onEditStart])

  const editable = isEditing

  return (
    <BlockNoteView editor={editor}>
      {/* Editing-only positioners — gated behind isEditing */}
      {editable && (
        <>
          <FormattingToolbarPositioner editor={editor} formattingToolbar={HMFormattingToolbar} />
          <SideMenuPositioner editor={editor} />
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
