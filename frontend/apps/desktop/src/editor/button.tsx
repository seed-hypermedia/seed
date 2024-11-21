import {useRecents} from '@/models/recents'
import {useSearch} from '@/models/search'
import {useOpenUrl} from '@/open-url'
import {HYPERMEDIA_ENTITY_TYPES, unpackHmId} from '@shm/shared'
import {
  Button,
  Input,
  Label,
  Popover,
  SizableText,
  toast,
  usePopoverState,
  XStack,
  YStack,
} from '@shm/ui'
import {AlignCenter, AlignLeft, AlignRight} from '@tamagui/lucide-icons'
import {useEffect, useState} from 'react'
import {
  Block,
  BlockNoteEditor,
  createReactBlockSpec,
  defaultProps,
} from './blocknote'
import {SwitcherItem} from './editor-types'
import {HypermediaLinkForm} from './hm-link-form'
import {HypermediaLinkSwitchToolbar} from './hm-link-switch-toolbar'
import {LauncherItem} from './launcher-item'
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

// const Render = (
//   block: Block<HMBlockSchema>,
//   editor: BlockNoteEditor<HMBlockSchema>,
// ) => {
//   const submitButton = (url: string, assign: any, setFileName: any) => {
//     if (isValidUrl(url)) {
//       assign({props: {url: url}} as MediaType)
//     } else setFileName({name: 'The provided URL is invalid.', color: 'red'})
//     const cursorPosition = editor.getTextCursorPosition()
//     editor.focus()
//     if (cursorPosition.block.id === block.id) {
//       if (cursorPosition.nextBlock)
//         editor.setTextCursorPosition(cursorPosition.nextBlock, 'start')
//       else {
//         editor.insertBlocks(
//           [{type: 'paragraph', content: ''}],
//           block.id,
//           'after',
//         )
//         editor.setTextCursorPosition(
//           editor.getTextCursorPosition().nextBlock!,
//           'start',
//         )
//       }
//     }
//   }
//   return (
//     <MediaRender
//       block={block}
//       editor={editor}
//       mediaType="button"
//       submit={submitButton}
//       DisplayComponent={display}
//       icon={<MousePointerClick />}
//       CustomInput={ButtonInput}
//     />
//   )
// }

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
  // const [linkType, setLinkType] = useState<'web' | 'seed'>('web')
  const openUrl = useOpenUrl()

  const assign = (newFile: ButtonType) => {
    editor.updateBlock(block.id, {
      props: {...block.props, ...newFile.props},
    })
  }

  // const renderLastInput = () => {
  //   if (linkType === 'web') {
  //     return (
  //       <Input
  //         value={link}
  //         onChangeText={(text) => setLink(text)}
  //         placeholder="Web Address URL"
  //         onBlur={() => {
  //           if (link !== block.props.url)
  //             assign({props: {url: link}} as ButtonType)
  //         }}
  //       />
  //     )
  //   } else if (linkType === 'seed') {
  //     return (
  //       <XStack gap="$2">
  //         <ButtonLauncherInput assign={assign} link={link} setLink={setLink} />
  //       </XStack>
  //     )
  //   }
  // }

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
        <XStack
          width="100%"
          justifyContent={alignment}
          // onMouseEnter={(_e) => {
          // console.log('focused')
          // setFocused(true)
          // }}
          // onMouseLeave={(_e) => setFocused(false)}
          userSelect="none"
        >
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
                // onPress={() => {
                //   openUrl(block.props.url)
                // }}
              >
                <SizableText numberOfLines={1} ellipsizeMode="tail">
                  {block.props.name}
                </SizableText>
              </Button>
            </Popover.Trigger>
            {/* {focused && ( */}
            {/* <Popover.Trigger>
              <Button
                icon={<RiPencilFill color="$color11" />}
                size="$3"
                maxWidth="$6"
                marginLeft="$4"
                borderWidth={1}
                borderColor="$color11"
                position="absolute"
                right={-50}
                // onPress={() => popoverState.onOpenChange(true)}
              />
            </Popover.Trigger> */}
            {/* )} */}
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
              {/* <YStack
                // flexDirection="column"
                // marginTop="$2"
                gap="$3"
                padding="$5"
                width={300}
                backgroundColor="$color6"
                borderRadius="$4"
              >
                <SizableText fontWeight="900">Button Settings</SizableText>
                <Button
                  position="absolute"
                  top={10}
                  right={20}
                  backgroundColor="transparent"
                  borderWidth={0}
                  outlineWidth={0}
                  padding={0}
                  width="$3"
                  focusStyle={{
                    borderWidth: 0,
                    outlineWidth: 0,
                  }}
                  onPress={() => popoverState.onOpenChange(false)}
                >
                  <X size="$1" color="white" hoverStyle={{color: 'red'}} />
                </Button>
                <YStack gap="$0.5">
                  <Label fontWeight="500">Alignment</Label>
                  <XStack gap="$3">
                    <Button
                      onPress={() => setAlignment('flex-start')}
                      borderColor="$brand5"
                      backgroundColor={
                        alignment === 'flex-start'
                          ? '$brand5'
                          : '$colorTransparent'
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
                        alignment === 'flex-end'
                          ? '$brand5'
                          : '$colorTransparent'
                      }
                    >
                      <AlignRight />
                    </Button>
                  </XStack>
                </YStack>

                <YStack>
                  <Label>Sizing</Label>
                  <Select
                    value={sizing}
                    onValueChange={(value) => setSizing(value)}
                  >
                    <Select.Trigger iconAfter={ChevronDown} size="$4">
                      <Select.Value placeholder={sizing} />
                    </Select.Trigger>

                    <Select.Content zIndex={200000}>
                      <Select.Viewport minWidth={200}>
                        <Select.Group maxHeight={'60vh'}>
                          {sizingOptions.map((item, i) => {
                            return (
                              <Select.Item
                                index={i}
                                key={item.value}
                                value={item.value}
                              >
                                <Select.ItemText>{item.label}</Select.ItemText>
                                <Select.ItemIndicator marginLeft="auto">
                                  <Check size={16} />
                                </Select.ItemIndicator>
                              </Select.Item>
                            )
                          })}
                        </Select.Group>
                      </Select.Viewport>
                      <Select.ScrollDownButton
                        alignItems="center"
                        justifyContent="center"
                        position="relative"
                        width="100%"
                        height="$3"
                      >
                        <YStack zIndex={10}>
                          <ChevronDown size={20} />
                        </YStack>
                      </Select.ScrollDownButton>
                    </Select.Content>
                  </Select>
                </YStack>

                <YStack gap="$0.5">
                  <Label fontWeight="500">Button Label</Label>
                  <Input
                    value={buttonText}
                    onChangeText={(text) => setButtonText(text)}
                    placeholder="Learn more!"
                    onBlur={() => {
                      if (buttonText !== block.props.name)
                        assign({props: {name: buttonText}} as ButtonType)
                    }}
                  />
                </YStack>

                <YStack gap="$0.5">
                  <Label fontWeight="500">What does it link to?</Label>
                  <XStack gap="$2" width="100%" marginBottom="$2">
                    <Button
                      onPress={() => setLinkType('web')}
                      borderColor="$brand5"
                      backgroundColor={
                        linkType === 'web' ? '$brand5' : '$colorTransparent'
                      }
                      flex={1}
                      paddingVertical="$1"
                      paddingHorizontal="$2"
                    >
                      <SizableText>Web Address</SizableText>
                    </Button>
                    <Button
                      onPress={() => setLinkType('seed')}
                      borderColor="$brand5"
                      backgroundColor={
                        linkType === 'seed' ? '$brand5' : '$colorTransparent'
                      }
                      flex={1}
                      paddingVertical="$1"
                      paddingHorizontal="$2"
                    >
                      <SizableText>Seed Document</SizableText>
                    </Button>
                  </XStack>
                  <Input
                    value={link}
                    onChangeText={(text) => setLink(text)}
                    placeholder="Add a link..."
                    onBlur={() => {
                      if (link !== block.props.url)
                        assign({props: {url: link}} as ButtonType)
                    }}
                  />
                  {renderLastInput()}
                </YStack> */}
              {/* </YStack> */}
            </Popover.Content>
          </XStack>
        </XStack>
      </YStack>
    </Popover>
  )
}

const ButtonLauncherInput = ({
  assign,
  link,
  setLink,
}: {
  assign: any
  link: string
  setLink: any
}) => {
  const [search, setSearch] = useState(link)
  const [focused, setFocused] = useState(false)
  const recents = useRecents()
  const searchResults = useSearch(search, {})

  const searchItems: SwitcherItem[] =
    searchResults.data
      ?.map((item) => {
        const id = unpackHmId(item.id)
        if (!id) return null
        return {
          title: item.title || item.id,
          onSelect: () => {
            assign({props: {url: id.id}} as ButtonType)
            setLink(id.id)
            setSearch(id.id)
          },
          subtitle: HYPERMEDIA_ENTITY_TYPES[id.type],
        }
      })
      .filter(Boolean) || []
  const recentItems =
    recents.data?.map(({url, title, subtitle, type}) => {
      return {
        key: url,
        title,
        subtitle,
        onSelect: () => {
          const id = unpackHmId(url)
          if (!id) {
            toast.error('Failed to open recent: ' + url)
            return
          }
          assign({props: {url: id.id}} as ButtonType)
          setLink(id.id)
          setSearch(id.id)
        },
      }
    }) || []
  const isDisplayingRecents = !search.length
  const activeItems = isDisplayingRecents ? recentItems : searchItems

  const [focusedIndex, setFocusedIndex] = useState(0)

  useEffect(() => {
    if (focusedIndex >= activeItems.length) setFocusedIndex(0)
  }, [focusedIndex, activeItems])

  let content = (
    <YStack
      display={focused ? 'flex' : 'none'}
      gap="$2"
      elevation={2}
      opacity={1}
      paddingVertical="$3"
      paddingHorizontal="$3"
      backgroundColor={'$backgroundHover'}
      borderTopStartRadius={0}
      borderTopEndRadius={0}
      borderBottomLeftRadius={6}
      borderBottomRightRadius={6}
      position="absolute"
      width="100%"
      top="$8"
      left={0}
      zIndex={999}
    >
      {isDisplayingRecents ? (
        <SizableText color="$color10" marginHorizontal="$4">
          Recent Resources
        </SizableText>
      ) : null}
      {activeItems?.map((item, itemIndex) => {
        return (
          <LauncherItem
            item={item}
            key={item.key}
            selected={focusedIndex === itemIndex}
            onFocus={() => {
              setFocusedIndex(itemIndex)
            }}
            onMouseEnter={() => {
              setFocusedIndex(itemIndex)
            }}
          />
        )
      })}
    </YStack>
  )

  return (
    <YStack flex={1} gap="$4">
      <Input
        onFocus={() => {
          setFocused(true)
        }}
        onBlur={() => {
          setTimeout(() => {
            setFocused(false)
          }, 150)
        }}
        autoFocus={false}
        value={search}
        onChangeText={(text: string) => {
          setSearch(text)
        }}
        placeholder="Open Seed Document..."
        // disabled={!!actionPromise}
        onKeyPress={(e: any) => {
          if (e.nativeEvent.key === 'Escape') {
            setFocused(false)
            return
          }
          if (e.nativeEvent.key === 'Enter') {
            const item = activeItems[focusedIndex]
            if (item) {
              item.onSelect()
            }
          }
          if (e.nativeEvent.key === 'ArrowDown') {
            e.preventDefault()
            setFocusedIndex((prev) => (prev + 1) % activeItems.length)
          }
          if (e.nativeEvent.key === 'ArrowUp') {
            e.preventDefault()
            setFocusedIndex(
              (prev) => (prev - 1 + activeItems.length) % activeItems.length,
            )
          }
        }}
      />

      {content}
    </YStack>
  )
}

// const ButtonInput = ({
//   assign,
//   setUrl,
//   fileName,
//   setFileName,
// }: {
//   assign: any
//   setUrl: any
//   fileName: any
//   setFileName: any
// }) => {
//   return (
//     <XStack flex={1} gap="$2">
//       <Input
//         unstyled
//         borderColor="$color8"
//         borderWidth="$1"
//         borderRadius="$2"
//         paddingLeft="$3"
//         height="$3"
//         width="100%"
//         placeholder={'Input Button Label here...'}
//         hoverStyle={{
//           borderColor: '$color11',
//         }}
//         focusStyle={{
//           borderColor: '$color11',
//         }}
//         onChange={(e: {nativeEvent: {text: SetStateAction<string>}}) => {
//           assign({props: {name: e.nativeEvent.text}})
//           if (fileName.color)
//             setFileName({
//               name: 'Upload File',
//               color: undefined,
//             })
//         }}
//         autoFocus={true}
//       />
//       <Input
//         unstyled
//         borderColor="$color8"
//         borderWidth="$1"
//         borderRadius="$2"
//         paddingLeft="$3"
//         height="$3"
//         width="100%"
//         placeholder={'Input Button URL here...'}
//         hoverStyle={{
//           borderColor: '$color11',
//         }}
//         focusStyle={{
//           borderColor: '$color11',
//         }}
//         onChange={(e: {nativeEvent: {text: SetStateAction<string>}}) => {
//           setUrl(e.nativeEvent.text)
//           if (fileName.color)
//             setFileName({
//               name: 'Upload File',
//               color: undefined,
//             })
//         }}
//         autoFocus={true}
//       />
//     </XStack>
//   )
// }

// const display = ({
//   editor,
//   block,
//   selected,
//   setSelected,
//   assign,
// }: DisplayComponentProps) => {
//   const openUrl = useOpenUrl()

//   return (
//     <MediaContainer
//       editor={editor}
//       block={block}
//       mediaType="button"
//       selected={selected}
//       setSelected={setSelected}
//       assign={assign}
//     >
//       <XStack height="$5" width="100%" jc="center" ai="center">
//         <Button
//           borderWidth={1}
//           borderRadius={1}
//           bc="$brand10"
//           size="$3"
//           minWidth="$10"
//           maxWidth="100%"
//           px="$2"
//           fontSize="$4"
//           justifyContent="center"
//           textAlign="center"
//           userSelect="none"
//           onPress={() => {
//             openUrl(block.props.url)
//           }}
//         >
//           <SizableText numberOfLines={1} ellipsizeMode="tail">
//             {block.props.name}
//           </SizableText>
//         </Button>
//       </XStack>
//     </MediaContainer>
//   )
// }
