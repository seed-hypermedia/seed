import {useOpenUrl} from '@/open-url'
import {
  Button,
  Label,
  Popover,
  SizableText,
  usePopoverState,
  XStack,
  YStack,
} from '@shm/ui'
import {AlignCenter, AlignLeft, AlignRight} from '@tamagui/lucide-icons'
import {useState} from 'react'
import {
  Block,
  BlockNoteEditor,
  createReactBlockSpec,
  defaultProps,
} from './blocknote'
import {HypermediaLinkForm} from './hm-link-form'
import {HypermediaLinkSwitchToolbar} from './hm-link-switch-toolbar'
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

  function ButtonEditForm(props: any) {
    return (
      <YStack
        gap="$3"
        padding="$5"
        width={300}
        backgroundColor="$color6"
        borderRadius="$4"
      >
        <SizableText fontWeight="900">Button Settings</SizableText>
        <YStack gap="$0.5">
          <Label fontWeight="300">Alignment</Label>
          <XStack gap="$3">
            <Button
              onPress={() => {
                setAlignment('flex-start')
                assign({props: {alignment: 'flex-start'}} as ButtonType)
              }}
              borderColor="$brand5"
              backgroundColor={
                alignment === 'flex-start' ? '$brand5' : '$colorTransparent'
              }
            >
              <AlignLeft />
            </Button>
            <Button
              onPress={() => {
                setAlignment('center')
                assign({props: {alignment: 'center'}} as ButtonType)
              }}
              borderColor="$brand5"
              backgroundColor={
                alignment === 'center' ? '$brand5' : '$colorTransparent'
              }
            >
              <AlignCenter />
            </Button>
            <Button
              onPress={() => {
                setAlignment('flex-end')
                assign({props: {alignment: 'flex-end'}} as ButtonType)
              }}
              borderColor="$brand5"
              backgroundColor={
                alignment === 'flex-end' ? '$brand5' : '$colorTransparent'
              }
            >
              <AlignRight />
            </Button>
          </XStack>
        </YStack>
        <YStack gap="$0.5">
          <HypermediaLinkForm
            url={props.url}
            text={props.text}
            editLink={props.editHyperlink}
            updateLink={props.updateHyperlink}
            openUrl={props.openUrl}
            type={props.type}
            hasName={true}
            hasSearch={true}
            isSeedDocument={props.isSeedDocument}
            isFocused={props.isFocused}
            setIsFocused={props.setIsFocused}
          />
        </YStack>
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
                borderWidth={1}
                bc="$brand10"
                size="$3"
                width="100%"
                p="$2"
                fontSize="$4"
                justifyContent="center"
                textAlign="center"
                userSelect="none"
              >
                <SizableText numberOfLines={1} ellipsizeMode="tail">
                  {block.props.name}
                </SizableText>
              </Button>
            </Popover.Trigger>
            <Popover.Content size="$0" zIndex="$zIndex.8">
              <YStack marginBottom="$2">
                <HypermediaLinkSwitchToolbar
                  url={block.props.url}
                  text={block.props.name}
                  editHyperlink={(url: string, text: string) => {
                    assign({props: {url: url, name: text}} as ButtonType)
                  }}
                  updateHyperlink={(url: string, text: string) => {
                    // assign({props: {url: url, name: text}} as ButtonType)
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
                  editComponent={ButtonEditForm}
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
