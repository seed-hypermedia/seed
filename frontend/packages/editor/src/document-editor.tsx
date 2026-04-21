import '@/blocknote/core/style.css'
import '@/editor.css'

import {hmBlocksToEditorContent} from '@seed-hypermedia/client/hmblock-to-editorblock'
import {useOpenUrl} from '@shm/shared'
import type {DocumentContentProps} from '@shm/shared/document-content-props'
import {useEditorHandlersRef} from '@shm/shared/models/editor-handlers-context'
import {
  selectCanEdit,
  selectIsEditing,
  useDocumentMachineRef,
  useDocumentSelector,
} from '@shm/shared/models/use-document-machine'
import {useImageUrl} from '@shm/ui/get-file-url'
import {Extension} from '@tiptap/core'
import {TextSelection} from 'prosemirror-state'
import {useCallback, useEffect, useMemo, useRef} from 'react'
import {addBlockAtEnd} from './add-block-at-end'
import {AddBlockAtEndButton} from './add-block-at-end-button'
import {
  BlockHoverActionsPositioner,
  BlockNoteView,
  FormattingToolbarPositioner,
  FullBlockSelectionObserver,
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
import {FragmentActionsContext, type FragmentActions} from './fragment-actions-context'
import {HMFormattingToolbar} from './hm-formatting-toolbar'
import {HypermediaLinkPreview} from './hm-link-preview'
import {MentionMenuPositioner} from './mention-menu-positioner'
import {hmBlockSchema, HMBlockSchema} from './schema'
import {getSlashMenuItems} from './slash-menu-items'

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
  resourceId,
  focusBlockId,
  focusBlockRange,
  blockCitations,
  onBlockCitationClick,
  onBlockCommentClick,
  onBlockSelect,
  onEditorReady,
  onBlocksFullSelected,
  draftCursorPosition,
  perspectiveAccountUid,
  linkExtensionOptions,
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

  // Set when edit mode is being entered via the "+" button, so the
  // justEnteredEditing effect can call addBlockAtEnd after the editor
  // becomes editable.
  const pendingAddBlockRef = useRef(false)

  const onEditStart = useCallback(() => {
    console.log('[DocEditor] sending edit.start', {state: actorRef.getSnapshot().value})
    actorRef.send({type: 'edit.start'})
  }, [actorRef])

  const onEditStartForAddBlock = useCallback(() => {
    pendingAddBlockRef.current = true
    onEditStart()
  }, [onEditStart])

  // Suppress change events during programmatic content replacement
  // (e.g. when loading draft content on edit-mode entry).
  const suppressChangeRef = useRef(false)

  // Freeze blocks once editing starts so document query refetches don't
  // recreate the editor and lose the user's edits (or loaded draft content).
  const frozenBlocksRef = useRef<typeof blocks | null>(null)
  if (isEditing && !frozenBlocksRef.current) {
    frozenBlocksRef.current = blocks
  }
  if (!isEditing) {
    frozenBlocksRef.current = null
  }
  const effectiveBlocks = frozenBlocksRef.current ?? blocks

  const initialContent = useMemo(() => {
    // Detect format: HMBlockNode has { block, children }, EditorBlock has { type, id } at top level.
    // Draft content is saved in EditorBlock format (editor.topLevelBlocks) and does NOT
    // need conversion. Published content is HMBlockNode format and needs hmBlocksToEditorContent.
    const first = effectiveBlocks?.[0]
    const isEditorFormat = first != null && 'type' in first && !('block' in first)
    const editorBlocks = isEditorFormat
      ? (effectiveBlocks as any[])
      : hmBlocksToEditorContent(effectiveBlocks, {childrenType: 'Group'})
    return editorBlocks.length > 0 ? editorBlocks : [{type: 'paragraph' as const, id: 'empty'}]
  }, [effectiveBlocks])

  const editor = useBlockNote<HMBlockSchema>(
    {
      editable: false,
      willBeEditable: canEdit,
      renderType: 'document',
      blockSchema: hmBlockSchema,
      getSlashMenuItems: () => getSlashMenuItems({docId: resourceId}),
      onEditorContentChange() {
        if (suppressChangeRef.current) return
        actorRef.send({type: 'change'})
      },
      initialContent,
      // Caller-provided options (grpcClient, domainResolver, gwUrl,
      // checkWebUrl, queryClient, etc.) are required by pasteHandler to
      // (a) convert pasted web URLs to hm:// and (b) apply a link mark to
      // the current selection on paste.
      linkExtensionOptions: {
        ...(linkExtensionOptions ?? {}),
        openUrl: (linkExtensionOptions as any)?.openUrl ?? openUrl,
      } as any,
      _tiptapOptions: {
        extensions: [
          Extension.create({
            name: 'document-select-all',
            priority: 1000,
            addKeyboardShortcuts() {
              return {
                'Mod-a': ({editor}) => {
                  editor.commands.selectAll()
                  return true
                },
              }
            },
          }),
          Extension.create({
            name: 'document-escape-editing',
            priority: 0,
            addKeyboardShortcuts() {
              return {
                Escape: () => {
                  actorRef.send({type: 'edit.cancel'})
                  return true
                },
              }
            },
          }),
          Extension.create({
            name: 'document-open-link-toolbar',
            priority: 1000,
            addKeyboardShortcuts() {
              return {
                'Mod-k': ({editor}) => {
                  if (!editor.isEditable) return false
                  const view = editor.view
                  const linkType = view.state.schema.marks.link
                  if (!linkType) return false
                  // Nudge the selection so HyperlinkToolbarPlugin re-runs
                  // updateFromSelection and shows the toolbar. If there's no
                  // link mark yet, toggle one on the current selection with
                  // an empty href so the form opens for editing.
                  const {from, to, empty} = view.state.selection
                  const hasLinkMark = view.state.doc.rangeHasMark(from, to, linkType)
                  if (!hasLinkMark && !empty) {
                    editor.commands.toggleLink({href: ''})
                  }
                  // Re-dispatch the current selection to trigger the
                  // hyperlink toolbar plugin's update cycle.
                  view.dispatch(view.state.tr.setSelection(view.state.selection))
                  return true
                },
              }
            },
          }),
        ],
      },
    },
    [initialContent],
  )

  // Notify parent of editor instance (used by desktop to capture ref for draft saving)
  useEffect(() => {
    onEditorReady?.(editor)
  }, [editor, onEditorReady])

  // Latest values for handlers — read lazily so the machine always sees fresh
  // content without re-registering handlers.
  const initialContentRef = useRef(initialContent)
  initialContentRef.current = initialContent
  const draftCursorPositionRef = useRef(draftCursorPosition)
  draftCursorPositionRef.current = draftCursorPosition

  const handlersRef = useEditorHandlersRef()

  // Register imperative handlers the document machine calls when entering /
  // exiting the `editing` state (flip editable, replace blocks with the right
  // content, place cursor). Replacing the effect-based sync with a machine-
  // driven entry/exit guarantees the editor is editable synchronously as part
  // of the `edit.start` transition — so any callsite may `send({type: 'edit.start'})`
  // immediately followed by `editor.updateBlock(...)`.
  useEffect(() => {
    handlersRef.current = {
      setEditable: (editable) => {
        if (editor.isEditable !== editable) {
          editor.isEditable = editable
        }
      },
      applyInitialContent: () => {
        suppressChangeRef.current = true
        try {
          editor.replaceBlocks(editor.topLevelBlocks, initialContentRef.current)
        } finally {
          suppressChangeRef.current = false
        }
      },
      placeCursor: () => {
        const view = editor._tiptapEditor?.view
        if (!view) {
          console.log('[DocEditor] placeCursor: no view')
          return
        }

        // If edit mode was entered via the "+" button, append an empty block at
        // the end and open the slash menu. This supersedes click-position logic
        // because addBlockAtEnd sets its own cursor position.
        if (pendingAddBlockRef.current) {
          pendingAddBlockRef.current = false
          pendingClickPosRef.current = null
          addBlockAtEnd(editor)
          return
        }

        let pos = pendingClickPosRef.current
        pendingClickPosRef.current = null

        // Fall back to saved draft cursor position when no click position is pending
        if (pos === null && draftCursorPositionRef.current != null) {
          pos = draftCursorPositionRef.current
        }

        console.log('[DocEditor] placeCursor', {pos, docSize: view.state.doc.content.size})

        const applySelection = () => {
          if (pos !== null) {
            const safePos = Math.min(Math.max(pos, 0), view.state.doc.content.size)
            try {
              const selection = TextSelection.create(view.state.doc, safePos)
              view.dispatch(view.state.tr.setSelection(selection))
              // ProseMirror's scrollIntoView doesn't work with the custom ScrollArea
              // container used in the layout — use the DOM directly.
              const cursorDOM = view.domAtPos(safePos)
              const node = cursorDOM.node instanceof HTMLElement ? cursorDOM.node : cursorDOM.node.parentElement
              node?.scrollIntoView({block: 'center', behavior: 'instant'})
            } catch (err) {
              console.log('[DocEditor] placeCursor selection failed', err)
            }
          }
          view.focus()
        }

        // Apply immediately, but also re-apply on the next frame to survive
        // Radix's focus restoration when entering editing from the
        // confirmingOldVersionEdit dialog. Radix moves focus back to the
        // previously focused element after the dialog unmounts, which can
        // steal focus from the editor — reapplying after the Radix cleanup
        // lets our cursor placement win.
        applySelection()
        requestAnimationFrame(() => {
          if (view.isDestroyed) return
          applySelection()
        })
      },
    }

    // Resync: when `DocumentEditor` mounts after the machine has already
    // entered `editing` (e.g. auto-enter via existingDraftId), the entry
    // actions already fired with `handlersRef.current === null` and no-oped.
    // Replay them here so the editor still flips editable, loads draft
    // content, and places the cursor.
    if (actorRef.getSnapshot().matches('editing')) {
      handlersRef.current.setEditable(true)
      handlersRef.current.applyInitialContent()
      handlersRef.current.placeCursor()
    }

    return () => {
      handlersRef.current = null
    }
  }, [editor, actorRef, handlersRef])

  // Keyboard shortcut: while in read-only mode and the document area has
  // focus (or focus is on document.body), pressing Enter enters edit mode
  // and places the cursor at the end of the document. This is the fallback
  // entry point for documents with no text blocks.
  useEffect(() => {
    if (!canEdit || isEditing) return

    const view = editor._tiptapEditor?.view
    if (!view) return

    const domRoot = view.dom as HTMLElement

    const handleKeydown = (e: KeyboardEvent) => {
      if (e.key !== 'Enter') return
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return

      // Ignore when focus is inside an input/textarea/contentEditable outside
      // the editor — those have their own Enter semantics.
      const active = document.activeElement as HTMLElement | null
      if (active && active !== document.body) {
        const tag = active.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
        if (active.isContentEditable && !domRoot.contains(active)) return
        // Only accept activation when focus is on the editor container, one
        // of its ancestors, or the body — prevents stealing Enter from
        // buttons / dialogs elsewhere in the page.
        if (!domRoot.contains(active) && !active.contains(domRoot)) return
      }

      pendingClickPosRef.current = view.state.doc.content.size
      onEditStart()
      e.preventDefault()
    }

    document.addEventListener('keydown', handleKeydown)
    return () => {
      document.removeEventListener('keydown', handleKeydown)
    }
  }, [editor, canEdit, isEditing, onEditStart])

  // DEBUG: Cmd/Ctrl+Shift+D toggles block-border overlay via
  // html[data-debug-blocks]. CSS lives in editor.css and blocks-content.css.
  useEffect(() => {
    const handleDebugToggle = (e: KeyboardEvent) => {
      if (e.key !== 'D' && e.key !== 'd') return
      if (!(e.metaKey || e.ctrlKey) || !e.shiftKey) return
      e.preventDefault()
      const html = document.documentElement
      html.dataset.debugBlocks = html.dataset.debugBlocks === '1' ? '' : '1'
    }
    document.addEventListener('keydown', handleDebugToggle)
    return () => document.removeEventListener('keydown', handleDebugToggle)
  }, [])

  // Dispatch block highlight when focusBlockId / focusBlockRange changes.
  // When a codepoint range is provided, highlight only that fragment;
  // otherwise fall back to highlighting the whole block.
  const rangeStart = focusBlockRange && 'start' in focusBlockRange ? focusBlockRange.start : null
  const rangeEnd = focusBlockRange && 'end' in focusBlockRange ? focusBlockRange.end : null
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
      if (view.editable || !canEditRef.current) {
        console.log('[DocEditor] click ignored', {editable: view.editable, canEdit: canEditRef.current})
        return
      }

      // Ignore drags — if the pointer moved more than 4px from mousedown it was
      // a text-selection drag and we must not enter edit mode.
      const down = mousedownCoordsRef.current
      if (down) {
        const dx = e.clientX - down.x
        const dy = e.clientY - down.y
        if (dx * dx + dy * dy > 16) return
      }

      const target = e.target as Element

      // If the click landed on a link, let the link plugin handle navigation.
      // Do not enter edit mode and do not preventDefault.
      if (target.closest?.('.link, a[href]')) return

      // --- Case 1: click on a known text block ---
      const contentType = getContentTypeFromTarget(target, domRoot)
      if (contentType !== null) {
        if (!TEXT_BLOCK_TYPES.has(contentType)) return

        // Use posAtCoords to get the ProseMirror position closest to the click
        const coords = view.posAtCoords({left: e.clientX, top: e.clientY})
        pendingClickPosRef.current = coords ? coords.pos : null

        console.log('[DocEditor] click on text block → onEditStart')
        onEditStart()
        e.preventDefault()
        return
      }

      // --- Case 2: click on empty area below the last block ---
      // If posAtCoords returns null (click is outside the document body) but the
      // click is below the last rendered block, we still want to enter edit mode
      // and place the cursor at the end of the document.
      const editorRect = domRoot.getBoundingClientRect()
      if (e.clientX >= editorRect.left && e.clientX <= editorRect.right && e.clientY > editorRect.bottom) {
        pendingClickPosRef.current = view.state.doc.content.size
        console.log('[DocEditor] click below last block → onEditStart')
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

  const fragmentActionsValue = useMemo<FragmentActions | null>(() => {
    if (!onBlockSelect && !onBlockCommentClick) return null
    return {
      onCopyFragmentLink: (blockId, rangeStart, rangeEnd) =>
        onBlockSelect?.(blockId, {start: rangeStart, end: rangeEnd, copyToClipboard: true}),
      onComment: (blockId, rangeStart, rangeEnd) =>
        onBlockCommentClick?.(blockId, {start: rangeStart, end: rangeEnd}, true),
    }
  }, [onBlockSelect, onBlockCommentClick])

  return (
    <FragmentActionsContext.Provider value={fragmentActionsValue}>
      <BlockNoteView editor={editor}>
        {/* Editing-only positioners — gated behind isEditing */}
        {editable && (
          <>
            <FormattingToolbarPositioner editor={editor} formattingToolbar={HMFormattingToolbar} />
            <SideMenuPositioner editor={editor} />
            <SlashMenuPositioner editor={editor} />
            <LinkMenuPositioner editor={editor} />
            <MentionMenuPositioner editor={editor} perspectiveAccountUid={perspectiveAccountUid} />
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
              ? (blockId, rangeStart, rangeEnd) =>
                  onBlockCommentClick(blockId, {start: rangeStart, end: rangeEnd}, true)
              : undefined
          }
        />
        <SupernumbersController
          editor={editor}
          data={blockCitations ?? null}
          onSupernumberClick={onBlockCitationClick ? (blockId) => onBlockCitationClick(blockId) : undefined}
        />
        <FullBlockSelectionObserver editor={editor} onBlocksFullSelected={onBlocksFullSelected} />
      </BlockNoteView>
      {canEdit && <AddBlockAtEndButton editor={editor} onEditStart={onEditStartForAddBlock} />}
    </FragmentActionsContext.Provider>
  )
}
