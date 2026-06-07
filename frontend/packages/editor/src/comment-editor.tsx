import type {EditorBlock} from '@seed-hypermedia/client/editor-types'
import {HMBlockNode, HMMetadata} from '@seed-hypermedia/client/hm-types'
import {hmBlocksToEditorContent} from '@seed-hypermedia/client/hmblock-to-editorblock'
import {packReferenceUrl, useOpenUrl, useUniversalClient, writeableStateStream} from '@shm/shared'
import {useAccount} from '@shm/shared/models/entity'
import {useTx} from '@shm/shared/translation'
import type {UniversalClient} from '@shm/shared/universal-client'
import {UIAvatar} from '@shm/ui/avatar'
import {Button} from '@shm/ui/button'
import {LinkIcon} from '@shm/ui/hm-icon'
import {AtSignIcon, ImageIcon, SlashSquareIcon} from '@shm/ui/icons'
import {cn} from '@shm/ui/utils'
import {Extension} from '@tiptap/core'
import {Plugin, PluginKey} from '@tiptap/pm/state'
import {type MutableRefObject, useEffect, useLayoutEffect, useRef, useState} from 'react'
import avatarPlaceholder from './assets/avatar.png'
import {BlockNoteEditor, getBlockInfoFromPos, useBlockNote} from './blocknote'
import type {HandleFileAttachmentFunction, ImportWebFileFunction} from './blocknote/core/BlockNoteEditor'
import {insertOrUpdateBlock} from './blocknote/core/extensions/SlashMenu/defaultSlashMenuItems'
import {FILE_DROP_INSERTED_EVENT} from './blocknote/core/extensions/DragMedia/DragExtension'
import {HyperMediaEditorView} from './editor-view'
import {createHypermediaDocLinkPlugin} from './hypermedia-link-plugin'
import {MobileMentionsDialog} from './mobile-mentions-dialog'
import {MobileSlashDialog} from './mobile-slash-dialog'
import {mentionSuggestionPluginKey} from './mention-suggestion-plugin'
import {slashMenuPluginKey} from './blocknote/core/extensions/SlashMenu/SlashMenuPlugin'
import {hmBlockSchema} from './schema'
import {getSlashMenuItems} from './slash-menu-items'
import {isMobileDevice, useMobile} from './use-mobile'
import {createMediaBlock, handleDragMedia, selectAllEditorContent, serverBlockNodesFromEditorBlocks} from './utils'

function crawlEditorBlocks(blocks: EditorBlock[], filter: (block: EditorBlock) => boolean): EditorBlock[] {
  const matchedChildren = blocks.flatMap((block) => crawlEditorBlocks(block.children, filter))
  return [...matchedChildren, ...blocks.filter(filter)]
}

function collectSerializedMediaRefs(blocks: EditorBlock[]) {
  const mediaRefs: Record<string, string> = {}
  const mediaBlocks = crawlEditorBlocks(blocks, (block) => !!(block.props as any)?.mediaRef)

  for (const block of mediaBlocks) {
    const mediaRef = (block.props as any).mediaRef
    mediaRefs[block.id] = typeof mediaRef === 'string' ? mediaRef : JSON.stringify(mediaRef)
  }

  return mediaRefs
}

const [setGwUrl, gwUrl] = writeableStateStream<string>('https://hyper.media')

export function useCommentEditor(
  perspectiveAccountUid?: string | null | undefined,
  onSubmit?: () => void,
  onMobileMentionTrigger?: () => void,
  onMobileSlashTrigger?: () => void,
  importWebFile?: ImportWebFileFunction,
  handleFileAttachment?: HandleFileAttachmentFunction,
  universalClient?: UniversalClient,
  // Resolver that maps a hostname (e.g. eric.vicenti.net) to its Seed account UID.
  // Required so URLs pasted into embed/link inputs inside a comment can be
  // resolved to hm:// references instead of erroring as "not a hypermedia link".
  domainResolver?: (hostname: string) => Promise<string | null>,
  disableTrailingNode?: boolean,
  submitOnEnter?: boolean,
) {
  // Use refs so extensions created once by useBlockNote can access the latest callbacks.
  // useBlockNote only creates the editor on the first render, but these callbacks may
  // change (e.g., isMobile starts false due to SSR-safe useMedia initialization, then
  // becomes true after layout effect).
  const onSubmitRef = useRef<(() => void) | undefined>(onSubmit)
  onSubmitRef.current = onSubmit
  const onMobileMentionTriggerRef = useRef(onMobileMentionTrigger)
  onMobileMentionTriggerRef.current = onMobileMentionTrigger
  const onMobileSlashTriggerRef = useRef(onMobileSlashTrigger)
  onMobileSlashTriggerRef.current = onMobileSlashTrigger
  const editorRef = useRef<BlockNoteEditor<typeof hmBlockSchema> | null>(null)
  const submitOnEnterRef = useRef(submitOnEnter)
  submitOnEnterRef.current = submitOnEnter

  const editor = useBlockNote<typeof hmBlockSchema>({
    onEditorContentChange(editor: BlockNoteEditor<typeof hmBlockSchema>) {
      // console.log("editor content changed", editor.topLevelBlocks);
    },
    disableTrailingNode,
    linkExtensionOptions: {
      openOnClick: false,
      universalClient,
      gwUrl,
      domainResolver,
      onPasteHypermediaBlockFragment: (resolvedHmUrl: string) => {
        const ed = editorRef.current
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
      },
    },

    // onEditorReady: (e) => {
    //   readyEditor.current = e;
    //   initDraft();
    // },
    blockSchema: hmBlockSchema,
    getSlashMenuItems: () => getSlashMenuItems(),
    importWebFile,
    handleFileAttachment,
    _tiptapOptions: {
      extensions: [
        Extension.create({
          name: 'hypermedia-link',
          addProseMirrorPlugins() {
            return [createHypermediaDocLinkPlugin({domainResolver}).plugin]
          },
        }),
        Extension.create({
          name: 'comment-submit-shortcut',
          priority: 1000,
          addKeyboardShortcuts() {
            return {
              'Mod-a': ({editor}) => {
                return selectAllEditorContent(editor)
              },
              'Mod-Enter': () => {
                if (onSubmitRef.current) {
                  onSubmitRef.current()
                  return true
                }
                return false
              },
              Enter: ({editor}) => {
                if (!submitOnEnterRef.current) return false
                const slashState = slashMenuPluginKey.getState(editor.state) as {active?: boolean} | undefined
                const mentionState = mentionSuggestionPluginKey.getState(editor.state) as {active?: boolean} | undefined
                if (slashState?.active || mentionState?.active) return false
                if (onSubmitRef.current) {
                  onSubmitRef.current()
                  return true
                }
                return false
              },
            }
          },
        }),
        // Mobile-specific handlers for mentions and slash menu.
        Extension.create({
          name: 'mobile-dialog-triggers',
          priority: 2000,
          addProseMirrorPlugins() {
            return [
              new Plugin({
                key: new PluginKey('mobile-dialog-triggers'),
                props: {
                  handleKeyDown(view, event) {
                    if (!isMobileDevice()) return false

                    if (event.key === '@' && onMobileMentionTriggerRef.current) {
                      const {selection} = view.state
                      const $from = selection.$from
                      const textBeforeCursor = $from.parent.textContent.substring(0, $from.parentOffset)
                      const isAtStart = textBeforeCursor.length === 0
                      const isAfterSpace = textBeforeCursor.endsWith(' ')

                      if (isAtStart || isAfterSpace) {
                        onMobileMentionTriggerRef.current()
                        return true
                      }
                    }

                    if (event.key === '/' && onMobileSlashTriggerRef.current) {
                      const {selection} = view.state
                      const $from = selection.$from
                      const textBeforeCursor = $from.parent.textContent.substring(0, $from.parentOffset)
                      const isAtStart = textBeforeCursor.length === 0
                      const isAfterSpace = textBeforeCursor.endsWith(' ')

                      if (isAtStart || isAfterSpace) {
                        onMobileSlashTriggerRef.current()
                        return true
                      }
                    }

                    return false
                  },
                },
              }),
            ]
          },
        }),
      ],
    },
  })

  editorRef.current = editor

  return {
    editor,
  }
}

export interface CommentEditorProps {
  draft: Array<HMBlockNode>
  onSubmit: (content: Array<HMBlockNode>) => Promise<void>
  onDelete: (draftKey: string) => Promise<void>
  onMedia: () => Promise<void>
  /** Focus the editor on mount. Renamed from `autoFocus` to avoid the `jsx-a11y/no-autofocus` rule; focus is driven imperatively via effect. */
  focusOnMount?: boolean
  signer?: HMMetadata
}

/**
 * CommentEditor
 * props:
 * - draft: editorDraft if any
 * - onSubmit: async function that submits the comment
 *   - content: editor content
 *   -
 * - focusOnMount?: if we need to focus the editor right away (imperatively)
 * - onMedia: function that handles how we process images
 * when paste or included
 * - signer: account metadata for the signer to render avatar and name
 * - onDelete: function. self explanatory
 *
 * - logic:
 *   - load editor data depending if there's a draft already
 * with content or not
 *   - add listener to editor update to save editor I guess.
 *     maybe we can just pass the safeDraft function and call it here
 *   - focus editor if needed (focusOnMount?)
 *   - getContent function is defined here
 *   - handle cmd+A when the editor is focused
 *   - pass the function to handle Images when pasted or upload
 *     and call it inside the editor extension
 *   - render the editor right away
 *   -
 *
 */

export type CommentEditorSubmitHandle = {
  submit: () => void
  reset: () => void
  focus: (options?: {moveCursorToEnd?: boolean}) => void
  getContent: (
    prepareAttachments: (binaries: Uint8Array[]) => Promise<{
      blobs: {cid: string; data: Uint8Array}[]
      resultCIDs: string[]
    }>,
  ) => Promise<{
    blockNodes: HMBlockNode[]
    blobs: {cid: string; data: Uint8Array}[]
  }>
}

export function CommentEditor({
  submitButton,
  handleSubmit,
  account,
  focusOnMount,
  isReplying,
  perspectiveAccountUid,
  initialBlocks,
  onContentChange,
  onAvatarPress,
  importWebFile,
  handleFileAttachment,
  universalClient,
  getDraftMediaBlob,
  hideAvatar,
  hideSubmitToolbar,
  submitHandleRef,
  disableTrailingNode,
  submitOnEnter,
  domainResolver,
}: {
  submitButton: (opts: {
    reset: () => void
    getContent: (
      prepareAttachments: (binaries: Uint8Array[]) => Promise<{
        blobs: {cid: string; data: Uint8Array}[]
        resultCIDs: string[]
      }>,
    ) => Promise<{
      blockNodes: HMBlockNode[]
      blobs: {cid: string; data: Uint8Array}[]
    }>
  }) => JSX.Element
  handleSubmit: (
    getContent: (
      prepareAttachments: (binaries: Uint8Array[]) => Promise<{
        blobs: {cid: string; data: Uint8Array}[]
        resultCIDs: string[]
      }>,
    ) => Promise<{
      blockNodes: HMBlockNode[]
      blobs: {cid: string; data: Uint8Array}[]
    }>,
    reset: () => void,
  ) => void
  account?: ReturnType<typeof useAccount>['data']
  /** Focus the editor on mount, driven imperatively via effect. */
  focusOnMount?: boolean
  isReplying?: boolean
  perspectiveAccountUid?: string | null | undefined
  initialBlocks?: HMBlockNode[]
  onContentChange?: (blocks: HMBlockNode[], mediaRefs?: Record<string, string>) => void
  onAvatarPress?: () => void
  importWebFile?: ImportWebFileFunction
  handleFileAttachment?: HandleFileAttachmentFunction
  getDraftMediaBlob?: (draftId: string, mediaId: string) => Promise<Blob | null>
  /** Hide the leading avatar */
  hideAvatar?: boolean
  /** Hide the built-in footer toolbar when submit controls are rendered outside the editor. */
  hideSubmitToolbar?: boolean
  /** Exposes the current submit/getContent/reset handles for external submit controls. */
  submitHandleRef?: MutableRefObject<CommentEditorSubmitHandle | null>
  /** Disables the editor's automatic empty trailing paragraph for compact chat composers. */
  disableTrailingNode?: boolean
  /** Submits on plain Enter while allowing mention/slash menus to handle Enter first. */
  submitOnEnter?: boolean
  /** Optional resolver that maps a hostname to a Seed account UID, used when
   * pasting Hypermedia URLs in embed/link inputs nested inside this comment. */
  domainResolver?: (hostname: string) => Promise<string | null>
  universalClient?: UniversalClient
}) {
  const [submitTrigger, setSubmitTrigger] = useState(0)
  const submitCallbackRef = useRef<(() => void) | null>(null)
  const isMobile = useMobile()
  const [isMentionsDialogOpen, setIsMentionsDialogOpen] = useState(false)
  const [isSlashDialogOpen, setIsSlashDialogOpen] = useState(false)
  const toolbarRef = useRef<HTMLDivElement>(null)
  const contextUniversalClient = useUniversalClient()

  const {editor} = useCommentEditor(
    perspectiveAccountUid,
    () => setSubmitTrigger((prev) => prev + 1),
    isMobile ? () => setIsMentionsDialogOpen(true) : undefined,
    isMobile ? () => setIsSlashDialogOpen(true) : undefined,
    importWebFile,
    handleFileAttachment,
    universalClient ?? contextUniversalClient,
    domainResolver,
    disableTrailingNode,
    submitOnEnter,
  )
  // Check if we have non-empty draft content
  const hasDraftContent =
    initialBlocks &&
    initialBlocks.length > 0 &&
    initialBlocks.some((block) => {
      // Check if block has text content (for paragraph-like blocks)
      if ('text' in block.block && typeof block.block.text === 'string' && block.block.text.trim().length > 0) {
        return true
      }
      // Check if block has children
      if (block.children && block.children.length > 0) {
        return true
      }
      return false
    })
  const [isExpanded, setIsExpanded] = useState(() => focusOnMount || hasDraftContent || false)
  const openUrl = useOpenUrl()
  const [isDraggingOver, setIsDraggingOver] = useState(false)
  const tx = useTx()
  const isInitializedRef = useRef(false)
  const hasPendingContentChangeRef = useRef(false)
  const hasLocalEditsRef = useRef(false)
  const isApplyingInitialBlocksRef = useRef(false)
  const shouldFocusOnActivateRef = useRef(false)
  const shouldMoveCursorToEndOnFocusRef = useRef(false)
  const dragDepthRef = useRef(0)
  const pendingDropRef = useRef<{
    files: File[]
    dropTarget: 'append' | {clientX: number; clientY: number}
  } | null>(null)

  const reset = () => {
    editor.removeBlocks(editor.topLevelBlocks)
  }

  const focusEditor = ({moveCursorToEnd = false}: {moveCursorToEnd?: boolean} = {}) => {
    if (moveCursorToEnd) {
      editor._tiptapEditor.chain().focus('end').run()
      return
    }
    editor._tiptapEditor.commands.focus()
  }

  const activateEditor = ({
    moveCursorToEnd = false,
    focusOnActivate = true,
  }: {
    moveCursorToEnd?: boolean
    focusOnActivate?: boolean
  } = {}) => {
    shouldFocusOnActivateRef.current = focusOnActivate
    shouldMoveCursorToEndOnFocusRef.current = moveCursorToEnd
    setIsExpanded(true)
  }

  const getAppendInsertionPos = () => {
    return Math.max(0, editor._tiptapEditor.view.state.doc.content.size - 4)
  }

  const emitContentChangeNow = () => {
    if (!onContentChange) return

    try {
      // @ts-expect-error
      const editorBlocks: EditorBlock[] = editor.topLevelBlocks
      const mediaRefs = collectSerializedMediaRefs(editorBlocks)
      const blocks = serverBlockNodesFromEditorBlocks(editor, editorBlocks)
      onContentChange(
        blocks.map((b) => b.toJson()) as HMBlockNode[],
        Object.keys(mediaRefs).length > 0 ? mediaRefs : undefined,
      )
    } catch (error) {
      console.error('Failed to emit immediate content change:', error)
    }
  }

  const insertDroppedFiles = async ({
    files,
    dropTarget,
  }: {
    files: File[]
    dropTarget: 'append' | {clientX: number; clientY: number}
  }) => {
    const ttEditor = editor._tiptapEditor
    let insertionPos = getAppendInsertionPos()

    if (dropTarget !== 'append') {
      const posAtCoords = ttEditor.view.posAtCoords({
        left: dropTarget.clientX,
        top: dropTarget.clientY,
      })
      if (posAtCoords && posAtCoords.inside !== -1) {
        insertionPos = posAtCoords.pos
      }
    }

    let lastId: string | undefined

    for (const file of files) {
      const props = await handleDragMedia(file, handleFileAttachment)
      const blockNode = createMediaBlock(file, props)
      if (!blockNode) continue

      if (lastId) {
        ;(editor as BlockNoteEditor).insertBlocks(
          // @ts-expect-error
          [blockNode],
          lastId,
          'after',
        )
        lastId = blockNode.id
        continue
      }

      const blockInfo = getBlockInfoFromPos(ttEditor.view.state, insertionPos)
      ;(editor as BlockNoteEditor).insertBlocks(
        // @ts-expect-error
        [blockNode],
        blockInfo.block.node.attrs.id,
        'after',
      )
      lastId = blockNode.id
    }

    emitContentChangeNow()
  }

  const isFileDrag = (dataTransfer: DataTransfer | null | undefined) => {
    return !!dataTransfer && Array.from(dataTransfer.types || []).includes('Files')
  }

  const getDraggedFiles = (dataTransfer: DataTransfer | null | undefined) => {
    const files: File[] = []
    if (!dataTransfer) return files

    if (dataTransfer.files.length) {
      for (let i = 0; i < dataTransfer.files.length; i++) {
        const file = dataTransfer.files[i]
        if (file) files.push(file)
      }
      return files
    }

    for (let i = 0; i < dataTransfer.items.length; i++) {
      const dataItem = dataTransfer.items[i]
      if (!dataItem) continue
      const item = dataItem.getAsFile()
      if (item) files.push(item)
    }

    return files
  }

  const isPointInsideEditor = (clientX: number, clientY: number) => {
    const editorRect = editor._tiptapEditor.view.dom.getBoundingClientRect()
    return (
      clientX >= editorRect.left &&
      clientX <= editorRect.right &&
      clientY >= editorRect.top &&
      clientY <= editorRect.bottom
    )
  }

  // Initialize editor with draft content and rehydrate media
  useEffect(() => {
    if (!initialBlocks || initialBlocks.length === 0 || isInitializedRef.current || !editor) return
    if (hasLocalEditsRef.current) {
      isInitializedRef.current = true
      return
    }

    isInitializedRef.current = true

    const initializeWithRehydration = async () => {
      try {
        const editorBlocks = hmBlocksToEditorContent(initialBlocks, {
          childrenType: 'Group',
        })

        // Rehydrate media blocks from IndexedDB
        if (getDraftMediaBlob) {
          const rehydrateEditorBlocks = async (blocks: any[]): Promise<void> => {
            for (const block of blocks) {
              if (
                (block.type === 'image' || block.type === 'video' || block.type === 'file') &&
                block.props?.mediaRef
              ) {
                // Parse mediaRef from JSON string
                let mediaRef
                try {
                  mediaRef =
                    typeof block.props.mediaRef === 'string' ? JSON.parse(block.props.mediaRef) : block.props.mediaRef
                } catch (e) {
                  console.error('Failed to parse mediaRef:', e)
                  continue
                }

                const {draftId, mediaId} = mediaRef
                try {
                  const blob = await getDraftMediaBlob(draftId, mediaId)
                  if (blob) {
                    // Clear any old url and set a new blob url
                    block.props.url = ''
                    block.props.displaySrc = URL.createObjectURL(blob)
                  } else {
                    console.warn(`Media blob not found in IndexedDB for rehydration: ${draftId}/${mediaId}`)
                  }
                } catch (error) {
                  console.error(`Failed to rehydrate media ${mediaId}:`, error)
                }
              }

              // Process children recursively
              if (block.children && block.children.length > 0) {
                await rehydrateEditorBlocks(block.children)
              }
            }
          }

          await rehydrateEditorBlocks(editorBlocks)
        }

        if (hasLocalEditsRef.current) {
          return
        }

        isApplyingInitialBlocksRef.current = true
        editor.removeBlocks(editor.topLevelBlocks)
        // @ts-expect-error - EditorBlock type mismatch with BlockNote
        editor.replaceBlocks(editor.topLevelBlocks, editorBlocks)
        isApplyingInitialBlocksRef.current = false
      } catch (error) {
        isApplyingInitialBlocksRef.current = false
        console.error('Failed to initialize editor with draft content:', error)
      }
    }

    initializeWithRehydration()
  }, [initialBlocks, editor, getDraftMediaBlob])

  // Cleanup object URLs on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      // Revoke any blob URLs in the editor blocks on unmount
      if (editor && typeof window !== 'undefined') {
        try {
          const blocks = editor.topLevelBlocks
          const revokeFromBlock = (block: any) => {
            if (
              block.props?.displaySrc &&
              typeof block.props.displaySrc === 'string' &&
              block.props.displaySrc.startsWith('blob:')
            ) {
              try {
                URL.revokeObjectURL(block.props.displaySrc)
              } catch (error) {
                // URL might already be revoked
              }
            }
            if (block.children && Array.isArray(block.children)) {
              block.children.forEach(revokeFromBlock)
            }
          }
          blocks.forEach(revokeFromBlock)
        } catch (error) {
          // Editor might be in invalid state during unmount
          console.debug('Failed to revoke URLs on unmount:', error)
        }
      }
    }
  }, [editor])

  // Notify parent of content changes
  useEffect(() => {
    if (!onContentChange) return

    const handleChange = () => {
      hasPendingContentChangeRef.current = true
      if (!isApplyingInitialBlocksRef.current) {
        hasLocalEditsRef.current = true
      }
      emitContentChangeNow()
      hasPendingContentChangeRef.current = false
    }

    // Listen to editor changes
    editor._tiptapEditor.on('update', handleChange)

    return () => {
      editor._tiptapEditor.off('update', handleChange)
      if (hasPendingContentChangeRef.current) {
        emitContentChangeNow()
        hasPendingContentChangeRef.current = false
      }
    }
  }, [editor, onContentChange])

  useEffect(() => {
    if (hasDraftContent && !isExpanded) {
      shouldFocusOnActivateRef.current = false
      shouldMoveCursorToEndOnFocusRef.current = false
      setIsExpanded(true)
    }
  }, [hasDraftContent, isExpanded])

  useEffect(() => {
    if (focusOnMount) {
      setIsExpanded(true)
      shouldFocusOnActivateRef.current = true
    }
  }, [focusOnMount])

  useLayoutEffect(() => {
    if (!isExpanded || !shouldFocusOnActivateRef.current) return
    shouldFocusOnActivateRef.current = false
    focusEditor({moveCursorToEnd: shouldMoveCursorToEndOnFocusRef.current})
    shouldMoveCursorToEndOnFocusRef.current = false
  }, [editor, isExpanded])

  useEffect(() => {
    if (!isExpanded || !pendingDropRef.current) return

    const pendingDrop = pendingDropRef.current
    pendingDropRef.current = null
    const frameId = requestAnimationFrame(() => {
      void insertDroppedFiles(pendingDrop)
    })

    return () => cancelAnimationFrame(frameId)
  }, [editor, isExpanded])

  useEffect(() => {
    if (!onContentChange) return

    const editorDom = editor._tiptapEditor.view.dom
    const handleInsertedFileDrop = () => {
      emitContentChangeNow()
    }

    editorDom.addEventListener(FILE_DROP_INSERTED_EVENT, handleInsertedFileDrop)

    return () => {
      editorDom.removeEventListener(FILE_DROP_INSERTED_EVENT, handleInsertedFileDrop)
    }
  }, [editor, onContentChange])

  // Handle mobile keyboard - scroll toolbar into view when keyboard appears
  useLayoutEffect(() => {
    if (!isMobile || !isExpanded || !toolbarRef.current) return
    if (typeof window === 'undefined' || !window.visualViewport) return

    const viewport = window.visualViewport
    let initialHeight = viewport.height

    const handleViewportResize = () => {
      // Detect keyboard opening (viewport shrinks significantly)
      const heightDiff = initialHeight - viewport.height
      if (heightDiff > 100 && toolbarRef.current) {
        // Keyboard opened - scroll toolbar into view
        toolbarRef.current.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest',
        })
      }
    }

    // Also scroll into view when editor first gets focused
    const scrollTimeout = setTimeout(() => {
      if (toolbarRef.current) {
        toolbarRef.current.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest',
        })
      }
    }, 300)

    viewport.addEventListener('resize', handleViewportResize)

    return () => {
      clearTimeout(scrollTimeout)
      viewport.removeEventListener('resize', handleViewportResize)
    }
  }, [isMobile, isExpanded])

  const getContent = async (
    prepareAttachments: (binaries: Uint8Array[]) => Promise<{
      blobs: {cid: string; data: Uint8Array}[]
      resultCIDs: string[]
    }>,
  ) => {
    // @ts-expect-error
    const editorBlocks: EditorBlock[] = editor.topLevelBlocks

    // Collect blocks with fileBinary or mediaRef
    const blocksWithAttachments = crawlEditorBlocks(
      editorBlocks,
      // @ts-expect-error
      (block) => !!block.props?.fileBinary || !!block.props?.mediaRef,
    )

    // Prepare binaries for upload
    // TODO: decide if this should be removed
    const binariesToUpload: Uint8Array[] = []
    const blockToIndexMap = new Map<any, number>()

    for (const block of blocksWithAttachments) {
      // @ts-expect-error
      if (block.props?.fileBinary) {
        blockToIndexMap.set(block, binariesToUpload.length)
        // @ts-expect-error
        binariesToUpload.push(block.props.fileBinary)
      }
      // @ts-expect-error
      else if (block.props?.mediaRef && getDraftMediaBlob) {
        // Parse mediaRef from JSON string
        let mediaRef
        try {
          mediaRef =
            // @ts-expect-error - mediaRef exists on media blocks
            typeof block.props.mediaRef === 'string'
              ? // @ts-expect-error
                JSON.parse(block.props.mediaRef)
              : // @ts-expect-error
                block.props.mediaRef
        } catch (e) {
          console.error('Failed to parse mediaRef:', e)
          continue
        }

        const {draftId, mediaId} = mediaRef
        try {
          const blob = await getDraftMediaBlob(draftId, mediaId)
          if (blob) {
            const arrayBuffer = await blob.arrayBuffer()
            const binary = new Uint8Array(arrayBuffer)
            blockToIndexMap.set(block, binariesToUpload.length)
            binariesToUpload.push(binary)
          } else {
            console.warn(`Media not found: ${draftId}/${mediaId}`)
          }
        } catch (error) {
          console.error('Failed to load media:', error)
        }
      }
    }
    const {blobs, resultCIDs} = await prepareAttachments(binariesToUpload)

    // Update blocks with IPFS URLs and clean up temporary properties
    blocksWithAttachments.forEach((block) => {
      const index = blockToIndexMap.get(block)
      if (index !== undefined) {
        // @ts-expect-error
        block.props.url = `ipfs://${resultCIDs[index]}`
      } else {
        // Clear the block if failed to retrieve blob from IndexedDB. This avoids publishing corrupt image.
        console.error(`Cannot publish block ${block.id} - media not found in IndexedDB`)
        // @ts-expect-error
        block.props.url = ''
      }

      // Reset temporary properties to defaults instead of deleting,
      // because delete can leave undefined values that break CBOR encoding
      // @ts-expect-error
      block.props.fileBinary = ''
      // @ts-expect-error
      block.props.mediaRef = ''
      // @ts-expect-error
      block.props.displaySrc = ''
    })

    const blocks = serverBlockNodesFromEditorBlocks(editor, editorBlocks)
    const blockNodes = blocks.map((b) => b.toJson()) as HMBlockNode[]
    return {
      blockNodes,
      blobs,
    }
  }

  const handleImageClick = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*,video/*'
    input.multiple = true

    input.onchange = async (e) => {
      const files = Array.from((e.target as HTMLInputElement).files || [])
      if (files.length === 0) return

      const ttEditor = editor._tiptapEditor
      const pos = ttEditor.view.state.doc.content.size - 4

      for (const file of files) {
        const props = await handleDragMedia(file, handleFileAttachment)
        const blockNode = createMediaBlock(file, props)
        if (!blockNode) continue

        const blockInfo = getBlockInfoFromPos(ttEditor.view.state, pos)
        editor.insertBlocks(
          // @ts-expect-error
          [blockNode],
          blockInfo.block.node.attrs.id,
          'after',
        )
      }
    }

    input.click()
  }

  // Keep callback ref updated with latest getContent and reset
  submitCallbackRef.current = () => {
    editor._tiptapEditor.commands.blur()
    handleSubmit(getContent, reset)
  }
  if (submitHandleRef) {
    submitHandleRef.current = {
      submit: () => submitCallbackRef.current?.(),
      reset,
      focus: focusEditor,
      getContent,
    }
  }

  // Handle submit triggered by keyboard shortcut
  useEffect(() => {
    if (submitTrigger > 0) {
      submitCallbackRef.current?.()
    }
  }, [submitTrigger])

  useEffect(() => {
    return () => {
      if (submitHandleRef) submitHandleRef.current = null
    }
  }, [submitHandleRef])

  function onDrop(event: React.DragEvent<HTMLDivElement>) {
    if (!isFileDrag(event.dataTransfer)) return false

    const isDropInsideEditor = isExpanded && isPointInsideEditor(event.clientX, event.clientY)
    if (isDropInsideEditor) {
      dragDepthRef.current = 0
      setIsDraggingOver(false)
      return false
    }

    event.preventDefault()
    event.stopPropagation()

    dragDepthRef.current = 0
    setIsDraggingOver(false)

    const files = getDraggedFiles(event.dataTransfer)
    if (!files.length) return false

    if (!isExpanded) {
      pendingDropRef.current = {files, dropTarget: 'append'}
      activateEditor({focusOnActivate: false})
      return true
    }

    void insertDroppedFiles({files, dropTarget: 'append'})
    return true
  }

  if (!editor) {
    console.error('CommentEditor: editor is null/undefined')
    return (
      <div className="border-destructive bg-destructive/10 rounded border p-4">
        <p className="text-destructive text-sm">Error: Editor failed to initialize. Check console for details.</p>
      </div>
    )
  }

  return (
    <>
      <div className="flex w-full items-start gap-2">
        {hideAvatar ? null : (
          <div className="flex shrink-0 grow-0">
            {account?.metadata ? (
              <LinkIcon id={account.id} metadata={account.metadata} size={32} />
            ) : (
              <UIAvatar url={avatarPlaceholder} size={32} onPress={onAvatarPress} className="rounded-full" />
            )}
          </div>
        )}
        <div
          className={cn(
            'bg-muted w-full min-w-0 flex-1 rounded-lg border border-transparent transition-[filter,border-color,background-color]',
            isExpanded
              ? ''
              : 'hover:border-black/10 hover:brightness-[1.01] active:brightness-95 dark:hover:border-white/10',
            isDraggingOver &&
              'border-dashed border-black/20 bg-black/[0.03] brightness-100 dark:border-white/20 dark:bg-white/[0.04]',
          )}
          onDragEnter={(event) => {
            if (!isFileDrag(event.dataTransfer)) return
            if (isExpanded && isPointInsideEditor(event.clientX, event.clientY)) {
              dragDepthRef.current = 0
              setIsDraggingOver(false)
              return
            }
            event.preventDefault()
            dragDepthRef.current += 1
            setIsDraggingOver(true)
          }}
          onDragLeave={(event) => {
            if (!isFileDrag(event.dataTransfer)) return
            if (isExpanded && isPointInsideEditor(event.clientX, event.clientY)) {
              return
            }
            event.preventDefault()
            dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
            if (dragDepthRef.current === 0) {
              setIsDraggingOver(false)
            }
          }}
          onDragOver={(event) => {
            if (!isFileDrag(event.dataTransfer)) return
            if (isExpanded && isPointInsideEditor(event.clientX, event.clientY)) {
              if (isDraggingOver) {
                dragDepthRef.current = 0
                setIsDraggingOver(false)
              }
              return
            }
            event.preventDefault()
            event.dataTransfer.dropEffect = 'copy'
            setIsDraggingOver(true)
          }}
          onDrop={onDrop}
          onMouseDown={(e) => {
            const target = e.target as HTMLElement

            if (
              target.closest(
                'button, input, textarea, select, a, [role="button"], .ProseMirror, [contenteditable="true"]',
              )
            ) {
              return
            }

            e.preventDefault()
            e.stopPropagation()

            if (isExpanded) {
              focusEditor({moveCursorToEnd: true})
              return
            }

            activateEditor({moveCursorToEnd: true})
          }}
        >
          <div
            className={cn(
              'hm-prose is-comment comment-editor max-h-[160px] min-h-20 w-full min-w-0 flex-1 overflow-x-hidden overflow-y-auto md:max-h-full',
              isExpanded ? 'justify-start px-3 pt-1 pb-2' : 'justify-center',
            )}
            // marginTop="$1"

            // minHeight={isExpanded ? 105 : 40}
            // paddingHorizontal="$4"
            onClick={(e) => {
              const target = e.target as HTMLElement

              // Check if the clicked element is not an input, button, or textarea
              if (target.closest('input, textarea, select, button')) {
                return // Don't focus the editor in this case
              }
              e.stopPropagation()
              if (isExpanded) {
                focusEditor()
                return
              }
              activateEditor()
            }}
          >
            {isExpanded ? (
              <HyperMediaEditorView editor={editor} openUrl={openUrl} perspectiveAccountUid={perspectiveAccountUid} />
            ) : (
              <Button
                onClick={() => {
                  activateEditor()
                }}
                className={cn(
                  'text-muted-foreground m-0 h-auto min-h-8 w-full flex-1 items-center justify-start border-0 text-left text-base hover:bg-transparent focus:bg-transparent',
                  'plausible-event-name=Comment+Box+Click',
                )}
                variant="ghost"
                size="sm"
              >
                {tx(isReplying ? 'Write a Reply' : 'Start a Discussion')}
              </Button>
            )}
          </div>
          {isExpanded && !hideSubmitToolbar ? (
            <div ref={toolbarRef} className={cn('mx-2 mb-2 flex gap-2', isMobile ? 'justify-between' : 'justify-end')}>
              {isMobile && (
                <div className="flex items-center gap-2">
                  <Button size="icon" variant="ghost" className="size-8" onClick={() => setIsMentionsDialogOpen(true)}>
                    <AtSignIcon className="size-4" />
                  </Button>

                  <Button size="icon" variant="ghost" className="size-8" onClick={handleImageClick}>
                    <ImageIcon className="size-4" />
                  </Button>

                  <Button size="icon" variant="ghost" className="size-8" onClick={() => setIsSlashDialogOpen(true)}>
                    <SlashSquareIcon className="size-4" />
                  </Button>
                </div>
              )}

              <div className="flex gap-2">
                {submitButton({
                  reset,
                  getContent,
                })}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/* Mobile dialogs */}
      {isMobile && (
        <>
          <MobileMentionsDialog
            isOpen={isMentionsDialogOpen}
            onClose={() => setIsMentionsDialogOpen(false)}
            onSelect={(mention) => {
              const {state, schema} = editor._tiptapEditor
              const node = schema.nodes['inline-embed'].create({link: packReferenceUrl(mention.id)}, schema.text(' '))
              editor._tiptapEditor.view.dispatch(state.tr.replaceSelectionWith(node).scrollIntoView())
              setIsMentionsDialogOpen(false)
              setTimeout(() => editor._tiptapEditor.commands.focus(), 100)
            }}
            perspectiveAccountUid={perspectiveAccountUid}
          />
          <MobileSlashDialog isOpen={isSlashDialogOpen} onClose={() => setIsSlashDialogOpen(false)} editor={editor} />
        </>
      )}
    </>
  )
}
