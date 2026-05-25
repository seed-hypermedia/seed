import {HMBlockQuery, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {EditorQueryBlock} from '@seed-hypermedia/client/editor-types'
import {entityQueryPathToHmIdPath} from '@shm/shared'
import {queryQueryBlock} from '@shm/shared/models/queries'
import {useEditorGate} from '@shm/shared/models/use-editor-gate'
import {QueryBlockDraftSlotData, useQueryBlockDrafts} from '@shm/shared/query-block-drafts-context'
import {useUniversalClient} from '@shm/shared/routing'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {Button} from '@shm/ui/button'
import {Input} from '@shm/ui/components/input'
import {SelectField, SwitchField} from '@shm/ui/form-fields'
import {Pencil, Search, Trash} from '@shm/ui/icons'
import {InlineDraftCard} from '@shm/ui/inline-draft-card'
import {InlineDraftListItem} from '@shm/ui/inline-draft-list-item'
import {NewDocumentCard} from '@shm/ui/new-document-card'
import {NewDocumentListItem} from '@shm/ui/new-document-list-item'
import {QueryBlockContent} from '@shm/ui/query-block-content'
import {SizableText} from '@shm/ui/text'
import {Tooltip} from '@shm/ui/tooltip'
import {usePopoverState} from '@shm/ui/use-popover-state'
import {useQuery} from '@tanstack/react-query'
import {Fragment} from '@tiptap/pm/model'
import {ReactNode, useCallback, useEffect, useMemo, useState} from 'react'
import {Block, BlockNoteEditor} from './blocknote'
import {createReactBlockSpec} from './blocknote/react'
import {BlockSelectionWrapper} from './block-selection-wrapper'
import {useQuerySearchInput} from './query-search-context'
import {HMBlockSchema} from './schema'

const defaultQueryIncludes = '[{"space":"","path":"","mode":"Children"}]'
const defaultQuerySort = '[{"term":"UpdateTime","reverse":false}]'

export const QueryBlock = createReactBlockSpec({
  type: 'query',
  propSchema: {
    style: {
      values: ['Card', 'List'],
      default: 'Card',
    },
    columnCount: {
      default: '3',
      values: ['1', '2', '3'],
    },
    queryLimit: {
      default: '',
    },
    queryIncludes: {
      default: defaultQueryIncludes,
    },
    querySort: {
      default: defaultQuerySort,
    },
    banner: {
      default: 'false',
      values: ['true', 'false'],
    },
    defaultOpen: {
      default: 'false',
      values: ['true', 'false'],
    },
  },
  containsInlineContent: true,

  render: ({block, editor}: {block: Block<HMBlockSchema>; editor: BlockNoteEditor<HMBlockSchema>}) =>
    Render(block, editor),

  parseHTML: [
    {
      tag: 'div[data-content-type=query]',
      priority: 1000,
      getContent: (_node, _schema) => {
        return Fragment.empty
      },
    },
  ],
})

type HMQueryBlockIncludes = HMBlockQuery['attributes']['query']['includes']
type HMQueryBlockSort = NonNullable<HMBlockQuery['attributes']['query']['sort']>

function Render(block: Block<HMBlockSchema>, editor: BlockNoteEditor<HMBlockSchema>) {
  const client = useUniversalClient()
  const queryIncludes: HMQueryBlockIncludes = useMemo(() => {
    return JSON.parse(block.props.queryIncludes || defaultQueryIncludes)
  }, [block.props.queryIncludes])

  const querySort = useMemo(() => {
    return JSON.parse(block.props.querySort || defaultQuerySort)
  }, [block.props.querySort])

  const banner = block.props.banner === 'true'
  const queryTargetId = useMemo<UnpackedHypermediaId | null>(() => {
    const include = queryIncludes?.[0]
    if (!include?.space) return null
    return hmId(include.space, {
      path: entityQueryPathToHmIdPath(include.path),
      latest: true,
    })
  }, [queryIncludes])
  const queryLimit = useMemo(() => {
    const parsed = parseInt(block.props.queryLimit || '', 10)
    return parsed > 0 ? parsed : undefined
  }, [block.props.queryLimit])
  const queryBlockInput = useMemo(() => {
    if (!queryIncludes?.[0]?.space) return null
    return {
      query: {
        includes: queryIncludes,
        sort: querySort,
        limit: queryLimit,
      },
    }
  }, [queryIncludes, querySort, queryLimit])
  const queryBlock = useQuery(queryQueryBlock(client, queryBlockInput))
  const sortedItems = queryBlock.data?.results ?? []

  const {canEdit, beginEditIfNeeded} = useEditorGate()

  const assign = useCallback(
    (props: Partial<EditorQueryBlock['props']>) => {
      beginEditIfNeeded()
      // @ts-ignore
      editor.updateBlock(block.id, {props})
    },
    [editor, block.id, beginEditIfNeeded],
  )

  const interactionSummaries = queryBlock.data?.interactionSummaries ?? {}
  const itemContributors = useMemo(() => {
    const contributors: Record<string, string[]> = {}
    sortedItems.forEach((item) => {
      const uids = new Set(item.authors)
      interactionSummaries[item.id.id]?.authorUids.forEach((uid) => uids.add(uid))
      contributors[item.id.id] = Array.from(uids)
    })
    return contributors
  }, [sortedItems, interactionSummaries])

  const accountsMetadata = queryBlock.data?.accountsMetadata ?? {}
  const style = block.props.style as 'Card' | 'List'
  const {DraftSlot} = useQueryBlockDrafts()

  const renderContent = (slot: QueryBlockDraftSlotData | null) => {
    const {prependItems, bannerContent} = buildSlotItems(slot, style, banner)
    return (
      <QueryBlockContent
        items={sortedItems}
        style={style}
        columnCount={block.props.columnCount}
        banner={bannerContent ? false : banner}
        accountsMetadata={accountsMetadata}
        itemContributors={itemContributors}
        interactionSummaries={interactionSummaries}
        isDiscovering={queryBlock.isLoading}
        prependItems={prependItems}
        bannerContent={bannerContent}
      />
    )
  }

  return (
    <BlockSelectionWrapper editor={editor} block={block}>
      <div className="group relative -mx-4 flex flex-col px-4 select-none">
        {canEdit && (
          <QuerySettings
            queryDocName={queryBlock.data?.queryTargetName || ''}
            queryIncludes={queryIncludes}
            querySort={querySort}
            style={style}
            banner={banner}
            // @ts-expect-error
            block={block}
            editor={editor}
            beginEditIfNeeded={beginEditIfNeeded}
            onValuesChange={({id, props}) => {
              assign(props)
            }}
          />
        )}
        {/* Stop mousedown propagation so ProseMirror doesn't intercept clicks on item links */}
        <div onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
          {DraftSlot ? (
            <DraftSlot targetId={queryTargetId}>{(data) => renderContent(data)}</DraftSlot>
          ) : (
            renderContent(null)
          )}
        </div>
      </div>
    </BlockSelectionWrapper>
  )
}

function buildSlotItems(
  slot: QueryBlockDraftSlotData | null,
  style: 'Card' | 'List',
  banner: boolean,
): {prependItems?: ReactNode[]; bannerContent?: ReactNode} {
  if (!slot) return {}
  const {drafts, onCreateDraft, onOpenDraft, onDeleteDraft, onUpdateDraftName} = slot

  const createButton = onCreateDraft ? (
    style === 'Card' ? (
      <NewDocumentCard key="new-doc-btn" onCreateDraft={onCreateDraft} />
    ) : (
      <NewDocumentListItem key="new-doc-btn" onCreateDraft={onCreateDraft} />
    )
  ) : null

  const hasDrafts = drafts.length > 0 && !!onOpenDraft && !!onDeleteDraft && !!onUpdateDraftName
  if (!hasDrafts) {
    return createButton ? {prependItems: [createButton]} : {}
  }

  if (style === 'Card') {
    const cards = drafts.map(({draft, autoFocus}) => (
      <InlineDraftCard
        key={`draft-${draft.id}`}
        draft={draft}
        autoFocus={autoFocus}
        onOpenDraft={onOpenDraft!}
        onDeleteDraft={onDeleteDraft!}
        onUpdateDraftName={onUpdateDraftName!}
      />
    ))
    if (banner && cards.length > 0) {
      const bannerDraft = drafts[0]!
      const bannerEl = (
        <InlineDraftCard
          key={`draft-banner-${bannerDraft.draft.id}`}
          draft={bannerDraft.draft}
          autoFocus={bannerDraft.autoFocus}
          banner
          onOpenDraft={onOpenDraft!}
          onDeleteDraft={onDeleteDraft!}
          onUpdateDraftName={onUpdateDraftName!}
        />
      )
      const remainingCards = cards.slice(1)
      return {
        prependItems: createButton ? [createButton, ...remainingCards] : remainingCards,
        bannerContent: bannerEl,
      }
    }
    return {prependItems: createButton ? [createButton, ...cards] : cards}
  }

  const listItems = drafts.map(({draft, autoFocus}) => (
    <InlineDraftListItem
      key={`draft-${draft.id}`}
      draft={draft}
      autoFocus={autoFocus}
      onOpenDraft={onOpenDraft!}
      onDeleteDraft={onDeleteDraft!}
      onUpdateDraftName={onUpdateDraftName!}
    />
  ))
  return {prependItems: createButton ? [createButton, ...listItems] : listItems}
}

function QuerySettings({
  queryDocName = '',
  block,
  onValuesChange,
  queryIncludes,
  querySort,
  editor,
  banner,
  beginEditIfNeeded,
}: {
  queryDocName: string
  block: EditorQueryBlock
  queryIncludes: HMQueryBlockIncludes
  querySort: HMQueryBlockSort
  banner: boolean
  onValuesChange: ({id, props}: {id: UnpackedHypermediaId | null; props: EditorQueryBlock['props']}) => void
  editor: BlockNoteEditor<HMBlockSchema>
  beginEditIfNeeded: () => void
}) {
  // @ts-expect-error
  const popoverState = usePopoverState(block.props.defaultOpen === 'true')
  const [limit, setLimit] = useState(!!block.props.queryLimit)

  useEffect(() => {
    // @ts-expect-error
    if (block.props.defaultOpen === 'true') {
      editor.updateBlock(block.id, {
        ...block,
        // @ts-expect-error
        props: {...block.props, defaultOpen: 'false'},
      })
    }
    {
    }
    // @ts-expect-error
  }, [block.props.defaultOpen])

  return (
    <>
      <div className="relative flex justify-end py-1">
        <Tooltip content="Edit Query">
          <Button
            size="icon"
            variant="ghost"
            className={`hover:bg-background bg-white transition-opacity dark:bg-black ${
              popoverState.open ? 'opacity-100' : 'opacity-0'
            } group-hover:opacity-100`}
            onClick={() => popoverState.onOpenChange(!popoverState.open)}
          >
            <Pencil className="size-4" />
          </Button>
        </Tooltip>

        {popoverState.open && (
          <div
            className="bg-background absolute top-full right-0 z-30 mt-1 flex w-full max-w-[350px] flex-col gap-4 rounded-lg p-4 shadow-lg"
            // Prevent ProseMirror from intercepting focus-stealing events when
            // the editor is still read-only. Without this the search input
            // below cannot be focused until the doc is in edit mode.
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <QuerySearch
              selectedDocName={queryDocName}
              beginEditIfNeeded={beginEditIfNeeded}
              onSelect={({id}) => {
                if (id) {
                  const newVal: HMQueryBlockIncludes = [
                    {
                      ...queryIncludes[0],
                      space: id.uid,
                      path: id.path && id.path.length ? id.path.join('/') : '',
                      mode: queryIncludes[0]?.mode ? queryIncludes[0]?.mode : 'AllDescendants',
                    },
                  ]
                  onValuesChange({
                    id,
                    props: {
                      ...block.props,
                      queryIncludes: JSON.stringify(newVal),
                    },
                  })
                }
              }}
            />

            <SelectField
              value={queryIncludes[0]?.mode ?? 'Children'}
              onValue={(value) => {
                let newVal = [
                  {
                    ...queryIncludes[0],
                    mode: value,
                  },
                ]
                onValuesChange({
                  id: null,
                  props: {
                    ...block.props,
                    queryIncludes: JSON.stringify(newVal),
                  },
                })
              }}
              id="showChildren"
              options={[
                {label: 'Show only Direct Children', value: 'Children'},
                {label: 'Show all Descendants', value: 'AllDescendants'},
              ]}
            />

            <SelectField
              value={block.props.style}
              onValue={(value) => {
                onValuesChange({
                  id: null,
                  props: {...block.props, style: value as 'Card' | 'List'},
                })
              }}
              label="View"
              id="view"
              options={[
                {label: 'Card', value: 'Card'},
                {label: 'List', value: 'List'},
              ]}
            />
            <SelectField
              // @ts-ignore
              value={querySort[0].term}
              onValue={(value) => {
                let newVal = [
                  {
                    ...querySort[0],
                    term: value,
                  },
                ]
                onValuesChange({
                  id: null,
                  props: {
                    ...block.props,
                    querySort: JSON.stringify(newVal),
                  },
                })
              }}
              label="Sort by"
              id="sort"
              options={[
                {label: 'Update time', value: 'UpdateTime'},
                {label: 'Create time', value: 'CreateTime'},
                {label: 'Display time', value: 'DisplayTime'},
                {label: 'Latest activity', value: 'ActivityTime'},
                {label: 'By Title', value: 'Title'},
              ]}
            />
            {block.props.style == 'Card' ? (
              <>
                <SelectField
                  value={block.props.columnCount || '3'}
                  onValue={(value) => {
                    onValuesChange({
                      id: null,
                      props: {
                        ...block.props,
                        columnCount: value as '1' | '2' | '3',
                      },
                    })
                  }}
                  label="Columns"
                  id="columns"
                  options={[
                    {label: '1', value: '1'},
                    {label: '2', value: '2'},
                    {label: '3', value: '3'},
                  ]}
                />
                <SwitchField
                  label="Show Banner"
                  id="banner"
                  defaultChecked={banner}
                  // @ts-expect-error
                  opacity={banner ? 1 : 0.4}
                  onCheckedChange={(value) => {
                    onValuesChange({
                      id: null,
                      props: {
                        ...block.props,
                        banner: value ? 'true' : 'false',
                      },
                    })
                  }}
                />
              </>
            ) : null}

            <SwitchField
              label="Reverse"
              // @ts-ignore
              defaultChecked={querySort[0].reverse}
              id="sort-reverse"
              onCheckedChange={(value) => {
                let newVal = [
                  {
                    ...querySort[0],
                    reverse: value,
                  },
                ]
                onValuesChange({
                  id: null,
                  props: {
                    ...block.props,
                    querySort: JSON.stringify(newVal),
                  },
                })
              }}
            />
            <SwitchField
              label="Limit Result Count"
              id="limit"
              defaultChecked={limit}
              onCheckedChange={(value) => {
                setLimit(value)
                onValuesChange({
                  id: null,
                  props: {
                    ...block.props,
                    queryLimit: value ? block.props.queryLimit || '10' : '',
                  },
                })
              }}
            />
            {limit ? (
              <Input
                type="number"
                value={block.props.queryLimit}
                onChangeText={(value) => {
                  onValuesChange({
                    id: null,
                    props: {
                      ...block.props,
                      queryLimit: value,
                    },
                  })
                }}
                placeholder="Item Count"
              />
            ) : null}
            <div className="border-border -mt-1 flex flex-col gap-2 border-t">
              <div className="flex justify-end">
                <Button
                  size="icon"
                  onClick={() => {
                    beginEditIfNeeded()
                    editor.removeBlocks([block.id])
                  }}
                >
                  <Trash className="size-4" />
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      {popoverState.open && <div className="fixed inset-0 z-10" onClick={() => popoverState.onOpenChange(false)} />}
    </>
  )
}

function QuerySearch({
  selectedDocName = '',
  onSelect,
  allowWebURL,
  beginEditIfNeeded,
}: {
  selectedDocName?: string | null | undefined
  onSelect: ({id, webUrl}: {id?: UnpackedHypermediaId; webUrl?: string}) => void
  allowWebURL?: boolean
  beginEditIfNeeded?: () => void
}) {
  const SearchInputComponent = useQuerySearchInput()
  const [showSearch, setShowSearch] = useState(false)

  return (
    <div className="relative flex flex-col">
      <Button
        onClick={() => {
          // Flip the editor to editable before the search input mounts so
          // ProseMirror stops stealing focus from the embedded <Input>.
          beginEditIfNeeded?.()
          setShowSearch(true)
        }}
        className="border-border hover:bg-input h-9 gap-2 overflow-hidden border"
      >
        <Search className="size-4 shrink-0" />
        <SizableText
          family="default"
          className="max-w-full flex-1 truncate text-left"
          style={{
            color: selectedDocName ? 'text-foreground' : 'muted-foreground',
          }}
        >
          {selectedDocName || 'Search Hypermedia Document'}
        </SizableText>
      </Button>
      {showSearch && SearchInputComponent ? (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setShowSearch(false)} />
          <div className="no-window-drag border-muted bg-background absolute -top-2 -left-2 z-40 h-[260px] min-h-[80%] w-[calc(100%+16px)] max-w-[800px] rounded-md border p-2 shadow-lg">
            <SearchInputComponent
              onClose={() => setShowSearch(false)}
              allowWebURL={allowWebURL}
              onSelect={(data) => {
                if (data.id) {
                  setShowSearch(false)
                }
                onSelect(data)
              }}
            />
          </div>
        </>
      ) : null}
    </div>
  )
}
