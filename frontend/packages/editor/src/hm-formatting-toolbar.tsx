import {
  BlockNoteEditor,
  BlockSpec,
  getBlockInfoFromSelection,
  PropSchema,
  updateGroupCommand,
} from '@/blocknote/core'
import {
  BlockTypeDropdownItem,
  FormattingToolbarProps,
  useEditorContentChange,
  useEditorSelectionChange,
} from '@/blocknote/react'
import {HMLinkToolbarButton} from '@/hm-toolbar-link-button'
import {EditorToggledStyle} from '@shm/shared/hm-types'
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
import {SelectDropdown} from '@shm/ui/select-dropdown'
import {Separator} from '@shm/ui/separator'
import {Tooltip} from '@shm/ui/tooltip'
import {cn} from '@shm/ui/utils'
import {useState} from 'react'
import {SizeTokens, XGroup, XStack} from 'tamagui'
import {getGroupInfoFromPos} from './blocknote/core/extensions/Blocks/helpers/getGroupInfoFromPos'

const size: SizeTokens = '$3'

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

  return (
    <div className="border-border bg-background w-fit rounded-md border px-2 py-1 shadow-md">
      <XGroup alignItems="center" gap="$1" className="h-full">
        {toggleStyles.map((item) => (
          <ToggleStyleButton
            key={item.style}
            editor={props.editor}
            toggleStyle={item.style}
            {...item}
          />
        ))}
        <HMLinkToolbarButton editor={props.editor} size={size} />

        <Separator vertical className="mx-1" />

        <XGroup.Item>
          <FormatDropdown
            value={currentGroupType}
            onChange={(listType) => {
              if (listType !== currentGroupType) {
                const tiptap = props.editor._tiptapEditor
                const {state} = tiptap
                const {$pos} = getGroupInfoFromPos(state.selection.from, state)
                tiptap.commands.command(
                  updateGroupCommand($pos.pos, listType, false, false, true),
                )

                setCurrentGroupType(listType)
              }
            }}
            options={groupTypeOptions}
          />
        </XGroup.Item>

        <XGroup.Item>
          <FormatDropdown
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
        </XGroup.Item>
      </XGroup>
    </div>
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
    <XGroup.Item>
      <Tooltip content={name}>
        <Button
          size="icon"
          variant="ghost"
          className={cn(
            'hover:bg-black/10 dark:hover:bg-white/10',
            'focus:bg-black/10 dark:focus:bg-white/10',
            active &&
              'bg-black text-white hover:bg-black/9 hover:text-white dark:bg-white dark:text-black dark:hover:bg-white/90',
          )}
          onClick={() => handlePress(toggleStyle)}
        >
          {icon}
        </Button>
      </Tooltip>
    </XGroup.Item>
  )
}

function FormatDropdown({
  value,
  onChange,
  options,
}: {
  value: string
  onChange: (val: string) => void
  options: {label: string; value: string}[]
}) {
  return (
    <XStack alignItems="center">
      <SelectDropdown
        value={value}
        options={options}
        onValue={onChange}
        width="100%"
        size="$2"
        triggerProps={{
          backgroundColor: 'transparent',
          borderRadius: '$2',
          borderColor: 'transparent',
          hoverStyle: {backgroundColor: '$color4'},
        }}
      />
    </XStack>
  )
}
