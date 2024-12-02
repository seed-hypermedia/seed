import {useAppContext} from '@/app-context'
import {useGatewayUrlStream} from '@/models/gateway-settings'
import {useRecents} from '@/models/recents'
import {useSearch} from '@/models/search'
import {loadWebLinkMeta} from '@/models/web-links'
import {useOpenUrl} from '@/open-url'
import {
  HMEmbedViewSchema,
  hmIdWithVersion,
  HYPERMEDIA_ENTITY_TYPES,
  isHypermediaScheme,
  isPublicGatewayLink,
  normalizeHmId,
  packHmId,
  parseCustomURL,
  UnpackedHypermediaId,
  unpackHmId,
  useHover,
} from '@shm/shared'
import {
  BlockContentEmbed,
  Button,
  Check,
  ChevronDown,
  ErrorBlock,
  ExternalLink,
  Input,
  Label,
  ListItem,
  Popover,
  Separator,
  SizableText,
  toast,
  Tooltip,
  usePopoverState,
  YGroup,
  YStack,
} from '@shm/ui'
import {ChevronRight} from '@tamagui/lucide-icons'
import {Fragment} from '@tiptap/pm/model'
import {useCallback, useEffect, useState} from 'react'
import {ErrorBoundary} from 'react-error-boundary'
import {GestureResponderEvent} from 'react-native'
import {Block, BlockNoteEditor, HMBlockSchema} from '.'
import {createReactBlockSpec} from './blocknote/react'
import {useEmbedToolbarContext} from './embed-toolbar-context'
import {HypermediaLinkSwitchToolbar} from './hm-link-switch-toolbar'
import {LauncherItem, SwitcherItem} from './launcher-item'
import {MediaContainer} from './media-container'
import {DisplayComponentProps, MediaRender, MediaType} from './media-render'

function EmbedError() {
  return <ErrorBlock message="Failed to load this Embedded document" />
}

export const EmbedBlock = createReactBlockSpec({
  type: 'embed',
  propSchema: {
    url: {
      default: '',
    },
    defaultOpen: {
      values: ['false', 'true'],
      default: 'false',
    },
    view: {
      values: ['Content', 'Card'], // TODO: convert HMEmbedView type to array items
      default: 'Content',
    },
  },
  containsInlineContent: true,

  render: ({
    block,
    editor,
  }: {
    block: Block<HMBlockSchema>
    editor: BlockNoteEditor<HMBlockSchema>
  }) => Render(block, editor),

  parseHTML: [
    {
      tag: 'div[data-content-type=embed]',
      priority: 1000,
      getContent: (_node, _schema) => {
        return Fragment.empty
      },
    },
  ],
})

const Render = (
  block: Block<HMBlockSchema>,
  editor: BlockNoteEditor<HMBlockSchema>,
) => {
  const {queryClient} = useAppContext()
  const gwUrl = useGatewayUrlStream()
  const submitEmbed = async (
    url: string,
    assign: any,
    setFileName: any,
    setLoading: any,
  ) => {
    if (isPublicGatewayLink(url, gwUrl) || isHypermediaScheme(url)) {
      const hmLink = normalizeHmId(url, gwUrl)
      const newUrl = hmLink ? hmLink : url
      assign({props: {url: newUrl}} as MediaType)
      const cursorPosition = editor.getTextCursorPosition()
      editor.focus()
      if (cursorPosition.block.id === block.id) {
        if (cursorPosition.nextBlock)
          editor.setTextCursorPosition(cursorPosition.nextBlock, 'start')
        else {
          editor.insertBlocks(
            [{type: 'paragraph', content: ''}],
            block.id,
            'after',
          )
          editor.setTextCursorPosition(
            editor.getTextCursorPosition().nextBlock!,
            'start',
          )
        }
      }
    } else {
      setLoading(true)
      loadWebLinkMeta(queryClient, url)
        .then((res) => {
          const fullHmId = hmIdWithVersion(
            res?.hmId,
            res?.hmVersion,
            res?.blockRef,
          )
          if (fullHmId) {
            assign({props: {url: fullHmId}} as MediaType)
            const cursorPosition = editor.getTextCursorPosition()
            editor.focus()
            if (cursorPosition.block.id === block.id) {
              if (cursorPosition.nextBlock)
                editor.setTextCursorPosition(cursorPosition.nextBlock, 'start')
              else {
                editor.insertBlocks(
                  [{type: 'paragraph', content: ''}],
                  block.id,
                  'after',
                )
                editor.setTextCursorPosition(
                  editor.getTextCursorPosition().nextBlock!,
                  'start',
                )
              }
            }
          } else {
            setFileName({
              name: 'The provided url is not a hypermedia link',
              color: 'red',
            })
          }
          setLoading(false)
        })
        .catch((e) => {
          setFileName({
            name: 'The provided url is not a hypermedia link',
            color: 'red',
          })
          setLoading(false)
        })
    }
  }
  return (
    <MediaRender
      block={block}
      hideForm={!!block.props.url}
      editor={editor}
      mediaType="embed"
      submit={submitEmbed}
      CustomInput={EmbedLauncherInput}
      DisplayComponent={display}
      icon={<ExternalLink />}
    />
  )
}

const display = ({
  editor,
  block,
  assign,
  selected,
  setSelected,
}: DisplayComponentProps) => {
  const unpackedId = unpackHmId(block.props.url)
  const [showControl, setShowControl] = useState(false)
  const {activeId, setActiveId} = useEmbedToolbarContext()

  return (
    <MediaContainer
      editor={editor}
      block={block}
      mediaType="embed"
      selected={selected}
      setSelected={setSelected}
      assign={assign}
      styleProps={{
        pointerEvents: activeId && activeId !== block.id ? 'none' : '',
      }}
      onHoverIn={() => {
        if (!activeId) {
          setShowControl(true)
          setActiveId(block.id)
        }
      }}
      onHoverOut={() => {
        setShowControl(false)
        if (activeId && activeId === block.id) {
          setActiveId(null)
        }
      }}
    >
      <EmbedControl
        editor={editor}
        block={block}
        unpackedId={unpackedId}
        assign={assign}
        showControl={showControl}
        activeId={activeId}
        setActiveId={setActiveId}
      />
      {block.props.url && (
        <ErrorBoundary FallbackComponent={EmbedError}>
          <BlockContentEmbed
            expanded={
              unpackedId &&
              unpackedId.blockRange &&
              'expanded' in unpackedId.blockRange
                ? true
                : false
            }
            block={{
              id: block.id,
              type: 'Embed',
              text: '',
              attributes: {
                childrenType: 'Group',
                view: HMEmbedViewSchema.parse(block.props.view),
              },
              annotations: [],
              link: block.props.url,
            }}
            depth={1}
          />
        </ErrorBoundary>
      )}
    </MediaContainer>
  )
}

function EmbedControl({
  editor,
  block,
  unpackedId,
  assign,
  showControl,
  activeId,
  setActiveId,
}: {
  editor: BlockNoteEditor<HMBlockSchema>
  block: Block<HMBlockSchema>
  unpackedId: UnpackedHypermediaId | null
  assign: any
  showControl: boolean
  activeId: string | null
  setActiveId: (id: string | null) => void
}) {
  const [url, setUrl] = useState<string>(block.props.url || '')
  const openUrl = useOpenUrl()
  const popoverState = usePopoverState()
  const popoverViewState = usePopoverState()
  const popoverLatestState = usePopoverState()
  const popoverToDocumentState = usePopoverState()
  const expandButtonHover = useHover()

  const allowViewSwitcher = unpackedId?.type == 'd' && !unpackedId?.blockRef
  const allowVersionSwitcher = unpackedId?.type == 'd'
  const hasBlockRef = unpackedId?.blockRef
  const isLatestVersion = isEmbedUrlLatest(block.props.url)

  useEffect(() => {
    return () => {
      if (activeId === block.id) {
        setActiveId(null)
      }
    }
  }, [activeId, setActiveId])

  const setHover = (hovered: boolean) => {
    if (hovered && !activeId) setActiveId(block.id)
    else if (!hovered && activeId === block.id) {
      setActiveId(null)
    }
  }

  function isEmbedUrlLatest(url: string): boolean {
    const queryParams = parseCustomURL(url)

    return (
      (queryParams?.query &&
        (queryParams.query.l === null || queryParams.query.l === '')) ||
      false
    )
  }

  const handleViewSelect = useCallback((view: 'Content' | 'Card') => {
    return () => {
      assign({props: {view}})
      popoverViewState.onOpenChange(false)
    }
  }, [])

  const isBlockExpanded =
    unpackedId &&
    unpackedId?.blockRef &&
    unpackedId.blockRange &&
    'expanded' in unpackedId.blockRange &&
    unpackedId.blockRange?.expanded

  const handleVersionSelect = useCallback(
    (versionMode: 'exact' | 'latest') => {
      return () => {
        popoverLatestState.onOpenChange(false)
        if (unpackedId) {
          let url = packHmId({...unpackedId, latest: versionMode == 'latest'})
          assign({
            props: {
              url,
            },
          })
        }
      }
    },
    [block.props.url, unpackedId],
  )

  const handleBlockToDocument = useCallback(() => {
    if (unpackedId) {
      assign({
        props: {
          url: packHmId({...unpackedId, blockRef: null, blockRange: null}),
          view: 'Content',
        },
      })
    }
  }, [block.props.url, unpackedId])

  function EmbedLinkComponents() {
    return (
      <YStack gap="$0.25">
        {allowViewSwitcher && (
          <Popover
            {...popoverViewState}
            onOpenChange={(open) => {
              popoverState.onOpenChange(open)
              popoverViewState.onOpenChange(open)
            }}
            placement="bottom"
          >
            <YStack>
              <Label fontSize={13} marginBottom="$-2">
                View
              </Label>
              <Popover.Trigger asChild>
                <Button
                  borderColor="$borderColorFocus"
                  borderWidth="$1"
                  borderRadius="$2"
                  size="$2"
                  iconAfter={popoverViewState.open ? ChevronDown : ChevronRight}
                >
                  {block.props.view}
                </Button>
              </Popover.Trigger>
            </YStack>
            <Popover.Content asChild>
              <YGroup padding={0} width={250} zIndex={99999}>
                <YGroup.Item>
                  <ListItem
                    size="$2"
                    title="as Content"
                    onPress={handleViewSelect('Content')}
                    iconAfter={block.props.view == 'Content' ? Check : null}
                    hoverStyle={{
                      bg: '$backgroundHover',
                    }}
                  />
                </YGroup.Item>
                <Separator />
                <YGroup.Item>
                  <ListItem
                    size="$2"
                    title="as Card"
                    onPress={handleViewSelect('Card')}
                    iconAfter={block.props.view == 'Card' ? Check : null}
                    hoverStyle={{
                      bg: '$backgroundHover',
                    }}
                  />
                </YGroup.Item>
              </YGroup>
            </Popover.Content>
          </Popover>
        )}
        {allowVersionSwitcher && (
          <Popover
            {...popoverLatestState}
            onOpenChange={(open) => {
              popoverState.onOpenChange(open)
              popoverLatestState.onOpenChange(open)
            }}
            placement="bottom"
          >
            <YStack>
              <Label fontSize={13} marginBottom="$-2">
                Sort
              </Label>
              <Popover.Trigger asChild>
                <Button
                  borderColor="$borderColorFocus"
                  borderWidth="$1"
                  borderRadius="$2"
                  size="$2"
                  iconAfter={
                    popoverLatestState.open ? ChevronDown : ChevronRight
                  }
                >
                  {isLatestVersion ? 'Latest Version' : 'Exact Version'}
                </Button>
              </Popover.Trigger>
            </YStack>
            <Popover.Content asChild>
              <YGroup padding={0} width={250} elevation="$4" zIndex={99999}>
                <YGroup.Item>
                  <ListItem
                    size="$2"
                    title="Latest Version"
                    onPress={handleVersionSelect('latest')}
                    iconAfter={isLatestVersion ? Check : null}
                    hoverStyle={{
                      bg: '$backgroundHover',
                    }}
                  />
                </YGroup.Item>
                <Separator />
                <YGroup.Item>
                  <ListItem
                    size="$2"
                    title="Exact Version"
                    onPress={handleVersionSelect('exact')}
                    iconAfter={isLatestVersion ? null : Check}
                    hoverStyle={{
                      bg: '$backgroundHover',
                    }}
                  />
                </YGroup.Item>
              </YGroup>
            </Popover.Content>
          </Popover>
        )}
        {/* {hasBlockRef ? (
              <Popover {...popoverToDocumentState} placement="bottom-start">
                <Popover.Trigger asChild>
                  <Button
                    icon={MoreHorizontal}
                    size="$1"
                    onPress={(e: GestureResponderEvent) => e.stopPropagation()}
                    circular
                  />
                </Popover.Trigger>
                <Popover.Content
                  padding={0}
                  elevation="$2"
                  animation={[
                    'fast',
                    {
                      opacity: {
                        overshootClamping: true,
                      },
                    },
                  ]}
                  enterStyle={{y: -10, opacity: 0}}
                  exitStyle={{y: -10, opacity: 0}}
                  elevate={true}
                >
                  <YGroup>
                    <YGroup.Item>
                      {hasBlockRef ? (
                        <MenuItem
                          onPress={(e: GestureResponderEvent) => {
                            e.stopPropagation()
                            handleBlockToDocument()
                          }}
                          title="Convert to Document Embed"
                          // icon={item.icon}
                        />
                      ) : null}
                    </YGroup.Item>
                  </YGroup>
                </Popover.Content>
              </Popover>
            ) : null} */}
      </YStack>
    )
  }

  return (
    <YStack
      position="absolute"
      x={0}
      y={0}
      zIndex="$zIndex.4"
      width="100%"
      ai="flex-end"
      jc="flex-end"
      opacity={showControl ? 1 : 0}
      // opacity={popoverState.open ? 1 : 0}
      padding="$2"
      gap="$0.5"
    >
      <HypermediaLinkSwitchToolbar
        url={url}
        text={''}
        editHyperlink={(url: string, _text: string) => {
          setUrl(url)
          assign({props: {url: url}})
        }}
        updateHyperlink={() => {}}
        deleteHyperlink={() => {
          setUrl('')
          assign({props: {url: ''}})
        }}
        startHideTimer={() => {}}
        stopHideTimer={() => {}}
        resetHyperlink={() => {}}
        onChangeLink={(key: 'url' | 'text', value: string) => {
          if (key == 'url') {
            setUrl(value)
          }
        }}
        openUrl={openUrl}
        editor={editor}
        stopEditing={!showControl}
        formComponents={EmbedLinkComponents}
        type="embed"
        id={block.id}
        setHovered={setHover}
      />
      {hasBlockRef ? (
        <Tooltip
          content={
            isBlockExpanded
              ? `Embed only the block's content`
              : `Embed the block and its children`
          }
        >
          <Button
            {...expandButtonHover}
            size="$2"
            icon={
              isBlockExpanded
                ? expandButtonHover.hover
                  ? ChevronRight
                  : ChevronDown
                : expandButtonHover.hover
                ? ChevronDown
                : ChevronRight
            }
            backgroundColor="$backgroundStrong"
            onPress={(e: GestureResponderEvent) => {
              e.stopPropagation()
              let url = packHmId({
                ...unpackedId,
                blockRange: {expanded: !isBlockExpanded},
              })

              assign({
                props: {
                  url,
                },
              })
            }}
          >
            {isBlockExpanded
              ? expandButtonHover.hover
                ? 'Collapse'
                : 'Expand'
              : expandButtonHover.hover
              ? 'Expand'
              : 'Collapse'}
          </Button>
        </Tooltip>
      ) : null}
    </YStack>
  )
}

const EmbedLauncherInput = ({
  editor,
  assign,
  setUrl,
  fileName,
  setFileName,
}: {
  editor: BlockNoteEditor
  assign: any
  setUrl: any
  fileName: any
  setFileName: any
}) => {
  const [search, setSearch] = useState('')
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
            assign({props: {url: id.id}} as MediaType)
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
          assign({props: {url: id.id}} as MediaType)
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
      top={fileName.color ? '$11' : '$8'}
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
        unstyled
        borderColor="$color8"
        borderWidth="$1"
        borderRadius="$2"
        paddingLeft="$3"
        height="$3"
        width="100%"
        hoverStyle={{
          borderColor: '$color11',
        }}
        focusStyle={{
          borderColor: '$color11',
        }}
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
          setUrl(text)
          if (fileName.color)
            setFileName({
              name: 'Upload File',
              color: undefined,
            })
        }}
        placeholder="Query or input Embed URL..."
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
