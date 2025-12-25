import {EditorToggledStyle, HMBlockChildrenType} from '@shm/shared/hm-types'
import {Button} from '@shm/ui/button'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@shm/ui/select-dropdown'
import {Separator} from '@shm/ui/separator'
import {Tooltip} from '@shm/ui/tooltip'
import {cn} from '@shm/ui/utils'
import {useState} from 'react'
import {
  BlockNoteEditor,
  BlockSpec,
  getBlockInfoFromSelection,
  PropSchema,
  updateGroupCommand,
} from './blocknote/core'
import {getGroupInfoFromPos} from './blocknote/core/extensions/Blocks/helpers/getGroupInfoFromPos'
import {
  BlockTypeDropdownItem,
  FormattingToolbarProps,
  useEditorContentChange,
  useEditorSelectionChange,
} from './blocknote/react'
import {HMLinkToolbarButton} from './hm-toolbar-link-button'
import {MobileLinkToolbarButton} from './mobile-link-toolbar-button'
import {MobileTextMarkerDialog} from './mobile-text-marker-dialog'
import {MobileTextTypeDialog} from './mobile-text-type-dialog'
import {useMobile} from './use-mobile'

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

const groupTypeOptions = [
  {label: 'No Marker', value: 'Group'},
  {label: 'Bullets', value: 'Unordered'},
  {label: 'Numbers', value: 'Ordered'},
  {label: 'Block Quote', value: 'Blockquote'},
]

const textTypeOptions = [
  {label: 'Heading', value: 'heading'},
  {label: 'Paragraph', value: 'paragraph'},
  {label: 'Code Block', value: 'code-block'},
]

export function HMFormattingToolbar<
  Schema extends Record<string, BlockSpec<string, PropSchema>>,
>(
  props: FormattingToolbarProps<Schema> & {
    blockTypeDropdownItems?: BlockTypeDropdownItem[]
  },
) {
  const [currentGroupType, setCurrentGroupType] = useState<string>('Group')
  const [currentBlockType, setCurrentBlockType] = useState<string>('paragraph')
  const [isTextMarkerDialogOpen, setIsTextMarkerDialogOpen] = useState(false)
  const [isTextTypeDialogOpen, setIsTextTypeDialogOpen] = useState(false)
  const isMobile = useMobile()

  useEditorSelectionChange(props.editor, () => {
    const tiptap = props.editor._tiptapEditor
    const {state} = tiptap

    try {
      const groupInfo = getGroupInfoFromPos(state.selection.from, state)
      setCurrentGroupType(groupInfo.group.attrs.listType || 'Group')
    } catch {
      setCurrentGroupType('Group')
    }

    try {
      const blockInfo = getBlockInfoFromSelection(state)
      setCurrentBlockType(blockInfo.blockContentType || 'paragraph')
    } catch {
      setCurrentBlockType('paragraph')
    }
  })

  const handleTextMarkerChange = (listType: string) => {
    if (listType !== currentGroupType) {
      const tiptap = props.editor._tiptapEditor
      const {state} = tiptap
      const {$pos} = getGroupInfoFromPos(state.selection.from, state)
      tiptap.commands.command(
        updateGroupCommand(
          $pos.pos,
          listType as HMBlockChildrenType,
          false,
          false,
          true,
        ),
      )
      setCurrentGroupType(listType)
    }
    setIsTextMarkerDialogOpen(false)
  }

  const handleTextTypeChange = (blockType: string) => {
    if (blockType !== currentBlockType) {
      const tiptap = props.editor._tiptapEditor
      const {state} = tiptap
      const blockInfo = getBlockInfoFromSelection(state)
      props.editor.updateBlock(blockInfo.block.node.attrs.id, {
        type: blockType,
        props: {},
      })
      setCurrentBlockType(blockType)
    }
    setIsTextTypeDialogOpen(false)
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
        <div className="text-foreground flex w-full items-center justify-stretch gap-1">
          {toggleStyles.map((item) => (
            <ToggleStyleButton
              key={item.style}
              editor={props.editor}
              toggleStyle={item.style}
              {...item}
            />
          ))}

          {/* Link button - different for mobile/desktop */}
          {isMobile ? (
            <MobileLinkToolbarButton editor={props.editor} />
          ) : (
            <div className="relative">
              <HMLinkToolbarButton
                editor={props.editor}
                data-testid="link-button"
              />
            </div>
          )}

          <Separator vertical className="bg-foreground mx-1 h-6 opacity-50" />

          {/* Text marker - dropdown on desktop, dialog on mobile */}
          {isMobile ? (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-9 w-9 shrink-0 hover:bg-black/10 dark:hover:bg-white/10"
              onClick={() => setIsTextMarkerDialogOpen(true)}
            >
              <UnorderedList className="size-4" />
            </Button>
          ) : (
            <FormatDropdown
              testId="group-type-dropdown"
              value={currentGroupType}
              onChange={(listType) => {
                if (listType !== currentGroupType) {
                  const tiptap = props.editor._tiptapEditor
                  const {state} = tiptap
                  const {$pos} = getGroupInfoFromPos(
                    state.selection.from,
                    state,
                  )
                  tiptap.commands.command(
                    updateGroupCommand(
                      $pos.pos,
                      listType as HMBlockChildrenType,
                      false,
                      false,
                      true,
                    ),
                  )
                  setCurrentGroupType(listType)
                }
              }}
              options={groupTypeOptions}
            />
          )}

          {/* Text type - dropdown on desktop, dialog on mobile */}
          {isMobile ? (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-9 w-9 shrink-0 hover:bg-black/10 dark:hover:bg-white/10"
              onClick={() => setIsTextTypeDialogOpen(true)}
            >
              <Type className="size-4" />
            </Button>
          ) : (
            <FormatDropdown
              testId="block-type-dropdown"
              value={currentBlockType}
              onChange={(blockType) => {
                if (blockType !== currentBlockType) {
                  const tiptap = props.editor._tiptapEditor
                  const {state} = tiptap
                  const blockInfo = getBlockInfoFromSelection(state)
                  props.editor.updateBlock(blockInfo.block.node.attrs.id, {
                    type: blockType,
                    props: {},
                  })
                  setCurrentBlockType(blockType)
                }
              }}
              options={textTypeOptions}
            />
          )}
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

function ToggleStyleButton<
  Schema extends Record<string, BlockSpec<string, PropSchema>>,
>({
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
  const [active, setActive] = useState<boolean>(
    toggleStyle in editor.getActiveStyles(),
  )

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

function FormatDropdown({
  value,
  onChange,
  options,
  testId,
}: {
  value: string
  onChange: (val: string) => void
  options: {label: string; value: string}[]
  testId: string
}) {
  return (
    <div className="flex items-center">
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger data-testid={testId}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem
              key={option.value}
              value={option.value}
              className="format-toolbar-item"
            >
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
