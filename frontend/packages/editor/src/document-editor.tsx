import '@/blocknote/core/style.css'
import '@/editor.css'

import {hmBlocksToEditorContent} from '@seed-hypermedia/client/hmblock-to-editorblock'
import {hypermediaUrlToHref, RenderResourceProvider, useOpenUrl, useUniversalAppContext} from '@shm/shared'
import type {DocumentContentProps} from '@shm/shared/document-content-props'
import type {EditCursorPosition} from '@shm/shared/models/document-machine'
import {useEditorHandlersRef} from '@shm/shared/models/editor-handlers-context'
import {
  selectCanEdit,
  selectIsEditing,
  useDocumentMachineRef,
  useDocumentSelector,
} from '@shm/shared/models/use-document-machine'
import {collectChildDraftIds} from '@shm/shared/utils/child-draft-refs'
import {hmLinkTargetsDocument} from '@shm/shared/utils/document-card-cleanup'
import {useImageUrl} from '@shm/ui/get-file-url'
import {Extension} from '@tiptap/core'
import {Plugin, PluginKey, TextSelection} from 'prosemirror-state'
import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {
  BlockHoverActionsPositioner,
  BlockNoteEditor,
  BlockNoteView,
  FormattingToolbarPositioner,
  FullBlockSelectionObserver,
  HyperlinkToolbarPositioner,
  ImageGalleryOverlay,
  LinkMenuPositioner,
  PredictionConeDebugOverlay,
  RangeSelectionPositioner,
  SideMenuPositioner,
  SlashMenuPositioner,
  SupernumbersController,
  useBlockNote,
  type FormattingToolbarProps,
} from './blocknote'
import {insertOrUpdateBlock} from './blocknote/core/extensions/SlashMenu/defaultSlashMenuItems'
import {useDraftActions} from './draft-actions-context'
import {FragmentActionsContext, type FragmentActions} from './fragment-actions-context'
import {HMFormattingToolbar} from './hm-formatting-toolbar'
import {HypermediaLinkPreview} from './hm-link-preview'
import {createHypermediaDocLinkPlugin} from './hypermedia-link-plugin'
import {InlineAddBlockButton} from './inline-add-block-button'
import {MentionMenuPositioner} from './mention-menu-positioner'
import {PublishRequiredDialog} from './publish-required-dialog'
import {hmBlockSchema, HMBlockSchema} from './schema'
import {getSlashMenuItems} from './slash-menu-items'
import {selectAllEditorContent} from './utils'
import {useBlockBorderDebug} from './use-block-border-debug'
import {useBlockHighlight} from './use-block-highlight'
import {useReadOnlyClickToEdit} from './use-readonly-click-to-edit'

export type {DocumentContentProps}

/** Return whether editor blocks changed compared to the previous serialized snapshot. */
export function getEditorBlocksChange(previousKey: string | null, blocks: unknown[]) {
  const nextKey = JSON.stringify(blocks)
  return {changed: previousKey !== null && previousKey !== nextKey, nextKey}
}

/** Block types (data-content-type values) that trigger edit mode on click. */
const TEXT_BLOCK_TYPES = new Set(['paragraph', 'heading', 'code-block'])

/** Returns a stable key for a document text selection, including collapsed selections. */
export function getDocumentSelectionObserverKey(selection: {from: number; to: number}): string {
  return `${selection.from}:${selection.to}`
}

/**
 * Returns whether a block action must be blocked until publish. Draft-only
 * blocks are not stable references, but blocks already present in the
 * published document remain referenceable even while editing a draft.
 */
export function shouldRequirePublishForBlockAction({
  blockId,
  isUnpublishedDraft,
  isBlockInPublishedVersion,
}: {
  blockId: string
  isUnpublishedDraft?: boolean
  isBlockInPublishedVersion?: (blockId: string) => boolean
}): boolean {
  if (isBlockInPublishedVersion) return !isBlockInPublishedVersion(blockId)
  return !!isUnpublishedDraft
}

function setEditorRootChildrenType(
  editor: BlockNoteEditor<HMBlockSchema>,
  childrenType: DocumentContentProps['rootChildrenType'],
) {
  const view = editor._tiptapEditor?.view
  const rootGroup = view?.state.doc.firstChild
  if (!view || rootGroup?.type.name !== 'blockChildren') return

  const listType = childrenType || 'Group'
  if (rootGroup.attrs.listType === listType) return

  view.dispatch(
    view.state.tr.setNodeMarkup(0, null, {
      ...rootGroup.attrs,
      listType,
      listLevel: '1',
    }),
  )
}

function removeDeletedDocumentEmbedsFromEditorBlocks(
  blocks: any[],
  input: {deletedDocumentId: string; removedBlockIds?: string[]},
) {
  const removed = new Set(input.removedBlockIds ?? [])
  const actualRemovedBlockIds: string[] = []

  const expandBlock = (block: any): any[] => {
    const children = Array.isArray(block?.children) ? block.children : []
    const url = block?.props?.url
    const matchesUrl =
      block?.type === 'embed' && typeof url === 'string' && hmLinkTargetsDocument(url, input.deletedDocumentId)
    const matchesRemovedId = !!block?.id && removed.has(block.id)
    if (matchesUrl || matchesRemovedId) {
      if (block?.id) actualRemovedBlockIds.push(block.id)
      return children.flatMap(expandBlock)
    }
    return [{...block, children: children.flatMap(expandBlock)}]
  }

  return {
    content: blocks.flatMap(expandBlock),
    removedBlockIds: actualRemovedBlockIds,
  }
}

export function DocumentEditor({
  blocks,
  resourceId,
  focusBlockId,
  focusBlockRange,
  rootChildrenType,
  blockCitations,
  onBlockCitationClick,
  onBlockCommentClick,
  onBlockSelect,
  onTextSelection,
  onEditorReady,
  onBlocksFullSelected,
  draftCursorPosition,
  perspectiveAccountUid,
  linkExtensionOptions,
  importWebFile,
  handleFileAttachment,
  isUnpublishedDraft,
  isBlockInPublishedVersion,
}: DocumentContentProps) {
  const [publishRequiredDialog, setPublishRequiredDialog] = useState<
    {open: false} | {open: true; intent: 'copy-link' | 'comment'}
  >({open: false})
  const openUrl = useOpenUrl()
  const {hmUrlHref, openRouteNewWindow, origin, originHomeId, experiments} = useUniversalAppContext()
  const getImageUrl = useImageUrl()
  const onCreateInlineDraft = useDraftActions()?.onCreateInlineDraft
  const actorRef = useDocumentMachineRef()
  const canEdit = useDocumentSelector(selectCanEdit)
  const isEditing = useDocumentSelector(selectIsEditing)
  const renderHref = useCallback(
    (url: string) =>
      hypermediaUrlToHref(url, {
        hmUrlHref,
        origin,
        originHomeId,
      }) || url,
    [hmUrlHref, origin, originHomeId],
  )

  const canEditRef = useRef(canEdit)
  canEditRef.current = canEdit

  const onEditStart = useCallback(
    (cursorPosition?: EditCursorPosition | null) => {
      // console.log('[DocEditor] sending edit.start', {state: actorRef.getSnapshot().value})
      actorRef.send({type: 'edit.start', cursorPosition})
    },
    [actorRef],
  )

  const onTextSelectionRef = useRef(onTextSelection)
  onTextSelectionRef.current = onTextSelection

  // Suppress change events during programmatic content replacement
  // (e.g. when loading draft content on edit-mode entry).
  const suppressChangeRef = useRef(false)
  const lastEditorContentKeyRef = useRef<string | null>(null)

  // Ref to the BlockNote editor for use inside option callbacks that are
  // created before the editor instance exists (e.g. the paste handler's
  // block-fragment landing callback).
  const docEditorRef = useRef<BlockNoteEditor<HMBlockSchema> | null>(null)

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
    return editorBlocks.length > 0 ? editorBlocks : [{type: 'paragraph' as const}]
  }, [effectiveBlocks])

  const editor = useBlockNote<HMBlockSchema>(
    {
      editable: false,
      willBeEditable: canEdit,
      renderType: 'document',
      blockSchema: hmBlockSchema,
      importWebFile: importWebFile as any,
      handleFileAttachment: handleFileAttachment as any,
      getSlashMenuItems: () => getSlashMenuItems({docId: resourceId, onCreateInlineDraft}),
      onEditorContentChange(editor) {
        if (suppressChangeRef.current) return
        const {changed, nextKey} = getEditorBlocksChange(lastEditorContentKeyRef.current, editor.topLevelBlocks)
        lastEditorContentKeyRef.current = nextKey
        if (!changed) return
        actorRef.send({type: 'childDraftRefs.changed', draftIds: collectChildDraftIds(editor.topLevelBlocks)})
        actorRef.send({type: 'change'})
      },
      initialContent,
      rootChildrenType: rootChildrenType || 'Group',
      // Caller-provided options (universalClient, domainResolver, gwUrl,
      // checkWebUrl, queryClient, etc.) are required by pasteHandler to
      // (a) convert pasted web URLs to hm:// and (b) apply a link mark to
      // the current selection on paste.
      linkExtensionOptions: {
        ...linkExtensionOptions,
        openUrl: linkExtensionOptions?.openUrl ?? openUrl,
        renderHref: linkExtensionOptions?.renderHref ?? renderHref,
        handleModifiedClicks: linkExtensionOptions?.handleModifiedClicks ?? !!openRouteNewWindow,
        onPasteHypermediaBlockFragment:
          linkExtensionOptions?.onPasteHypermediaBlockFragment ??
          ((resolvedHmUrl: string) => {
            const ed = docEditorRef.current
            if (!ed) return false
            insertOrUpdateBlock(
              ed,
              {
                type: 'embed',
                props: {url: resolvedHmUrl, view: 'Content'},
              } as any,
              true,
            )
            return true
          }),
      },
      _tiptapOptions: {
        extensions: [
          Extension.create({
            name: 'hypermedia-link',
            addProseMirrorPlugins() {
              return [createHypermediaDocLinkPlugin({domainResolver: linkExtensionOptions?.domainResolver}).plugin]
            },
          }),
          Extension.create({
            name: 'document-select-all',
            priority: 1000,
            addKeyboardShortcuts() {
              return {
                'Mod-a': ({editor}) => {
                  return selectAllEditorContent(editor)
                },
              }
            },
          }),
          Extension.create({
            name: 'document-text-selection-observer',
            priority: 0,
            addProseMirrorPlugins() {
              const pluginKey = new PluginKey('documentTextSelectionObserver')
              let lastSelectionKey: string | null = null

              return [
                new Plugin({
                  key: pluginKey,
                  view: () => ({
                    update(view, prevState) {
                      const selection = view.state.selection
                      if (selection.eq(prevState.selection)) return

                      if (!(selection instanceof TextSelection)) {
                        lastSelectionKey = null
                        return
                      }

                      const selectionKey = getDocumentSelectionObserverKey(selection)
                      if (selectionKey === lastSelectionKey) return
                      lastSelectionKey = selectionKey
                      onTextSelectionRef.current?.()
                    },
                  }),
                }),
              ]
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
          // Tracks which BlockNote block ids the local user has touched since
          // entering editing. The ids feed `rebase.blockTouched` so that the
          // rebase classifier can tell apart locally-edited blocks from
          // incoming remote edits.
          Extension.create({
            name: 'document-rebase-track-touches',
            priority: 0,
            addProseMirrorPlugins() {
              const pluginKey = new PluginKey('documentRebaseTrackTouches')
              let scheduled = false
              let pending = new Set<string>()
              const flush = () => {
                scheduled = false
                if (!pending.size) return
                const ids = Array.from(pending)
                pending = new Set()
                // console.log('[Rebase track] emit blockTouched', ids)
                actorRef.send({type: 'rebase.blockTouched', blockIds: ids})
              }
              return [
                new Plugin({
                  key: pluginKey,
                  appendTransaction: (transactions, _oldState, newState) => {
                    let docChanged = false
                    for (const tr of transactions) if (tr.docChanged) docChanged = true
                    if (!docChanged) return null
                    if (suppressChangeRef.current) {
                      // console.log('[Rebase track] skip: suppressChangeRef set')
                      return null
                    }
                    // console.log('[Rebase track] appendTransaction docChanged, walking blocks')
                    // Walk the new doc, collecting BlockNote block ids whose
                    // positions map back to any changed range.
                    newState.doc.descendants((node, pos) => {
                      if (node.type.name !== 'blockNode') return true
                      const rawId = node.attrs?.id
                      if (typeof rawId !== 'string') return true
                      const from = pos
                      const to = pos + node.nodeSize
                      for (const tr of transactions) {
                        if (!tr.docChanged) continue
                        for (const step of tr.steps) {
                          const stepMap = step.getMap()
                          let intersects = false
                          stepMap.forEach((oldStart, oldEnd, newStart, newEnd) => {
                            if (newStart <= to && newEnd >= from) intersects = true
                          })
                          if (intersects) {
                            pending.add(rawId)
                            break
                          }
                        }
                      }
                      return true
                    })
                    if (pending.size && !scheduled) {
                      scheduled = true
                      // rAF-batch so we send at most once per frame.
                      if (typeof requestAnimationFrame !== 'undefined') {
                        requestAnimationFrame(flush)
                      } else {
                        setTimeout(flush, 0)
                      }
                    }
                    return null
                  },
                }),
              ]
            },
          }),
        ],
      },
    },
    [initialContent],
  )

  // Keep the editor ref current so the paste-handler block-fragment landing
  // callback can resolve to the same editor instance.
  docEditorRef.current = editor

  // Latest values for handlers — read lazily so the machine always sees fresh
  // content without re-registering handlers.
  const initialContentRef = useRef(initialContent)
  initialContentRef.current = initialContent
  const draftCursorPositionRef = useRef(draftCursorPosition)
  draftCursorPositionRef.current = draftCursorPosition
  const onEditorReadyRef = useRef(onEditorReady)
  onEditorReadyRef.current = onEditorReady
  const handlersRef = useEditorHandlersRef()

  useEffect(() => {
    suppressChangeRef.current = true
    try {
      setEditorRootChildrenType(editor, rootChildrenType)
    } finally {
      suppressChangeRef.current = false
    }
  }, [editor, rootChildrenType])

  // Single effect that wires up the editor-to-machine bridge on mount:
  // - Registers the `_onRootChildrenTypeChange` callback forwarded to the machine
  // - Exposes `suppressChangeRef` on the editor for useAutoRebase
  // - Notifies parent via `onEditorReady`
  // - Registers imperative handlers the machine calls when entering/exiting `editing`
  useEffect(() => {
    const onRootChildrenTypeChange = (childrenType: DocumentContentProps['rootChildrenType']) => {
      if (childrenType === 'Unordered' || childrenType === 'Ordered') {
        actorRef.send({type: 'rootChildrenType.change', childrenType})
      }
    }
    ;(editor as any)._onRootChildrenTypeChange = onRootChildrenTypeChange
    ;(editor as any)._suppressChangeRef = suppressChangeRef

    onEditorReadyRef.current?.(editor)

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
        lastEditorContentKeyRef.current = JSON.stringify(editor.topLevelBlocks)
        actorRef.send({type: 'editor.baselineUpdate', blocks: editor.topLevelBlocks as any})
        actorRef.send({type: 'childDraftRefs.changed', draftIds: collectChildDraftIds(editor.topLevelBlocks)})
      },
      getCurrentBlocks: () => editor.topLevelBlocks as any,
      replaceCurrentContent: (blocks) => {
        suppressChangeRef.current = true
        try {
          editor.replaceBlocks(editor.topLevelBlocks, blocks as any)
        } finally {
          suppressChangeRef.current = false
        }
        lastEditorContentKeyRef.current = JSON.stringify(editor.topLevelBlocks)
        actorRef.send({type: 'editor.baselineUpdate', blocks: editor.topLevelBlocks as any})
        actorRef.send({type: 'childDraftRefs.changed', draftIds: collectChildDraftIds(editor.topLevelBlocks)})
      },
      applyDocumentCardCleanup: (input) => {
        const {content, removedBlockIds} = removeDeletedDocumentEmbedsFromEditorBlocks(editor.topLevelBlocks, input)
        if (!removedBlockIds.length) return

        suppressChangeRef.current = true
        try {
          editor.replaceBlocks(editor.topLevelBlocks, content)
        } finally {
          suppressChangeRef.current = false
        }
        lastEditorContentKeyRef.current = JSON.stringify(editor.topLevelBlocks)
        actorRef.send({type: 'editor.baselineUpdate', blocks: editor.topLevelBlocks as any})
        actorRef.send({type: 'childDraftRefs.changed', draftIds: collectChildDraftIds(editor.topLevelBlocks)})
      },
      placeCursor: (position) => {
        const view = editor._tiptapEditor?.view
        if (!view) {
          return
        }

        let pos: number | null
        if (position === 'end') {
          const lastBlock = editor.topLevelBlocks.at(-1)
          if (lastBlock) {
            if (TEXT_BLOCK_TYPES.has(lastBlock.type)) {
              editor.setTextCursorPosition(lastBlock, 'end')
            } else {
              editor.insertBlocks([{type: 'paragraph', content: ''}], lastBlock.id, 'after')
              const insertedBlock = editor.topLevelBlocks.at(-1)
              if (insertedBlock) editor.setTextCursorPosition(insertedBlock, 'start')
            }
            view.focus()
            return
          }
          pos = view.state.doc.content.size
        } else {
          pos = position ?? null
        }

        if (pos === null && draftCursorPositionRef.current != null) {
          pos = draftCursorPositionRef.current
        }

        const applySelection = () => {
          if (pos !== null) {
            const safePos = Math.min(Math.max(pos, 0), view.state.doc.content.size)
            try {
              const selection = TextSelection.create(view.state.doc, safePos)
              view.dispatch(view.state.tr.setSelection(selection))
              const cursorDOM = view.domAtPos(safePos)
              const node = cursorDOM.node instanceof HTMLElement ? cursorDOM.node : cursorDOM.node.parentElement
              node?.scrollIntoView({block: 'center', behavior: 'instant'})
            } catch (err) {}
          }
          view.focus()
        }

        applySelection()
        requestAnimationFrame(() => {
          if (view.isDestroyed) return
          applySelection()
        })
      },
    }

    if (actorRef.getSnapshot().matches('editing')) {
      handlersRef.current.setEditable(true)
      handlersRef.current.applyInitialContent()
      handlersRef.current.placeCursor()
    }

    return () => {
      delete (editor as any)._onRootChildrenTypeChange
      handlersRef.current = null
    }
  }, [editor, actorRef, handlersRef])

  const focusEditorEnd = useCallback(() => {
    const view = editor._tiptapEditor?.view
    if (!view) return
    onEditStart('end')
  }, [editor, onEditStart])

  // DEBUG: Cmd/Ctrl+Shift+D toggles block-border overlay
  useBlockBorderDebug()

  // Scroll-to-block highlight when focusBlockId / focusBlockRange changes
  useBlockHighlight({editor, focusBlockId, focusBlockRange})

  // DOM click listener for click-to-edit in read-only mode
  useReadOnlyClickToEdit({editor, canEditRef, onEditStart, onTextSelectionRef})

  const editable = isEditing

  const fragmentActionsValue = useMemo<FragmentActions | null>(() => {
    if (!onBlockSelect && !onBlockCommentClick) return null
    const shouldIntercept = (blockId: string): boolean => {
      return shouldRequirePublishForBlockAction({blockId, isUnpublishedDraft, isBlockInPublishedVersion})
    }
    return {
      onCopyFragmentLink: (blockId, rangeStart, rangeEnd) => {
        if (shouldIntercept(blockId)) {
          setPublishRequiredDialog({open: true, intent: 'copy-link'})
          return
        }
        onBlockSelect?.(blockId, {start: rangeStart, end: rangeEnd, copyToClipboard: true})
      },
      onComment: (blockId, rangeStart, rangeEnd) => {
        if (shouldIntercept(blockId)) {
          setPublishRequiredDialog({open: true, intent: 'comment'})
          return
        }
        onBlockCommentClick?.(blockId, {start: rangeStart, end: rangeEnd}, true)
      },
      onCopyBlockLink: onBlockSelect
        ? (blockId) => {
            if (shouldIntercept(blockId)) {
              setPublishRequiredDialog({open: true, intent: 'copy-link'})
              return
            }
            onBlockSelect(blockId, {copyToClipboard: true})
          }
        : undefined,
      onCommentOnBlock: onBlockCommentClick
        ? (blockId) => {
            if (shouldIntercept(blockId)) {
              setPublishRequiredDialog({open: true, intent: 'comment'})
              return
            }
            onBlockCommentClick(blockId, undefined, true)
          }
        : undefined,
    }
  }, [onBlockSelect, onBlockCommentClick, isUnpublishedDraft, isBlockInPublishedVersion])

  const isHoverActionBlockReferenceable = useCallback(
    (blockId: string) => {
      return !shouldRequirePublishForBlockAction({blockId, isUnpublishedDraft, isBlockInPublishedVersion})
    },
    [isUnpublishedDraft, isBlockInPublishedVersion],
  )

  // Memo so the FormattingToolbarPositioner doesn't rebuild its React
  // tree on every parent render. An inline arrow here was causing
  // HMFormattingToolbar to mount/unmount continuously, wiping its panel
  // state
  const hmFormattingToolbar = useCallback(
    (p: FormattingToolbarProps<any>) => <HMFormattingToolbar {...p} docId={resourceId} />,
    [resourceId],
  )

  return (
    <RenderResourceProvider resource={{kind: 'document', id: resourceId}}>
      <FragmentActionsContext.Provider value={fragmentActionsValue}>
        <BlockNoteView editor={editor} className="hm-prose draft-editor">
          {/* Editing-only positioners — gated behind isEditing */}
          {editable && (
            <>
              <FormattingToolbarPositioner editor={editor} formattingToolbar={hmFormattingToolbar} />
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

          {/* Viewer/hover extensions */}
          <ImageGalleryOverlay editor={editor} resolveImageUrl={getImageUrl} />
          {(onBlockSelect || onBlockCommentClick) && (
            <BlockHoverActionsPositioner
              editor={editor}
              isBlockReferenceable={isHoverActionBlockReferenceable}
              getCommentCount={(blockId) => blockCitations?.[blockId]?.comments}
              onCopyBlockLink={onBlockSelect ? (blockId) => onBlockSelect(blockId, {copyToClipboard: true}) : undefined}
              onStartComment={
                onBlockCommentClick ? (blockId) => onBlockCommentClick(blockId, undefined, true) : undefined
              }
            />
          )}
          {experiments?.developerTools && <PredictionConeDebugOverlay editor={editor} />}
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

        <button
          type="button"
          aria-label="Focus editor at end"
          tabIndex={-1}
          className="block h-[500px] w-full cursor-text appearance-none border-0 bg-transparent p-0 text-left"
          onPointerDown={(event) => {
            event.preventDefault()
            event.stopPropagation()
            focusEditorEnd()
          }}
        />
        {canEdit && editor.isEditable && <InlineAddBlockButton editor={editor} />}
        <PublishRequiredDialog
          open={publishRequiredDialog.open}
          intent={publishRequiredDialog.open ? publishRequiredDialog.intent : 'copy-link'}
          onOpenChange={(open) => {
            if (!open) setPublishRequiredDialog({open: false})
          }}
        />
      </FragmentActionsContext.Provider>
    </RenderResourceProvider>
  )
}
