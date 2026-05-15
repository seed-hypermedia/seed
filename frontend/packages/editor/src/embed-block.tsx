import {resolveHypermediaUrl} from '@seed-hypermedia/client'
import {HMBlockEmbed, HMEmbedViewSchema} from '@seed-hypermedia/client/hm-types'
import {useGatewayUrlStream} from '@shm/shared/gateway-url'
import {useRecents} from '@shm/shared/models/recents'
import {useSearch} from '@shm/shared/models/search'
import {useEditorGate} from '@shm/shared/models/use-editor-gate'
import {isHypermediaScheme, isPublicGatewayLink, normalizeHmId, packHmId} from '@shm/shared/utils/entity-id-url'
import {Button} from '@shm/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@shm/ui/components/dropdown-menu'
import {Input} from '@shm/ui/components/input'
import {DraftBadge} from '@shm/ui/draft-badge'
import {BlockEmbedCard, BlockEmbedComments, BlockEmbedContent} from '@shm/ui/embed-views'
import {useImageUrl} from '@shm/ui/get-file-url'
import {ExternalLink, FileText, MoreHorizontal} from '@shm/ui/icons'
import {RecentSearchResultItem, SearchResultItem} from '@shm/ui/search'
import {Separator} from '@shm/ui/separator'
import {SizableText} from '@shm/ui/text'
import {toast} from '@shm/ui/toast'
import {cn} from '@shm/ui/utils'
import {Fragment} from '@tiptap/pm/model'
import {Pencil, Trash2} from 'lucide-react'
import {useEffect, useState} from 'react'
import {Block, BlockNoteEditor} from './blocknote'
import {createReactBlockSpec} from './blocknote/react'
import {useDraftActions} from './draft-actions-context'
import {EmbedEditorView} from './embed-editor'
import {MediaContainer} from './media-container'
import {DisplayComponentProps, MediaRender, MediaType} from './media-render'
import {HMBlockSchema} from './schema'

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
    draftId: {
      default: '',
    },
  },
  containsInlineContent: true,

  render: ({block, editor}: {block: Block<HMBlockSchema>; editor: BlockNoteEditor<HMBlockSchema>}) =>
    Render(block, editor),

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

// Visual for an inline draft embed.
function DraftEmbedPlaceholder({
  draftId,
  editor,
  blockId,
}: {
  draftId: string
  editor: BlockNoteEditor<HMBlockSchema>
  blockId: string
}) {
  const draftActions = useDraftActions()
  const getImageUrl = useImageUrl()
  const draftQuery = draftActions?.useInlineDraft(draftId)
  const draft = draftQuery?.data
  const metadata = draft?.metadata as {name?: string; summary?: string; icon?: string; cover?: string} | undefined
  const name = metadata?.name || 'Untitled document'
  const summary = metadata?.summary || 'Add some details here'
  // Prefer cover image, but fall back to icon if no cover image is set
  const imageCid = metadata?.cover || metadata?.icon
  const imageUrl = imageCid ? getImageUrl(imageCid, 'S') : undefined

  const handleOpen = () => {
    if (!draft || !draftActions?.onOpenDraft) return
    const editUid = (draft as any).editUid ?? draft.locationUid
    if (!editUid) return
    const editPath =
      (draft as any).editPath?.length > 0 ? (draft as any).editPath : [...(draft.locationPath ?? []), `-${draftId}`]
    draftActions.onOpenDraft(draftId, editPath)
  }

  return (
    <div
      contentEditable={false}
      className="border-input bg-background my-2 flex w-full items-center gap-4 rounded-lg border p-3"
    >
      {/* Cover/icon. Falls back to a file icon placeholder when neither is set */}
      <div className="bg-muted flex aspect-square w-24 shrink-0 items-center justify-center overflow-hidden rounded-md">
        {imageUrl ? (
          <img src={imageUrl} alt="" className="size-full object-cover" />
        ) : (
          <FileText className="text-muted-foreground/60 size-8" strokeWidth={1.5} />
        )}
      </div>

      {/* Title / subtitle / badge */}
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-1">
        <SizableText size="xl" weight="bold" className={draft?.metadata?.name ? '' : 'text-muted-foreground/80'}>
          {name}
        </SizableText>
        <SizableText className="text-muted-foreground/60">{summary}</SizableText>
        <div className="mt-1">
          <DraftBadge />
        </div>
      </div>

      {/* 3-dot menu */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            aria-label="Draft options"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
            }}
          >
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              handleOpen()
            }}
            disabled={!draftActions?.onOpenDraft || !draft}
          >
            <Pencil className="size-4" />
            Open draft
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            onClick={async (e) => {
              e.preventDefault()
              e.stopPropagation()
              if (!draftActions?.onDeleteDraft) return
              try {
                await draftActions.onDeleteDraft(draftId)
                // Also remove the embed block from the parent's content
                editor.removeBlocks([blockId])
              } catch (err) {
                console.error('Failed to delete draft', err)
              }
            }}
            disabled={!draftActions?.onDeleteDraft}
          >
            <Trash2 className="size-4" />
            Delete draft
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

const Render = (block: Block<HMBlockSchema>, editor: BlockNoteEditor<HMBlockSchema>) => {
  // When the embed points at an unpublished child draft,
  // render a placeholder card instead of the URL input form.
  if (block.props.draftId) {
    return <DraftEmbedPlaceholder draftId={block.props.draftId} editor={editor} blockId={block.id} />
  }
  const gwUrl = useGatewayUrlStream()
  const submitEmbed = async (url: string, assign: any, setFileName: any, setLoading: any) => {
    if (isPublicGatewayLink(url, gwUrl) || isHypermediaScheme(url)) {
      const hmLink = normalizeHmId(url, gwUrl)
      const newUrl = hmLink ? hmLink : url
      assign({props: {url: newUrl}} as MediaType)
      const cursorPosition = editor.getTextCursorPosition()
      editor.focus()
      if (cursorPosition.block.id === block.id) {
        if (cursorPosition.nextBlock) editor.setTextCursorPosition(cursorPosition.nextBlock, 'start')
        else {
          editor.insertBlocks([{type: 'paragraph', content: ''}], block.id, 'after')
          editor.setTextCursorPosition(editor.getTextCursorPosition().nextBlock!, 'start')
        }
      }
    } else {
      setLoading(true)
      resolveHypermediaUrl(url, {domainResolver: editor.domainResolver})
        .then((res) => {
          if (res?.hmId) {
            assign({props: {url: packHmId(res.hmId)}} as MediaType)
            const cursorPosition = editor.getTextCursorPosition()
            editor.focus()
            if (cursorPosition.block.id === block.id) {
              if (cursorPosition.nextBlock) editor.setTextCursorPosition(cursorPosition.nextBlock, 'start')
              else {
                editor.insertBlocks([{type: 'paragraph', content: ''}], block.id, 'after')
                editor.setTextCursorPosition(editor.getTextCursorPosition().nextBlock!, 'start')
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
      DisplayComponent={EmbedDisplay}
      icon={<ExternalLink />}
    />
  )
}

const EmbedDisplay = ({editor, block, assign, selected, setSelected}: DisplayComponentProps) => {
  const {canEdit, isEditing} = useEditorGate()
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
        <EditorEmbedContent
          openOnClick={!canEdit || !isEditing}
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
      )}
    </MediaContainer>
  )
}

function EditorEmbedContent({
  block,
  parentBlockId,
  openOnClick,
}: {
  block: HMBlockEmbed
  parentBlockId: string | null
  openOnClick: boolean
}) {
  if (block.attributes.view === 'Card')
    return <BlockEmbedCard block={block} parentBlockId={parentBlockId} openOnClick={openOnClick} />
  if (block.attributes.view === 'Comments')
    return <BlockEmbedComments block={block} parentBlockId={parentBlockId} openOnClick={openOnClick} />
  // if (block.attributes.view === 'Content') // content is the default
  return (
    <BlockEmbedContent
      block={block}
      parentBlockId={parentBlockId}
      openOnClick={openOnClick}
      renderDocumentContent={({embedBlocks}) => <EmbedEditorView blocks={embedBlocks} />}
    />
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
  const searchResults = useSearch(search, {
    includeBody: true,
    contextSize: 20 - search.length,
  })

  const searchItems: SearchResultItem[] =
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
          onSelect: () => assign({props: {url: packHmId(sanitizedId)}} as MediaType),
          subtitle: 'Document',
          searchQuery: item.searchQuery,
          versionTime: item.versionTime || '',
        }
      })
      .filter(Boolean) || []

  const recentItems: SearchResultItem[] =
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
  const activeItems: SearchResultItem[] = isDisplayingRecents ? recentItems : searchItems

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
        <SizableText color="muted" family="default" className="mx-4 text-red-500">
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
              <RecentSearchResultItem item={{...item, id: item.id}} {...sharedProps} />
            ) : (
              <SearchResultItem item={item} {...sharedProps} />
            )}

            {itemIndex !== activeItems.length - 1 ? <Separator className="bg-black/10 dark:bg-white/10" /> : null}
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
        placeholder="Query or input Embed URL…"
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setFocused(false)
            return
          }

          // If Enter is pressed and the input looks like a URL or hypermedia link,
          // blur the input to trigger form submission instead of selecting a search result
          if (e.key === 'Enter') {
            const isUrl = search.startsWith('http://') || search.startsWith('https://') || search.startsWith('hm://')

            if (isUrl) {
              // Blur to trigger form submission with the typed URL
              e.currentTarget.blur()
              setFocused(false)
              return
            }

            // Only select search result if input is NOT a URL
            if (activeItems.length > 0) {
              activeItems[focusedIndex]?.onSelect()
            }
            return
          }

          if (!activeItems.length) return

          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setFocusedIndex((prev) => (prev + 1) % activeItems.length)
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setFocusedIndex((prev) => (prev - 1 + activeItems.length) % activeItems.length)
          }
        }}
        className="border-muted-foreground/30 focus-visible:border-ring text-foreground w-full"
      />

      {content}
    </div>
  )
}
