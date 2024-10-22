import {useAppContext} from '@/app-context'
import {useGatewayUrlStream} from '@/models/gateway-settings'
import {useRecents} from '@/models/recents'
import {useSearch} from '@/models/search'
import {loadWebLinkMeta} from '@/models/web-links'
import {useOpenUrl} from '@/open-url'
import {
  createHmDocLink_DEPRECATED,
  HMEmbedViewSchema,
  hmIdWithVersion,
  HYPERMEDIA_ENTITY_TYPES,
  isHypermediaScheme,
  isPublicGatewayLink,
  normalizeHmId,
  unpackHmId,
  useHover,
} from '@shm/shared'
import {
  BlockContentEmbed,
  Button,
  Check,
  ChevronDown,
  Forward as ChevronRight,
  ErrorBlock,
  ExternalLink,
  Input,
  ListItem,
  MenuItem,
  MoreHorizontal,
  Popover,
  Separator,
  SizableText,
  toast,
  Tooltip,
  usePopoverState,
  XStack,
  YGroup,
  YStack,
} from '@shm/ui'
import {Fragment} from '@tiptap/pm/model'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {ErrorBoundary} from 'react-error-boundary'
import {GestureResponderEvent} from 'react-native'
import {Block, BlockNoteEditor, HMBlockSchema} from '.'
import {createReactBlockSpec} from './blocknote/react'
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
  return (
    <MediaContainer
      editor={editor}
      block={block}
      mediaType="embed"
      selected={selected}
      setSelected={setSelected}
      assign={assign}
    >
      <EmbedControl block={block} assign={assign} />
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
  block,
  assign,
}: {
  block: Block<HMBlockSchema>
  assign: any
}) {
  const hmId = useMemo(() => {
    if (block.props.url) {
      return unpackHmId(block.props.url)
    }
    return null
  }, [block.props.url])
  const allowViewSwitcher = hmId?.type != 'c' && !hmId?.blockRef
  const allowVersionSwitcher = hmId?.type == 'd'
  const openUrl = useOpenUrl()
  const popoverState = usePopoverState()
  const popoverViewState = usePopoverState()
  const popoverLatestState = usePopoverState()
  const popoverToDocumentState = usePopoverState()
  const expandButtonHover = useHover()

  let versionValue =
    block.props.url.includes('&l') || block.props.url.includes('?l')
      ? 'latest'
      : 'exact'
  let isVersionLatest = versionValue == 'latest'

  const handleViewSelect = useCallback((view: 'Content' | 'Card') => {
    return () => {
      assign({props: {view}})
      popoverViewState.onOpenChange(false)
    }
  }, [])

  const expanded = useMemo(() => {
    let res =
      hmId &&
      hmId?.blockRef &&
      hmId.blockRange &&
      'expanded' in hmId.blockRange &&
      hmId.blockRange?.expanded
    return res
  }, [block.props.url])

  const handleVersionSelect = useCallback(
    (versionMode: 'exact' | 'latest') => {
      let unpackedRef = unpackHmId(block.props.url)
      return () => {
        popoverLatestState.onOpenChange(false)
        if (unpackedRef) {
          assign({
            props: {
              url: createHmDocLink_DEPRECATED({
                documentId: unpackedRef?.id,
                version: unpackedRef?.version,
                blockRef: unpackedRef?.blockRef,
                latest: versionMode === 'latest',
              }),
            },
          })
        }
      }
    },
    [block.props.url],
  )

  const handleBlockToDocument = useCallback(() => {
    let unpackedRef = unpackHmId(block.props.url)

    if (unpackedRef) {
      assign({
        props: {
          url: createHmDocLink_DEPRECATED({
            documentId: unpackedRef?.id,
            version: unpackedRef?.version,
            blockRef: unpackedRef?.blockRef,
            latest: unpackedRef?.latest || undefined,
          }),
          view: 'Content',
        },
      })
    }
  }, [block.props.url])

  return (
    <XStack
      position="absolute"
      x={0}
      y={0}
      zIndex="$zIndex.5"
      width="100%"
      ai="center"
      jc="flex-end"
      opacity={popoverState.open ? 1 : 0}
      padding="$2"
      gap="$2"
      $group-item-hover={{opacity: 1}}
    >
      <Tooltip content="Open in a new window">
        <Button
          size="$2"
          icon={<ExternalLink />}
          backgroundColor="$backgroundStrong"
          onPress={() => {
            openUrl(block.props.url, true)
          }}
        />
      </Tooltip>
      {hmId?.blockRef ? (
        <Tooltip
          content={
            expanded
              ? `Embed only the block's content`
              : `Embed the block and its children`
          }
        >
          <Button
            {...expandButtonHover}
            size="$2"
            icon={
              expanded
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
              let url = createHmDocLink_DEPRECATED({
                documentId: hmId?.id,
                version: hmId?.version,
                latest: !!hmId?.latest,
                blockRef: hmId?.blockRef,
                blockRange: {
                  expanded: !expanded,
                },
              })

              assign({
                props: {
                  url,
                  view: 'Content',
                },
              })
            }}
          >
            {expanded
              ? expandButtonHover.hover
                ? 'Collapse'
                : 'Expand'
              : expandButtonHover.hover
              ? 'Expand'
              : 'Collapse'}
          </Button>
        </Tooltip>
      ) : null}

      {allowViewSwitcher && (
        <Popover
          {...popoverViewState}
          onOpenChange={(open) => {
            popoverState.onOpenChange(open)
            popoverViewState.onOpenChange(open)
          }}
          placement="bottom-end"
        >
          <Popover.Trigger asChild>
            <Button
              backgroundColor="$backgroundStrong"
              size="$2"
              iconAfter={ChevronDown}
            >{`view: ${block.props.view}`}</Button>
          </Popover.Trigger>
          <Popover.Content asChild>
            <YGroup padding={0} width={120}>
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
          placement="bottom-end"
        >
          <Popover.Trigger asChild>
            <Button
              backgroundColor="$backgroundStrong"
              size="$2"
              iconAfter={ChevronDown}
            >{`version: ${versionValue}`}</Button>
          </Popover.Trigger>
          <Popover.Content asChild>
            <YGroup padding={0} width={120} elevation="$4">
              <YGroup.Item>
                <ListItem
                  size="$2"
                  title="Latest"
                  onPress={handleVersionSelect('latest')}
                  iconAfter={isVersionLatest ? Check : null}
                  hoverStyle={{
                    bg: '$backgroundHover',
                  }}
                />
              </YGroup.Item>
              <Separator />
              <YGroup.Item>
                <ListItem
                  size="$2"
                  title="Exact"
                  onPress={handleVersionSelect('exact')}
                  iconAfter={!isVersionLatest ? Check : null}
                  hoverStyle={{
                    bg: '$backgroundHover',
                  }}
                />
              </YGroup.Item>
            </YGroup>
          </Popover.Content>
        </Popover>
      )}
      {hmId?.blockRef ? (
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
                {hmId?.blockRef ? (
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
      ) : null}
    </XStack>
  )
}

type SwitcherItem = {
  key: string
  title: string
  subtitle?: string
  onSelect: () => void
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

function LauncherItem({
  item,
  selected = false,
  onFocus,
  onMouseEnter,
}: {
  item: SwitcherItem
  selected: boolean
  onFocus: any
  onMouseEnter: any
}) {
  const elm = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (selected) {
      elm.current?.scrollIntoView({block: 'nearest'})
    }
  }, [selected])

  return (
    <Button
      ref={elm}
      key={item.key}
      onPress={() => {
        item.onSelect()
      }}
      backgroundColor={selected ? '$brand4' : undefined}
      hoverStyle={{
        backgroundColor: selected ? '$brand4' : undefined,
      }}
      onFocus={onFocus}
      onMouseEnter={onMouseEnter}
    >
      <XStack f={1} justifyContent="space-between">
        <SizableText numberOfLines={1}>{item.title}</SizableText>

        <SizableText color="$color10">{item.subtitle}</SizableText>
      </XStack>
    </Button>
  )
}
