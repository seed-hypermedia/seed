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
import {useState} from 'react'
import {SizeTokens, Theme, Tooltip, XGroup, XStack} from 'tamagui'
import {getGroupInfoFromPos} from './blocknote/core/extensions/Blocks/helpers/getGroupInfoFromPos'

const size: SizeTokens = '$3'

const toggleStyles = [
  {
    name: 'Bold (Mod+B)',
    icon: Strong,
    style: 'bold' as EditorToggledStyle,
  },
  {
    name: 'Italic (Mod+I)',
    icon: Emphasis,
    style: 'italic' as EditorToggledStyle,
  },
  {
    name: 'Underline (Mod+U)',
    icon: Underline,
    style: 'underline' as EditorToggledStyle,
  },
  {
    name: 'Strikethrough (Mod+Shift+X)',
    icon: Strikethrough,
    style: 'strike' as EditorToggledStyle,
  },
  {
    name: 'Code (Mod+E)',
    icon: Code,
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
    icon: HeadingIcon,
  },
  {
    name: 'Bullet List',
    type: 'bulletListItem',
    icon: UnorderedList,
  },
  {
    name: 'Numbered List',
    type: 'numberedListItem',
    icon: OrderedList,
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
    <XStack
      borderRadius="$4"
      borderWidth="$1"
      borderColor="$color4"
      backgroundColor="$background"
      padding="$1"
      shadowColor="$shadowColor"
      shadowOffset={{width: 0, height: 2}}
      shadowOpacity={0.1}
      shadowRadius={4}
      elevation={4}
      width="fit-content"
    >
      <XGroup alignItems="center">
        {toggleStyles.map((item) => (
          <ToggleStyleButton
            key={item.style}
            editor={props.editor}
            toggleStyle={item.style}
            {...item}
          />
        ))}
        <HMLinkToolbarButton editor={props.editor} size={size} />

        <XStack
          width={1}
          height="80%"
          backgroundColor="$color11"
          marginHorizontal="$2"
          alignSelf="center"
          borderRadius="$full"
        />

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
    </XStack>
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
    <Theme>
      <XGroup.Item>
        <Tooltip content={name}>
          <Button
            height="100%"
            background={active ? '$color11' : 'transparent'}
            color={active ? '$background' : undefined}
            size={size}
            borderRadius="$3"
            icon={icon}
            onPress={() => handlePress(toggleStyle)}
            hoverStyle={{
              backgroundColor: active ? '$color9' : '$color4',
            }}
          />
        </Tooltip>
      </XGroup.Item>
    </Theme>
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
        size="$3"
        triggerProps={{
          backgroundColor: 'transparent',
          borderRadius: '$3',
          borderColor: 'transparent',
          hoverStyle: {backgroundColor: '$color4'},
        }}
      />
    </XStack>
  )
}
