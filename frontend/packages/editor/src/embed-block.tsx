import {resolveHypermediaUrl} from '@seed-hypermedia/client'
import {HMBlockEmbed, HMEmbedViewSchema, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {useRouteLink} from '@shm/shared'
import {useDocumentActions} from '@shm/shared/document-actions-context'
import {useGatewayUrlStream} from '@shm/shared/gateway-url'
import {useResource} from '@shm/shared/models/entity'
import {useRecents} from '@shm/shared/models/recents'
import {useSearch} from '@shm/shared/models/search'
import {useEditorGate} from '@shm/shared/models/use-editor-gate'
import {packHmId, unpackHmId} from '@shm/shared/utils/entity-id-url'
import {Button} from '@shm/ui/button'
import {Input} from '@shm/ui/components/input'
import {DraftBadge} from '@shm/ui/draft-badge'
import {BlockEmbedCard, BlockEmbedComments, BlockEmbedContent, BlockEmbedLink} from '@shm/ui/embed-views'
import {ExternalLink, MoreHorizontal} from '@shm/ui/icons'
import {
  DocumentCardShell,
  DocumentCardThumbnail,
  documentCardContainerClassName,
  useDocumentCardMenuItems,
} from '@shm/ui/newspaper'
import {MenuItemType, OptionsDropdown} from '@shm/ui/options-dropdown'
import {RecentSearchResultItem, SearchResultItem} from '@shm/ui/search'
import {Separator} from '@shm/ui/separator'
import {SizableText} from '@shm/ui/text'
import {toast} from '@shm/ui/toast'
import {cn} from '@shm/ui/utils'
import {Fragment} from '@tiptap/pm/model'
import {
  BetweenHorizontalStart,
  Bookmark,
  CreditCard,
  ExternalLink as ExternalLinkIcon,
  Link2,
  Pencil,
  Forward,
  SquareMinus,
  SquarePen,
  Trash2,
} from 'lucide-react'
import {
  type FormEvent,
  type KeyboardEvent,
  Fragment as ReactFragment,
  type SyntheticEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {createPortal} from 'react-dom'
import {BlockSelectionWrapper, useIsBlockSelected} from './block-selection-wrapper'
import {Block, BlockNoteEditor} from './blocknote'
import {createReactBlockSpec} from './blocknote/react'
import {useDraftActions} from './draft-actions-context'
import {EmbedEditorView} from './embed-editor'
import {transformEmbedNode} from './hm-link-preview'
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
      values: ['Content', 'Card', 'Comments', 'Link'], // TODO: convert HMEmbedView type to array items
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
    {
      tag: 'a[data-content-type=embed]',
      priority: 1001,
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
  const draftQuery = draftActions?.useInlineDraft(draftId)
  const draft = draftQuery?.data
  const metadata = draft?.metadata as {name?: string; summary?: string; icon?: string; cover?: string} | undefined
  const [title, setTitle] = useState(metadata?.name || '')
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout>>()
  const summary = metadata?.summary || 'Add some details here'

  useEffect(() => {
    setTitle(metadata?.name || '')
  }, [metadata?.name])

  useEffect(() => {
    if (draftActions?.lastCreatedInlineDraftId !== draftId) return
    containerRef.current?.scrollIntoView?.({behavior: 'smooth', block: 'nearest'})
    inputRef.current?.focus()
    draftActions.clearLastCreatedInlineDraftId?.(draftId)
  }, [draftActions, draftId])

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
    }
  }, [])

  const saveName = useCallback(
    (name: string) => {
      if (!draftActions?.onUpdateDraftName) return
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
      saveTimeoutRef.current = setTimeout(() => {
        draftActions.onUpdateDraftName?.(draftId, name)
      }, 500)
    },
    [draftActions, draftId],
  )

  const flushName = useCallback(
    async (name: string) => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
        saveTimeoutRef.current = undefined
      }
      await draftActions?.onUpdateDraftName?.(draftId, name)
    },
    [draftActions, draftId],
  )

  const handleOpen = useCallback(async () => {
    if (!draft || !draftActions?.onOpenDraft) return
    await flushName(title)
    const editUid = (draft as any).editUid ?? draft.locationUid
    if (!editUid) return
    const editPath =
      (draft as any).editPath?.length > 0 ? (draft as any).editPath : [...(draft.locationPath ?? []), `-${draftId}`]
    draftActions.onOpenDraft(draftId, editPath)
  }, [draft, draftActions, draftId, flushName, title])

  const handleTitleInput = (e: FormEvent<HTMLInputElement>) => {
    e.stopPropagation()
    const name = e.currentTarget.value
    setTitle(name)
    saveName(name)
  }

  const handleTitleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation()
    if (e.key === 'Enter') {
      e.preventDefault()
      void handleOpen()
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      inputRef.current?.blur()
    }
  }

  const stopEditorPropagation = (e: SyntheticEvent) => {
    e.stopPropagation()
  }

  return (
    <div
      ref={containerRef}
      contentEditable={false}
      onClick={(e) => {
        e.stopPropagation()
        void handleOpen()
      }}
      className={cn('my-2', documentCardContainerClassName())}
    >
      <DocumentCardShell
        interactive
        thumbnail={<DocumentCardThumbnail coverImage={metadata?.cover} iconImage={metadata?.icon} />}
        title={
          <input
            ref={inputRef}
            type="text"
            value={title}
            onChange={stopEditorPropagation}
            onInputCapture={handleTitleInput}
            onBeforeInputCapture={stopEditorPropagation}
            onKeyDownCapture={handleTitleKeyDown}
            onMouseDownCapture={stopEditorPropagation}
            onPointerDownCapture={stopEditorPropagation}
            onClickCapture={stopEditorPropagation}
            onPasteCapture={stopEditorPropagation}
            onFocus={stopEditorPropagation}
            onCompositionStartCapture={stopEditorPropagation}
            onCompositionUpdateCapture={stopEditorPropagation}
            onCompositionEndCapture={stopEditorPropagation}
            onBlur={(e) => {
              e.stopPropagation()
              void flushName(title)
            }}
            readOnly={!draftActions?.onUpdateDraftName}
            placeholder="Untitled document"
            className={cn(
              'text-foreground placeholder:text-muted-foreground/80 block w-full truncate border-none bg-transparent font-sans text-lg leading-tight! font-bold outline-none',
              !title && 'text-muted-foreground/80',
            )}
          />
        }
        summary={<p className="text-muted-foreground mt-2 line-clamp-2 font-sans text-sm">{summary}</p>}
        badges={<DraftBadge />}
        actions={
          // Stop clicks on the menu from bubbling to the card's open-draft handler.
          <div onClick={(e) => e.stopPropagation()}>
            <OptionsDropdown
              align="end"
              side="top"
              ariaLabel="Draft options"
              menuItems={[
                {
                  key: 'open',
                  label: 'Open draft',
                  icon: <Pencil className="size-4" />,
                  disabled: !draftActions?.onOpenDraft || !draft,
                  onClick: () => void handleOpen(),
                },
                ...(draftActions?.onMoveDraft
                  ? [
                      {
                        key: 'move',
                        label: 'Move',
                        icon: <Forward className="size-4" />,
                        disabled: !draft,
                        onClick: () => draftActions.onMoveDraft?.(draftId, {embedBlockId: blockId}),
                      },
                    ]
                  : []),
                {
                  key: 'remove',
                  label: 'Remove card',
                  icon: <Trash2 className="size-4" />,
                  variant: 'destructive',
                  onClick: () => editor.removeBlocks([blockId]),
                },
              ]}
            />
          </div>
        }
      />
    </div>
  )
}

// Result of attempting to resolve a URL for embedding. Pure to keep it testable.
export type EmbedResolveResult =
  | {kind: 'direct'; url: string}
  | {kind: 'resolved'; url: string}
  | {kind: 'no-match'}
  | {kind: 'error'; error: unknown}

/**
 * Resolve an arbitrary URL into something usable as an embed reference.
 * - Direct: input was already `hm://` or a public gateway link — normalize and return.
 * - Resolved: arbitrary web URL successfully resolved to a Hypermedia document via the domain resolver / OPTIONS fallback.
 * - No-match: resolver ran without throwing but did not find a Hypermedia hmId.
 * - Error: resolver threw (network failure, CORS, etc).
 */
export async function resolveEmbedUrl(
  url: string,
  opts: {
    gwUrl?: any
    domainResolver?: (hostname: string) => Promise<string | null>
  } = {},
): Promise<EmbedResolveResult> {
  const directHmId = unpackHmId(url)
  if (directHmId) {
    return {kind: 'direct', url: packHmId(directHmId)}
  }
  try {
    const res = await resolveHypermediaUrl(url, {domainResolver: opts.domainResolver})
    if (res?.hmId) {
      return {kind: 'resolved', url: packHmId(res.hmId)}
    }
    return {kind: 'no-match'}
  } catch (error) {
    return {kind: 'error', error}
  }
}

const Render = (block: Block<HMBlockSchema>, editor: BlockNoteEditor<HMBlockSchema>) => {
  // When the embed points at an unpublished child draft,
  // render a placeholder card instead of the URL input form.
  if (block.props.draftId) {
    return (
      <BlockSelectionWrapper editor={editor} block={block}>
        <DraftEmbedPlaceholder draftId={block.props.draftId} editor={editor} blockId={block.id} />
      </BlockSelectionWrapper>
    )
  }
  const gwUrl = useGatewayUrlStream()
  const submitEmbed = async (url: string, assign: any, setFileName: any, setLoading: any) => {
    const advanceCursor = () => {
      const cursorPosition = editor.getTextCursorPosition()
      editor.focus()
      if (cursorPosition.block.id === block.id) {
        if (cursorPosition.nextBlock) editor.setTextCursorPosition(cursorPosition.nextBlock, 'start')
        else {
          editor.insertBlocks([{type: 'paragraph', content: ''}], block.id, 'after')
          editor.setTextCursorPosition(editor.getTextCursorPosition().nextBlock!, 'start')
        }
      }
    }

    setLoading(true)
    const result = await resolveEmbedUrl(url, {gwUrl, domainResolver: editor.domainResolver})
    setLoading(false)

    switch (result.kind) {
      case 'direct':
      case 'resolved':
        assign({props: {url: result.url}} as MediaType)
        advanceCursor()
        return
      case 'no-match':
        console.warn('[embed-block] resolveHypermediaUrl returned no hmId', {
          url,
          hasDomainResolver: !!editor.domainResolver,
        })
        setFileName({
          name: 'Could not resolve URL to a Hypermedia document',
          color: 'red',
        })
        return
      case 'error':
        console.error('[embed-block] resolveHypermediaUrl failed', {
          url,
          hasDomainResolver: !!editor.domainResolver,
          error: result.error,
        })
        setFileName({
          name: 'Failed to reach URL — site may be offline or block requests',
          color: 'red',
        })
        return
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

const EmbedDisplay = ({editor, block, assign}: DisplayComponentProps) => {
  const {canEdit, isEditing} = useEditorGate()
  const isSelected = useIsBlockSelected(editor, block)
  const isCardView = block.props.view === 'Card'
  const isLinkView = block.props.view === 'Link'
  // Card and Link views share the same floating action bar.
  const isAtomicEmbedView = isCardView || isLinkView
  const showActions = canEdit && isEditing && isAtomicEmbedView && !!block.props.url
  const content = (
    <MediaContainer editor={editor} block={block} mediaType="embed" assign={assign}>
      {block.props.url && (
        <EditorEmbedContent
          openOnClick={!canEdit || !isEditing}
          titleLinkOnly={canEdit && !isEditing}
          parentBlockId={block.props.parentBlockId || null}
          hideInlineActions={isEditing && isAtomicEmbedView}
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
      {showActions ? <SelectedEmbedActions editor={editor} block={block} isSelected={isSelected} /> : null}
    </MediaContainer>
  )
  return content
}

/** 3-dot contextual menu for a selected subdocument embed. */
function SubdocumentMenu({
  editor,
  block,
  docId,
}: {
  editor: BlockNoteEditor<HMBlockSchema>
  block: Block<HMBlockSchema>
  docId: UnpackedHypermediaId
}) {
  const docResource = useResource(docId)
  const doc = docResource.data?.type === 'document' ? docResource.data.document : null
  const baseItems = useDocumentCardMenuItems(docId, doc)
  const actions = useDocumentActions()
  const openLink = useRouteLink({key: 'document', id: docId} as any)
  const bookmarked = actions.isBookmarked?.(docId) ?? false
  const currentView = (block.props.view as string) || 'Content'
  const url = block.props.url as string

  // Embed specific items prepended to the document menu.
  const prependedItems: MenuItemType[] = []

  prependedItems.push({
    key: 'open',
    label: 'Open document',
    icon: <ExternalLinkIcon className="size-4" />,
    onClick: (e) => {
      e?.stopPropagation()
      openLink.onClick?.(e as any)
    },
  })

  const docTitle = doc?.metadata?.name || url
  const transformTo = (toType: 'card' | 'embed' | 'link' | 'button') => () => {
    if (toType === 'card') {
      editor.updateBlock(block.id, {props: {view: 'Card'}} as any)
    } else if (toType === 'embed') {
      editor.updateBlock(block.id, {props: {view: 'Content'}} as any)
    } else if (toType === 'link') {
      editor.updateBlock(block.id, {props: {view: 'Link'}} as any)
    } else {
      transformEmbedNode(editor, block.id, url, toType, docTitle)
    }
  }
  const labelWithCurrent = (label: string, isCurrent: boolean) => (isCurrent ? `${label} (current)` : label)
  prependedItems.push({
    key: 'change-view',
    label: 'Change subdocument view',
    icon: <SquarePen className="size-4" />,
    children: [
      {
        key: 'view-card',
        label: labelWithCurrent('Card', currentView === 'Card'),
        icon: <CreditCard className="size-4" />,
        onClick: transformTo('card'),
      },
      {
        key: 'view-embed',
        label: labelWithCurrent('Embed', currentView === 'Content'),
        icon: <BetweenHorizontalStart className="size-4" />,
        onClick: transformTo('embed'),
      },
      {
        key: 'view-link',
        label: labelWithCurrent('Link', currentView === 'Link'),
        icon: <Link2 className="size-4 rotate-135" />,
        onClick: transformTo('link'),
      },
      {
        key: 'view-button',
        label: 'Button',
        icon: <SquareMinus className="size-4" />,
        onClick: transformTo('button'),
      },
    ],
  })

  if (actions.onBookmarkToggle) {
    prependedItems.push({
      key: 'bookmark',
      label: bookmarked ? 'Remove Bookmark' : 'Bookmark',
      icon: <Bookmark className={cn('size-4', bookmarked && 'fill-current')} />,
      onClick: (e) => {
        e?.stopPropagation()
        actions.onBookmarkToggle!(docId)
      },
    })
  }

  // On delete document also remove the block.
  const enhancedBaseItems = baseItems.map((item) =>
    item.key === 'delete'
      ? {
          ...item,
          onClick: (e: any) => {
            item.onClick?.(e)
            editor.removeBlocks([block.id])
          },
        }
      : item,
  )

  const allItems = [...prependedItems, ...enhancedBaseItems]

  return (
    <OptionsDropdown
      align="end"
      button={
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label="Subdocument options"
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
          }}
        >
          <MoreHorizontal className="size-3.5" />
        </Button>
      }
      menuItems={allItems}
    />
  )
}

/** Floating action bar on the bottom right
 * of a Card and Link embeds in edit mode. */
function SelectedEmbedActions({
  editor,
  block,
  isSelected,
}: {
  editor: BlockNoteEditor<HMBlockSchema>
  block: Block<HMBlockSchema>
  isSelected: boolean
}) {
  const url = block.props.url as string
  const docId = useMemo(() => (url ? unpackHmId(url) : null), [url])

  // External URLs have no embed-specific action bar.
  if (!docId) return null

  // Revealed on hover over the card (MediaContainer's `group`) and kept visible
  // while the block is selected.
  return (
    <div
      contentEditable={false}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      className={cn(
        'absolute right-2 bottom-2 z-10 flex items-center gap-1 rounded-md',
        'border-border bg-background border px-1 py-0.5 shadow-sm',
        'opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100',
        isSelected && 'opacity-100',
      )}
    >
      <SubdocumentMenu editor={editor} block={block} docId={docId} />
    </div>
  )
}

function EditorEmbedContent({
  block,
  parentBlockId,
  openOnClick,
  titleLinkOnly,
  hideInlineActions,
}: {
  block: HMBlockEmbed
  parentBlockId: string | null
  openOnClick: boolean
  titleLinkOnly: boolean
  hideInlineActions?: boolean
}) {
  if (block.attributes.view === 'Card')
    return (
      <BlockEmbedCard
        block={block}
        parentBlockId={parentBlockId}
        openOnClick={openOnClick}
        titleLinkOnly={titleLinkOnly}
        hideInlineActions={hideInlineActions}
      />
    )
  if (block.attributes.view === 'Comments')
    return <BlockEmbedComments block={block} parentBlockId={parentBlockId} openOnClick={openOnClick} />
  if (block.attributes.view === 'Link')
    return <BlockEmbedLink block={block} parentBlockId={parentBlockId} openOnClick={openOnClick} />

  // if (block.attributes.view === 'Content') // content is the default
  return (
    <BlockEmbedContent
      block={block}
      parentBlockId={parentBlockId}
      openOnClick={openOnClick}
      renderDocumentContent={({embedBlocks, id, blockRef, blockRange, rootChildrenType}) => (
        <EmbedEditorView
          blocks={embedBlocks}
          id={id}
          focusBlockId={blockRef ?? undefined}
          blockRange={blockRange ?? undefined}
          rootChildrenType={rootChildrenType}
        />
      )}
    />
  )
}

export const EmbedLauncherInput = ({
  editor,
  assign,
  setUrl,
  fileName,
  setFileName,
  submit,
  setLoading,
}: {
  editor: BlockNoteEditor
  assign: any
  setUrl: any
  fileName: any
  setFileName: any
  submit?: (url: string, assign: any, setFileName: any, setLoading: any) => Promise<void> | void | undefined
  setLoading?: any
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
  // Portal the dropdown to document.body so it escapes the .blockNode's
  // stacking context. Otherwise the dropdown is confined to its block and
  // sibling blocks render on top regardless of z-index.
  const inputRef = useRef<HTMLInputElement>(null)
  const [inputRect, setInputRect] = useState<{top: number; left: number; width: number} | null>(null)

  useEffect(() => {
    if (focusedIndex >= activeItems.length) setFocusedIndex(0)
  }, [focusedIndex, activeItems])

  useEffect(() => {
    if (!focused || !inputRef.current) return
    const update = () => {
      if (!inputRef.current) return
      const rect = inputRef.current.getBoundingClientRect()
      setInputRect({top: rect.bottom, left: rect.left, width: rect.width})
    }
    update()
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
  }, [focused])

  let content =
    focused && inputRect
      ? createPortal(
          <div
            className={cn(
              'fixed z-[9999] flex max-h-[400px] flex-col overflow-auto overflow-x-hidden px-3 py-3 opacity-100',
              'bg-muted',
              'rounded-br-md rounded-bl-md',
              'scrollbar-none shadow-sm',
            )}
            style={{
              scrollbarWidth: 'none',
              top: inputRect.top,
              left: inputRect.left,
              width: inputRect.width,
            }}
            // Keep focus on the input when clicking inside the dropdown
            // background.
            onMouseDown={(e) => e.preventDefault()}
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
                onMouseDown: (e: React.MouseEvent) => e.preventDefault(),
              }

              return (
                <ReactFragment key={item.key}>
                  {isDisplayingRecents ? (
                    <RecentSearchResultItem item={{...item, id: item.id}} {...sharedProps} />
                  ) : (
                    <SearchResultItem item={item} {...sharedProps} />
                  )}

                  {itemIndex !== activeItems.length - 1 ? <Separator className="bg-black/10 dark:bg-white/10" /> : null}
                </ReactFragment>
              )
            })}
          </div>,
          document.body,
        )
      : null

  return (
    <div className="relative flex flex-1 flex-col">
      <Input
        ref={inputRef}
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
        onPaste={(e) => {
          // Prevent ProseMirror's editor-level paste handlers (link, markdown,
          // local-media) from intercepting paste events inside this nested
          // <input>. Without this, those handlers call preventDefault and the
          // native input never receives the pasted text.
          e.stopPropagation()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setFocused(false)
            return
          }

          // If Enter is pressed and the input looks like a URL or hypermedia link,
          // submit directly so the embed is created instead of selecting a search result.
          if (e.key === 'Enter') {
            const isUrl = search.startsWith('http://') || search.startsWith('https://') || search.startsWith('hm://')

            if (isUrl) {
              setFocused(false)
              if (submit) {
                submit(search, assign, setFileName, setLoading ?? (() => {}))
              } else {
                e.currentTarget.blur()
              }
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
        className="border-muted-foreground/30 focus-visible:border-ring text-foreground placeholder:text-foreground/50 w-full"
      />

      {content}
    </div>
  )
}
