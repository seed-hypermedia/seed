import {useOpenUrl} from '@/open-url'
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Button,
  Label,
  Popover,
  SizableText,
  usePopoverState,
  XStack,
  YStack,
} from '@shm/ui'
import {useState} from 'react'
import {
  Block,
  BlockNoteEditor,
  createReactBlockSpec,
  defaultProps,
  useEditorSelectionChange,
} from './blocknote'
import {HypermediaLinkSwitchToolbar} from './hm-link-switch-toolbar'
import {updateSelection} from './media-render'
import {HMBlockSchema} from './schema'

export const ButtonBlock = createReactBlockSpec({
  type: 'button',
  propSchema: {
    ...defaultProps,

    url: {
      default: '',
    },
    name: {
      default: '',
    },
    alignment: {
      default: '',
    },
    defaultOpen: {
      values: ['false', 'true'],
      default: 'false',
    },
  },
  containsInlineContent: true,
  // @ts-ignore
  render: ({
    block,
    editor,
  }: {
    block: Block<HMBlockSchema>
    editor: BlockNoteEditor<HMBlockSchema>
  }) => Render(block, editor),
})

type ButtonAlignment = 'flex-start' | 'center' | 'flex-end'

export type ButtonType = {
  id: string
  props: {
    url: string
    name: string
    alignment?: string
  }
  children: []
  content: []
  type: string
}

const Render = (
  block: Block<HMBlockSchema>,
  editor: BlockNoteEditor<HMBlockSchema>,
) => {
  const popoverState = usePopoverState()
  // const [focused, setFocused] = useState(false)
  // const [sizing, setSizing] = useState('hug-content')
  const [alignment, setAlignment] = useState<ButtonAlignment>(
    (block.props.alignment as ButtonAlignment) || 'flex-start',
  )
  const [selected, setSelected] = useState(false)
  // const [buttonText, setButtonText] = useState(
  //   block.props.name || 'Button Label',
  // )
  // const sizingOptions = [
  //   {value: 'hug-content', label: 'Hug content'},
  //   {value: 'fill-width', label: 'Fill width'},
  // ]
  // const [link, setLink] = useState(block.props.url)
  const openUrl = useOpenUrl()

  const assign = (newProps: ButtonType) => {
    editor.updateBlock(block.id, {
      props: {...block.props, ...newProps.props},
    })
  }

  useEditorSelectionChange(editor, () =>
    updateSelection(editor, block, setSelected),
  )

  function ButtonLinkComponents() {
    return (
      <YStack gap="$0.25" paddingLeft="$1">
        <Label opacity={0.6} fontSize={13} marginBottom="$-2">
          Alignment
        </Label>
        <XStack gap="$3">
          <Button
            size="$2"
            height="$3"
            borderRadius="$3"
            onPress={() => {
              setAlignment('flex-start')
              assign({props: {alignment: 'flex-start'}} as ButtonType)
            }}
            borderColor="$brand5"
            backgroundColor={
              alignment === 'flex-start' ? '$brand5' : '$colorTransparent'
            }
          >
            <AlignLeft size="$1.5" />
          </Button>
          <Button
            size="$2"
            height="$3"
            borderRadius="$3"
            onPress={() => {
              setAlignment('center')
              assign({props: {alignment: 'center'}} as ButtonType)
            }}
            borderColor="$brand5"
            backgroundColor={
              alignment === 'center' ? '$brand5' : '$colorTransparent'
            }
          >
            <AlignCenter size="$1.5" />
          </Button>
          <Button
            size="$2"
            height="$3"
            borderRadius="$3"
            onPress={() => {
              setAlignment('flex-end')
              assign({props: {alignment: 'flex-end'}} as ButtonType)
            }}
            borderColor="$brand5"
            backgroundColor={
              alignment === 'flex-end' ? '$brand5' : '$colorTransparent'
            }
          >
            <AlignRight size="$1.5" />
          </Button>
        </XStack>
      </YStack>
    )
  }

  return (
    <Popover
      placement="top"
      open={popoverState.open}
      onOpenChange={(open) => {
        popoverState.onOpenChange(open)
      }}
    >
      <YStack justifyContent={alignment} alignItems={alignment}>
        <XStack width="100%" justifyContent={alignment} userSelect="none">
          <XStack
            position="relative"
            // width={sizing === 'fill-width' ? '92.5%' : ''}
            // @ts-ignore
            contentEditable={false}
          >
            <Popover.Trigger>
              <Button
                data-type="hm-button"
                borderWidth="$1"
                bc="$brand10"
                size="$3"
                width="100%"
                p="$2"
                fontSize="$4"
                justifyContent="center"
                textAlign="center"
                userSelect="none"
                borderColor={selected ? '$color8' : '$colorTransparent'}
                focusStyle={{borderWidth: '$1'}}
              >
                <SizableText numberOfLines={1} ellipsizeMode="tail">
                  {block.props.name}
                </SizableText>
              </Button>
            </Popover.Trigger>
            <Popover.Content size="$0" zIndex={99998}>
              <YStack marginBottom="$2">
                <HypermediaLinkSwitchToolbar
                  url={block.props.url}
                  text={block.props.name}
                  editHyperlink={(url: string, text: string) => {
                    assign({props: {url: url, name: text}} as ButtonType)
                  }}
                  updateHyperlink={(url: string, text: string) => {
                    assign({props: {url: url, name: text}} as ButtonType)
                  }}
                  deleteHyperlink={() => {
                    assign({props: {url: ''}} as ButtonType)
                  }}
                  startHideTimer={() => {}}
                  stopHideTimer={() => {}}
                  resetHyperlink={() => {}}
                  onChangeLink={() => {}}
                  openUrl={openUrl}
                  editor={editor}
                  stopEditing={false}
                  formComponents={ButtonLinkComponents}
                  type="button"
                  id={block.id}
                />
              </YStack>
            </Popover.Content>
          </XStack>
        </XStack>
      </YStack>
    </Popover>
  )
}
