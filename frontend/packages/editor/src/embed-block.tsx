import {Block, BlockNoteEditor} from '@/blocknote'
import {createReactBlockSpec} from '@/blocknote/react'
import {LauncherItem, RecentLauncherItem, SwitcherItem} from '@/launcher-item'
import {MediaContainer} from '@/media-container'
import {DisplayComponentProps, MediaRender, MediaType} from '@/media-render'
import {HMBlockSchema} from '@/schema'
import {useGatewayUrlStream} from '@shm/shared/gateway-url'
import {HMEmbedViewSchema} from '@shm/shared/hm-types'
import {useRecents} from '@shm/shared/models/recents'
import {useSearch} from '@shm/shared/models/search'
import {resolveHypermediaUrl} from '@shm/shared/resolve-hm'
import {
  hmIdWithVersion,
  HYPERMEDIA_ENTITY_TYPES,
  isHypermediaScheme,
  isPublicGatewayLink,
  normalizeHmId,
  packHmId,
  unpackHmId,
} from '@shm/shared/utils/entity-id-url'
import {
  BlockContentEmbed,
  ErrorBlock,
  useDocContentContext,
} from '@shm/ui/document-content'
import {ExternalLink} from '@shm/ui/icons'
import {Separator} from '@shm/ui/separator'
import {SizableText} from '@shm/ui/text'
import {Fragment} from '@tiptap/pm/model'
import {useEffect, useState} from 'react'
import {ErrorBoundary} from 'react-error-boundary'
import {Input, YStack} from 'tamagui'
import {toast} from '../../ui/src/toast'

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
      resolveHypermediaUrl(url)
        .then((res) => {
          const fullHmId = hmIdWithVersion(
            res?.id,
            res?.version,
            res?.blockRef,
            res?.blockRange,
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
  // const [hovered, setHovered] = useState(false)

  return (
    <MediaContainer
      editor={editor}
      block={block}
      mediaType="embed"
      selected={selected}
      setSelected={setSelected}
      assign={assign}
      // styleProps={{
      //   pointerEvents: activeId && activeId !== block.id ? 'none' : '',
      // }}
      // onHoverIn={() => {
      //   if (!activeId) {
      //     setHovered(true)
      //     setActiveId(block.id)
      //   }
      // }}
      // onHoverOut={() => {
      //   setHovered(false)
      //   if (activeId && activeId === block.id) {
      //     setActiveId(null)
      //   }
      // }}
    >
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
  const {comment} = useDocContentContext()
  const recents = useRecents()
  const searchResults = useSearch(search, {}, true, 20 - search.length)

  const searchItems: SwitcherItem[] =
    searchResults.data?.entities
      ?.map((item) => {
        const title = item.title || item.id.uid
        const sanitizedId = {...item.id, blockRange: null}
        return {
          key: packHmId(sanitizedId),
          title,
          path: item.parentNames,
          icon: item.icon,
          onFocus: () => {},
          onMouseEnter: () => {},
          onSelect: () =>
            assign({props: {url: packHmId(sanitizedId)}} as MediaType),
          subtitle: HYPERMEDIA_ENTITY_TYPES[item.id.type],
          searchQuery: item.searchQuery,
          versionTime: item.versionTime
            ? item.versionTime.toDate().toLocaleString()
            : '',
        }
      })
      .filter(Boolean) || []

  const recentItems =
    recents.data?.map(({id, name}, index) => {
      return {
        key: id.id,
        title: name,
        id,
        path: id.path || [],
        subtitle: HYPERMEDIA_ENTITY_TYPES[id.type],
        onFocus: () => {
          setFocusedIndex(index)
        },
        onMouseEnter: () => {
          setFocusedIndex(index)
        },
        onSelect: () => {
          if (!id) {
            toast.error('Failed to open recent: ' + id + ' ' + name)
            return
          } else {
            assign({props: {url: id.id}} as MediaType)
          }
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
      backgroundColor="$backgroundHover"
      borderTopStartRadius={0}
      borderTopEndRadius={0}
      borderBottomLeftRadius={6}
      borderBottomRightRadius={6}
      position="absolute"
      top="100%"
      left={0}
      width="100%"
      zIndex={999}
      maxHeight={300} // TODO, dynamically update based on window height?
      overflow="auto"
      style={{
        overflowX: 'hidden',
        scrollbarWidth: 'none',
      }}
    >
      {isDisplayingRecents && (
        <SizableText color="muted" className="mx-4">
          Recent Resources
        </SizableText>
      )}
      {activeItems.map((item, itemIndex) => {
        const isSelected = focusedIndex === itemIndex
        const sharedProps = {
          selected: isSelected,
          onFocus: () => setFocusedIndex(itemIndex),
          onMouseEnter: () => setFocusedIndex(itemIndex),
        }

        return (
          <>
            {isDisplayingRecents ? (
              <RecentLauncherItem
                item={{...item, id: item.id}}
                {...sharedProps}
              />
            ) : (
              <LauncherItem item={item} {...sharedProps} />
            )}

            {itemIndex !== activeItems.length - 1 ? <Separator /> : null}
          </>
        )
      })}
    </YStack>
  )

  return (
    <YStack position="relative" flex={1}>
      <Input
        unstyled
        backgroundColor={comment ? '$color6' : '$color4'}
        outlineWidth="$0"
        color="$color12"
        borderColor="$color8"
        borderWidth="$1"
        borderRadius="$2"
        paddingLeft="$3"
        height="$3"
        width="100%"
        hoverStyle={{borderColor: '$color11'}}
        focusStyle={{borderColor: '$color11'}}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 150)}
        autoFocus={false}
        value={search}
        onChangeText={(text: string) => {
          setSearch(text)
          setUrl(text)
          if (fileName.color) {
            setFileName({name: 'Upload File', color: undefined})
          }
        }}
        placeholder="Query or input Embed URL..."
        onKeyPress={(e: any) => {
          if (!activeItems.length) return

          if (e.nativeEvent.key === 'Escape') {
            setFocused(false)
          } else if (e.nativeEvent.key === 'Enter') {
            activeItems[focusedIndex]?.onSelect()
          } else if (e.nativeEvent.key === 'ArrowDown') {
            e.preventDefault()
            setFocusedIndex((prev) => (prev + 1) % activeItems.length)
          } else if (e.nativeEvent.key === 'ArrowUp') {
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
