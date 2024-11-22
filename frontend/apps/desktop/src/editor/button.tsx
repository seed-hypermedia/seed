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
    width: {
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

export type ButtonType = {
  id: string
  props: {
    url: string
    name: string
    width?: string
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
  const [alignment, setAlignment] = useState<
    'flex-start' | 'center' | 'flex-end'
  >('flex-start')
  const [buttonText, setButtonText] = useState(
    block.props.name || 'Button Label',
  )
  // const sizingOptions = [
  //   {value: 'hug-content', label: 'Hug content'},
  //   {value: 'fill-width', label: 'Fill width'},
  // ]
  const [link, setLink] = useState(block.props.url)
  const openUrl = useOpenUrl()

  const assign = (newFile: ButtonType) => {
    editor.updateBlock(block.id, {
      props: {...block.props, ...newFile.props},
    })
  }

  function ButtonEditForm(props: any) {
    return (
      <YStack
        // flexDirection="column"
        // marginTop="$2"
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
              onPress={() => setAlignment('flex-start')}
              borderColor="$brand5"
              backgroundColor={
                alignment === 'flex-start' ? '$brand5' : '$colorTransparent'
              }
            >
              <AlignLeft />
            </Button>
            <Button
              onPress={() => setAlignment('center')}
              borderColor="$brand5"
              backgroundColor={
                alignment === 'center' ? '$brand5' : '$colorTransparent'
              }
            >
              <AlignCenter />
            </Button>
            <Button
              onPress={() => setAlignment('flex-end')}
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
            url={link}
            text={buttonText}
            editLink={(url: string, text: string) => {
              setLink(url)
              setButtonText(text)
              assign({props: {url: url, name: text}} as ButtonType)
            }}
            updateLink={(url: string, text: string) => {}}
            openUrl={openUrl}
            type="button"
            hasName={true}
            isSeedDocument={props.isSeedDocument}
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
                // borderRadius={1}
                bc="$brand10"
                size="$3"
                width="100%"
                // maxWidth="80%"
                // px="$2"
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
            <Popover.Content size="$0">
              <YStack marginBottom="$2">
                <HypermediaLinkSwitchToolbar
                  url={link}
                  text={buttonText}
                  editHyperlink={(url: string, text: string) => {
                    setLink(url)
                    setButtonText(text)
                    assign({props: {url: url, name: text}} as ButtonType)
                  }}
                  // editHyperlink={() => {}}
                  // updateHyperlink={(url: string, text: string) => {
                  //   setLink(url)
                  //   setButtonText(text)
                  //   assign({props: {url: url, name: text}} as ButtonType)
                  // }}
                  updateHyperlink={() => {}}
                  deleteHyperlink={() => {
                    setLink('')
                    assign({props: {url: ''}} as ButtonType)
                  }}
                  startHideTimer={() => {}}
                  stopHideTimer={() => {}}
                  resetHyperlink={() => {}}
                  onChangeLink={(key: 'url' | 'text', value: string) => {
                    if (key == 'text') {
                      setButtonText(value)
                    } else {
                      setLink(value)
                    }
                  }}
                  openUrl={openUrl}
                  editor={editor}
                  // onClose={(open: boolean) => {
                  //   popoverState.onOpenChange(open)
                  // }}
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
