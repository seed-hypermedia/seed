import {editorBlocksToHMBlockNodes} from '@seed-hypermedia/client/editorblock-to-hmblock'
import {EditorToggledStyle, HMBlockChildrenType, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {Button} from '@shm/ui/button'
import {Popover, PopoverContent, PopoverTrigger} from '@shm/ui/components/popover'
import {
  Code,
  Emphasis,
  HeadingIcon,
  OrderedList,
  Strikethrough,
  Strong,
  Type,
  Underline,
  UnorderedList,
} from '@shm/ui/icons'
import {Tooltip} from '@shm/ui/tooltip'
import {usePopoverState} from '@shm/ui/use-popover-state'
import {cn} from '@shm/ui/utils'
import {ChevronDown, FileText, Link, ListChecks, MessageSquare} from 'lucide-react'
import {useState} from 'react'
import {BlockNoteEditor, BlockSpec, getBlockInfoFromSelection, PropSchema, updateGroupCommand} from './blocknote/core'
import {getNearestBlockPos} from './blocknote/core/extensions/Blocks/helpers/getBlockInfoFromPos'
import {getGroupInfoFromPos} from './blocknote/core/extensions/Blocks/helpers/getGroupInfoFromPos'
import {
  BlockTypeDropdownItem,
  FormattingToolbarProps,
  useEditorContentChange,
  useEditorSelectionChange,
} from './blocknote/react'
import {useDraftActions} from './draft-actions-context'
import {useFragmentActions} from './fragment-actions-context'
import {HMLinkToolbarButton} from './hm-toolbar-link-button'
import {MobileLinkToolbarButton} from './mobile-link-toolbar-button'
import {MobileTextMarkerDialog} from './mobile-text-marker-dialog'
import {MobileTextTypeDialog} from './mobile-text-type-dialog'
import {StyleOptionsPanel} from './style-options-panel'
import {TOOLBAR_COLOR_NAMES, type ToolbarColorName} from './toolbar-color-palette'
import {deriveDraftNameFromBlocks, getSelectedFullBlocks, replaceBlocksWithDraftEmbed} from './turn-into-doc'
import {useMobile} from './use-mobile'

/**
 * Ensures a grid has at least columnCount number of children.
 */
function fillGridChildren(tiptap: any, columnCount: number) {
  setTimeout(() => {
    tiptap.commands.command(({state, dispatch}: {state: any; dispatch: any}) => {
      if (!dispatch) return true
      const {group, $pos, depth} = getGroupInfoFromPos(state.selection.from, state)
      if (group.attrs.listType !== 'Grid') return true
      const currentCount = group.childCount
      if (currentCount >= columnCount) return true
      const schema = state.schema
      const tr = state.tr
      // Insert position: just before the closing of the blockChildren node
      const groupStart = $pos.before(depth) + 1 // inside blockChildren
      const insertPos = groupStart + group.content.size
      for (let i = 0; i < columnCount - currentCount; i++) {
        const para = schema.nodes['paragraph'].create()
        const blockNode = schema.nodes['blockNode'].create({}, para)
        tr.insert(insertPos + i * blockNode.nodeSize, blockNode)
      }
      dispatch(tr)
      return true
    })
  })
}

/**
 * Computes blockId, rangeStart, rangeEnd from the current editor selection.
 * Returns null if the selection spans multiple blocks or is empty.
 */
function getSelectionFragment(editor: BlockNoteEditor<any>): {
  blockId: string
  rangeStart: number
  rangeEnd: number
} | null {
  const view = editor._tiptapEditor.view
  const {state} = view
  const {selection} = state

  if (selection.empty) return null

  const {$from, $to} = selection
  const from = $from.pos
  const to = $to.pos

  let blockNode: import('prosemirror-model').Node
  let blockBeforePos: number

  try {
    const posInfo = getNearestBlockPos(state.doc, from)
    blockNode = posInfo.node
    blockBeforePos = posInfo.posBeforeNode
  } catch {
    return null
  }

  // Only single-block selections.
  try {
    const endInfo = getNearestBlockPos(state.doc, to)
    if (endInfo.posBeforeNode !== blockBeforePos) return null
  } catch {
    return null
  }

  const blockId: string = blockNode.attrs?.id ?? ''
  if (!blockId) return null

  // Find blockContent start position.
  let blockContentBeforePos = blockBeforePos
  blockNode.forEach((child, offset) => {
    if (child.type.spec.group === 'block') {
      blockContentBeforePos = blockBeforePos + offset + 1
    }
  })

  const rangeStart = posToBlockTextOffset(state, from, blockContentBeforePos)
  const rangeEnd = posToBlockTextOffset(state, to, blockContentBeforePos)

  return {blockId, rangeStart, rangeEnd}
}

/** Converts a ProseMirror position to a codepoint offset within the block's text. */
function posToBlockTextOffset(
  state: import('prosemirror-state').EditorState,
  docPos: number,
  blockContentBeforePos: number,
): number {
  const blockContentNode = state.doc.resolve(blockContentBeforePos + 1).parent
  const offsetWithinContent = docPos - (blockContentBeforePos + 1)

  let codepoints = 0
  let remaining = offsetWithinContent

  blockContentNode.forEach((node, nodeOffset) => {
    if (remaining <= 0) return
    if (node.isText && node.text) {
      const nodeEnd = nodeOffset + node.nodeSize
      if (nodeOffset < remaining && remaining <= nodeEnd) {
        const slice = node.text.slice(0, remaining - nodeOffset)
        codepoints += Array.from(slice).length
        remaining = 0
      } else if (nodeOffset < remaining) {
        codepoints += Array.from(node.text).length
        remaining -= node.nodeSize
      }
    } else {
      if (nodeOffset < remaining) {
        codepoints += 1
        remaining -= node.nodeSize
      }
    }
  })

  return codepoints
}

const toggleStyles = [
  {
    name: 'Bold (Mod+B)',
    icon: <Strong className="size-4" />,
    style: 'bold' as EditorToggledStyle,
  },
  {
    name: 'Italic (Mod+I)',
    icon: <Emphasis className="size-4" />,
    style: 'italic' as EditorToggledStyle,
  },

  {
    name: 'Underline (Mod+U)',
    icon: <Underline className="size-4" />,
    style: 'underline' as EditorToggledStyle,
  },
  {
    name: 'Strikethrough (Mod+Shift+X)',
    icon: <Strikethrough className="size-4" />,
    style: 'strike' as EditorToggledStyle,
  },
  {
    name: 'Code (Mod+E)',
    icon: <Code className="size-4" />,
    style: 'code' as EditorToggledStyle,
  },
]

export const blockDropdownItems: BlockTypeDropdownItem[] = [
  {
    name: 'Paragraph',
    type: 'paragraph',
    icon: Type,
  },
  {
    name: 'Heading',
    type: 'heading',
    icon: <HeadingIcon className="size-4" />,
  },
  {
    name: 'Bullet List',
    type: 'bulletListItem',
    icon: <UnorderedList className="size-4" />,
  },
  {
    name: 'Numbered List',
    type: 'numberedListItem',
    icon: <OrderedList className="size-4" />,
  },
]

function normalizeColorName(value: unknown): ToolbarColorName {
  if (typeof value !== 'string') return 'default'
  return (TOOLBAR_COLOR_NAMES as readonly string[]).includes(value) ? (value as ToolbarColorName) : 'default'
}

export function HMFormattingToolbar<Schema extends Record<string, BlockSpec<string, PropSchema>>>(
  props: FormattingToolbarProps<Schema> & {
    blockTypeDropdownItems?: BlockTypeDropdownItem[]
    // Current document id for the "Turn into doc" button
    docId?: UnpackedHypermediaId
  },
) {
  const fragmentActions = useFragmentActions()
  const draftActions = useDraftActions()
  const onCreateInlineDraft = draftActions?.onCreateInlineDraft
  const canTurnIntoDoc = !!(props.docId && onCreateInlineDraft)
  const [currentGroupType, setCurrentGroupType] = useState<string>('Group')
  const [currentColumnCount, setCurrentColumnCount] = useState<string>('3')
  const [currentBlockType, setCurrentBlockType] = useState<string>('paragraph')
  const [currentTextColor, setCurrentTextColor] = useState<ToolbarColorName>('default')
  const [currentBackgroundColor, setCurrentBackgroundColor] = useState<ToolbarColorName>('default')
  const [isTextMarkerDialogOpen, setIsTextMarkerDialogOpen] = useState(false)
  const [isTextTypeDialogOpen, setIsTextTypeDialogOpen] = useState(false)
  const stylePopover = usePopoverState()
  const isMobile = useMobile()

  useEditorSelectionChange(props.editor, () => {
    const tiptap = props.editor._tiptapEditor
    const {state} = tiptap

    try {
      const groupInfo = getGroupInfoFromPos(state.selection.from, state)
      setCurrentGroupType(groupInfo.group.attrs.listType || 'Group')
      setCurrentColumnCount(String(groupInfo.group.attrs.columnCount || 3))
    } catch {
      setCurrentGroupType('Group')
      setCurrentColumnCount('3')
    }

    try {
      const blockInfo = getBlockInfoFromSelection(state)
      setCurrentBlockType(blockInfo.blockContentType || 'paragraph')
    } catch {
      setCurrentBlockType('paragraph')
    }

    const activeStyles = props.editor.getActiveStyles()
    setCurrentTextColor(normalizeColorName(activeStyles.textColor))
    setCurrentBackgroundColor(normalizeColorName(activeStyles.backgroundColor))
  })

  useEditorContentChange(props.editor, () => {
    const activeStyles = props.editor.getActiveStyles()
    setCurrentTextColor(normalizeColorName(activeStyles.textColor))
    setCurrentBackgroundColor(normalizeColorName(activeStyles.backgroundColor))
  })

  const handleGroupTypeChange = (listType: string) => {
    if (listType === currentGroupType) return
    const tiptap = props.editor._tiptapEditor
    const {state} = tiptap
    const {$pos, group} = getGroupInfoFromPos(state.selection.from, state)
    tiptap.commands.command(updateGroupCommand($pos.pos, listType as HMBlockChildrenType, false, false, true))
    if (listType === 'Grid') {
      const colCount = group.attrs.columnCount || 3
      if (!group.attrs.columnCount) {
        const info = getGroupInfoFromPos(tiptap.state.selection.from, tiptap.state)
        const tr = tiptap.state.tr
        tr.setNodeAttribute(info.$pos.before(info.depth), 'columnCount', colCount)
        tiptap.view.dispatch(tr)
      }
      setCurrentColumnCount(String(colCount))
      fillGridChildren(tiptap, colCount)
    }
    setCurrentGroupType(listType)
  }

  const handleColumnCountChange = (colCount: string) => {
    if (colCount === currentColumnCount) return
    const tiptap = props.editor._tiptapEditor
    const {$pos, depth} = getGroupInfoFromPos(tiptap.state.selection.from, tiptap.state)
    const newCount = parseInt(colCount, 10)
    const tr = tiptap.state.tr
    tr.setNodeAttribute($pos.before(depth), 'columnCount', newCount)
    tiptap.view.dispatch(tr)
    setCurrentColumnCount(colCount)
    fillGridChildren(tiptap, newCount)
  }

  const handleBlockTypeChange = (blockType: string) => {
    if (blockType === currentBlockType) return
    const tiptap = props.editor._tiptapEditor
    const {state} = tiptap
    const blockInfo = getBlockInfoFromSelection(state)
    props.editor.updateBlock(blockInfo.block.node.attrs.id, {
      type: blockType,
      props: {},
    })
    setCurrentBlockType(blockType)
  }

  const handleTextMarkerChange = (listType: string) => {
    handleGroupTypeChange(listType)
    setIsTextMarkerDialogOpen(false)
  }

  const handleTextTypeChange = (blockType: string) => {
    handleBlockTypeChange(blockType)
    setIsTextTypeDialogOpen(false)
  }

  /**
   * Snapshot the selected blocks, create a new child draft
   * seeded with that content, then replace the source blocks
   * with a single draft-embed in place. Bails out on failure
   * without touching the parent so the user never loses content.
   */
  const handleTurnIntoDoc = async () => {
    if (!props.docId || !onCreateInlineDraft) return
    const blocks = getSelectedFullBlocks(props.editor)
    if (!blocks || blocks.length === 0) return

    let initialContent
    try {
      initialContent = editorBlocksToHMBlockNodes(blocks as any)
    } catch (err) {
      console.error('[turn-into-doc] failed to serialize selected blocks:', err)
      return
    }

    const name = deriveDraftNameFromBlocks(blocks)

    try {
      const {draftId} = await onCreateInlineDraft(props.docId, {initialContent, name})
      replaceBlocksWithDraftEmbed(props.editor, blocks, draftId)
    } catch (err) {
      console.error('[turn-into-doc] failed to create inline draft:', err)
    }
  }

  return (
    <>
      <div
        data-testid="formatting-toolbar"
        className="border-border bg-background z-50 w-fit rounded-md border p-1 shadow-md"
        onPointerDown={(e) => {
          e.preventDefault()
          e.stopPropagation()
        }}
      >
        <div className="text-foreground flex flex-col gap-1">
          {/* Row 1 - inline marks and fragment actions */}
          <div className="flex items-center gap-1">
            {toggleStyles.map((item) => (
              <ToggleStyleButton key={item.style} editor={props.editor} toggleStyle={item.style} {...item} />
            ))}

            {/* Link button - different for mobile/desktop */}
            {isMobile ? (
              <MobileLinkToolbarButton editor={props.editor} />
            ) : (
              <div className="relative">
                <HMLinkToolbarButton editor={props.editor} testId="link-button" />
              </div>
            )}

            {/* Fragment actions (only when a published version exists).
                Per design: no separator from the marks, and these buttons
                are borderless to read as "secondary" icons. */}
            {fragmentActions && (
              <>
                <Tooltip content="Comment">
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="rounded-md hover:bg-black/10 dark:hover:bg-white/10"
                    onClick={() => {
                      const frag = getSelectionFragment(props.editor)
                      if (frag) fragmentActions.onComment(frag.blockId, frag.rangeStart, frag.rangeEnd)
                    }}
                  >
                    <MessageSquare className="size-4" />
                  </Button>
                </Tooltip>
                <Tooltip content="Copy Link">
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="rounded-md hover:bg-black/10 dark:hover:bg-white/10"
                    onClick={() => {
                      const frag = getSelectionFragment(props.editor)
                      if (frag) fragmentActions.onCopyFragmentLink(frag.blockId, frag.rangeStart, frag.rangeEnd)
                    }}
                  >
                    <Link className="size-4" />
                  </Button>
                </Tooltip>
              </>
            )}
          </div>

          {/* Row 2 - Style options and Turn into doc */}
          <div className="flex items-center gap-2">
            {isMobile ? (
              <>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-9 w-9 shrink-0 hover:bg-black/10 dark:hover:bg-white/10"
                  onClick={() => setIsTextMarkerDialogOpen(true)}
                >
                  <UnorderedList className="size-4" />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-9 w-9 shrink-0 hover:bg-black/10 dark:hover:bg-white/10"
                  onClick={() => setIsTextTypeDialogOpen(true)}
                >
                  <Type className="size-4" />
                </Button>
              </>
            ) : (
              <Popover {...stylePopover}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    data-testid="style-options-trigger"
                    className="h-9 gap-1.5 rounded-md border border-black/10 px-3 text-sm font-normal hover:bg-black/10 dark:border-white/10 dark:hover:bg-white/10"
                  >
                    <ListChecks className="size-4" />
                    <span>Style options</span>
                    <ChevronDown className="size-3.5 opacity-60" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  side="bottom"
                  align="start"
                  sideOffset={8}
                  collisionPadding={8}
                  onOpenAutoFocus={(e) => e.preventDefault()}
                  onCloseAutoFocus={(e) => e.preventDefault()}
                  className="bg-background w-[22rem] max-w-[92vw] p-3"
                >
                  <StyleOptionsPanel
                    editor={props.editor}
                    currentBlockType={currentBlockType}
                    currentGroupType={currentGroupType}
                    currentColumnCount={currentColumnCount}
                    currentTextColor={currentTextColor}
                    currentBackgroundColor={currentBackgroundColor}
                    onBlockTypeChange={handleBlockTypeChange}
                    onGroupTypeChange={handleGroupTypeChange}
                    onColumnCountChange={handleColumnCountChange}
                  />
                </PopoverContent>
              </Popover>
            )}

            {!isMobile && canTurnIntoDoc && (
              <Tooltip content="Move selected blocks into a new child document">
                <Button
                  type="button"
                  variant="ghost"
                  data-testid="turn-into-doc-button"
                  className="h-9 gap-1.5 rounded-md border border-black/10 px-3 text-sm font-normal hover:bg-black/10 dark:border-white/10 dark:hover:bg-white/10"
                  onClick={handleTurnIntoDoc}
                >
                  <FileText className="size-4" />
                  <span>Turn into doc</span>
                </Button>
              </Tooltip>
            )}
          </div>
        </div>
      </div>

      {/* Mobile dialogs */}
      {isMobile && (
        <>
          <MobileTextMarkerDialog
            isOpen={isTextMarkerDialogOpen}
            onClose={() => setIsTextMarkerDialogOpen(false)}
            currentValue={currentGroupType}
            onChange={handleTextMarkerChange}
          />
          <MobileTextTypeDialog
            isOpen={isTextTypeDialogOpen}
            onClose={() => setIsTextTypeDialogOpen(false)}
            currentValue={currentBlockType}
            onChange={handleTextTypeChange}
          />
        </>
      )}
    </>
  )
}

function ToggleStyleButton<Schema extends Record<string, BlockSpec<string, PropSchema>>>({
  editor,
  toggleStyle,

  name,
  icon,
}: {
  editor: BlockNoteEditor<Schema>
  toggleStyle: EditorToggledStyle
  name: string
  icon: any
}) {
  const [active, setActive] = useState<boolean>(toggleStyle in editor.getActiveStyles())

  function toggleCurrentStyle() {
    setActive(toggleStyle in editor.getActiveStyles())
  }

  useEditorContentChange(editor, toggleCurrentStyle)
  useEditorSelectionChange(editor, toggleCurrentStyle)

  function handlePress(style: EditorToggledStyle) {
    editor.focus()
    editor.toggleStyles({[toggleStyle]: true})
  }

  return (
    <Tooltip content={name}>
      <Button
        data-testid={`${toggleStyle}-button`}
        type="button"
        size="icon"
        variant="ghost"
        className={cn(
          'rounded-md border border-black/10 dark:border-white/10',
          'hover:bg-black/10 dark:hover:bg-white/10',
          'focus:bg-black/10 dark:focus:bg-white/10',
          'format-toolbar-item',
          active &&
            'bg-black text-white hover:bg-black/80 hover:text-white dark:bg-white dark:text-black dark:hover:bg-white/90 dark:hover:text-white',
        )}
        onClick={() => {
          console.log('toggleStyle', toggleStyle)
          handlePress(toggleStyle)
        }}
      >
        {icon}
      </Button>
    </Tooltip>
  )
}
