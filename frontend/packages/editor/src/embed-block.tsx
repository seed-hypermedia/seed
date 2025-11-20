import {HMBlockEmbed} from '@shm/shared'
import {useGatewayUrlStream} from '@shm/shared/gateway-url'
import {HMEmbedViewSchema} from '@shm/shared/hm-types'
import {useRecents} from '@shm/shared/models/recents'
import {useSearch} from '@shm/shared/models/search'
import {resolveHypermediaUrl} from '@shm/shared/resolve-hm'
import {
  hmIdWithVersion,
  isHypermediaScheme,
  isPublicGatewayLink,
  normalizeHmId,
  packHmId,
} from '@shm/shared/utils/entity-id-url'
import {
  BlockEmbedCard,
  BlockEmbedContent,
  ErrorBlock,
} from '@shm/ui/blocks-content'
import {Input} from '@shm/ui/components/input'
import {ExternalLink} from '@shm/ui/icons'
import {RecentSearchResultItem, SearchResultItem} from '@shm/ui/search'
import {Separator} from '@shm/ui/separator'
import {SizableText} from '@shm/ui/text'
import {toast} from '@shm/ui/toast'
import {cn} from '@shm/ui/utils'
import {Fragment} from '@tiptap/pm/model'
import {useEffect, useState} from 'react'
import {ErrorBoundary} from 'react-error-boundary'
import {Block, BlockNoteEditor} from './blocknote'
import {createReactBlockSpec} from './blocknote/react'
// @ts-expect-error
import {SwitcherItem} from './launcher-item'
import {MediaContainer} from './media-container'
import {DisplayComponentProps, MediaRender, MediaType} from './media-render'
import {HMBlockSchema} from './schema'

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
            // @ts-expect-error
            res?.blockRef,
            // @ts-expect-error
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
          <EmbedContent
            parentBlockId={block.props.parentBlockId || null}
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
          />
        </ErrorBoundary>
      )}
    </MediaContainer>
  )
}

function EmbedContent({
  block,
  parentBlockId,
}: {
  block: HMBlockEmbed
  parentBlockId: string | null
}) {
  if (block.attributes.view === 'Card')
    return <BlockEmbedCard block={block} parentBlockId={parentBlockId} />
  if (block.attributes.view === 'Comments') return <div>Discussions View</div>
  // return <BlockEmbedComments block={block} parentBlockId={parentBlockId} />
  // if (block.attributes.view === 'Content') // content is the default
  return <BlockEmbedContent block={block} parentBlockId={parentBlockId} />
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
  const searchResults = useSearch(search, {
    includeBody: true,
    contextSize: 20 - search.length,
  })

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
          subtitle: 'Document',
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
        subtitle: 'Document',
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
    <div
      className={cn(
        focused ? 'flex' : 'hidden',
        'absolute top-full left-0 z-40 max-h-[400px] w-full overflow-auto overflow-x-hidden',
        'flex-col px-3 py-3 opacity-100',
        'bg-muted',
        'rounded-br-md rounded-bl-md',
        'scrollbar-none shadow-sm',
      )}
      style={{
        scrollbarWidth: 'none',
      }}
    >
      {isDisplayingRecents && (
        <SizableText
          color="muted"
          family="default"
          className="mx-4 text-red-500"
        >
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
              <RecentSearchResultItem
                item={{...item, id: item.id}}
                {...sharedProps}
              />
            ) : (
              <SearchResultItem item={item} {...sharedProps} />
            )}

            {itemIndex !== activeItems.length - 1 ? (
              <Separator className="bg-black/10 dark:bg-white/10" />
            ) : null}
          </>
        )
      })}
    </div>
  )

  return (
    <div className="relative flex flex-1 flex-col">
      <Input
        value={search}
        onChange={(e) => {
          const text = e.target.value
          setSearch(text)
          setUrl(text)
          if (fileName.color) {
            setFileName({name: 'Upload File', color: undefined})
          }
        }}
        placeholder="Query or input Embed URL..."
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 150)}
        onKeyDown={(e) => {
          if (!activeItems.length) return

          if (e.key === 'Escape') {
            setFocused(false)
          } else if (e.key === 'Enter') {
            activeItems[focusedIndex]?.onSelect()
          } else if (e.key === 'ArrowDown') {
            e.preventDefault()
            setFocusedIndex((prev) => (prev + 1) % activeItems.length)
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setFocusedIndex(
              (prev) => (prev - 1 + activeItems.length) % activeItems.length,
            )
          }
        }}
        className="border-muted-foreground/30 focus-visible:border-ring text-foreground w-full"
      />

      {content}
    </div>
  )
}
