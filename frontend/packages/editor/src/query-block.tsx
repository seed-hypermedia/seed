import {EditorQueryBlock} from '@seed-hypermedia/client/editor-types'
import {HMBlockQuery, parseHMQueryFiltersJSON, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
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
import {LazyViewportMount} from '@shm/ui/lazy-viewport-mount'
import {QueryBlockContent} from '@shm/ui/query-block-content'
import {useQueryBlockFrontendPerf} from '@shm/ui/query-block-frontend-perf'
import {SizableText} from '@shm/ui/text'
import {Tooltip} from '@shm/ui/tooltip'
import {usePopoverState} from '@shm/ui/use-popover-state'
import {useQuery} from '@tanstack/react-query'
import {Fragment} from '@tiptap/pm/model'
import {Node as PMNode} from 'prosemirror-model'
import {NodeSelection} from 'prosemirror-state'
import {FocusEvent, Profiler, useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {createPortal} from 'react-dom'
import {BlockSelectionWrapper} from './block-selection-wrapper'
import {Block, BlockNoteEditor} from './blocknote'
import {createReactBlockSpec} from './blocknote/react'
import {buildSlotItems} from './query-block-draft-items'
import {useQuerySearchInput} from './query-search-context'
import {HMBlockSchema} from './schema'
import {QueryAccountFilterInput} from './query-account-filter-input'

const defaultQueryIncludes = '[{"space":"","path":"","mode":"Children"}]'
const defaultQuerySort = '[{"term":"UpdateTime","reverse":false}]'
const defaultQueryFilters = '[]'

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
    queryFilters: {
      default: defaultQueryFilters,
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
type HMQueryBlockFilters = NonNullable<HMBlockQuery['attributes']['query']['filters']>

function parseQueryFilters(rawFilters: string | undefined): HMQueryBlockFilters {
  return parseHMQueryFiltersJSON(rawFilters || defaultQueryFilters)
}

function Render(block: Block<HMBlockSchema>, editor: BlockNoteEditor<HMBlockSchema>) {
  const client = useUniversalClient()
  const queryIncludes: HMQueryBlockIncludes = useMemo(() => {
    return JSON.parse(block.props.queryIncludes || defaultQueryIncludes)
  }, [block.props.queryIncludes])

  const querySort = useMemo(() => {
    return JSON.parse(block.props.querySort || defaultQuerySort)
  }, [block.props.querySort])

  const queryFilters: HMQueryBlockFilters = useMemo(() => {
    return parseQueryFilters(block.props.queryFilters)
  }, [block.props.queryFilters])

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
        filters: queryFilters,
      },
    }
  }, [queryIncludes, querySort, queryLimit, queryFilters])
  const queryBlock = useQuery(queryQueryBlock(client, queryBlockInput))
  const sortedItems = queryBlock.data?.results ?? []

  const {canEdit, beginEditIfNeeded} = useEditorGate()
  const [isSelected, setIsSelected] = useState(false)
  const [isFocusedWithin, setIsFocusedWithin] = useState(false)

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
    const {prependItems, bannerContent} = buildSlotItems(slot, style, banner, sortedItems.length > 0)
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

  const isActive = isSelected || isFocusedWithin
  const {onRender} = useQueryBlockFrontendPerf({
    source: 'editor',
    blockId: block.id,
    queryInput: queryBlockInput,
    style,
    banner,
    active: isActive,
    status: queryBlock.status,
    fetchStatus: queryBlock.fetchStatus,
    data: queryBlock.data,
    error: queryBlock.error,
  })

  const handleBlurCapture = (e: FocusEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
      setIsFocusedWithin(false)
    }
  }

  return (
    <BlockSelectionWrapper editor={editor} block={block} onSelectionChange={setIsSelected}>
      <div
        className="group relative -mx-4 flex flex-col px-4 select-none"
        onFocusCapture={() => setIsFocusedWithin(true)}
        onBlurCapture={handleBlurCapture}
      >
        {canEdit && (
          <QuerySettings
            queryDocName={queryBlock.data?.queryTargetName || ''}
            queryIncludes={queryIncludes}
            querySort={querySort}
            queryFilters={queryFilters}
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
          <LazyViewportMount active={isActive}>
            <Profiler id={`query-block-${block.id}`} onRender={onRender}>
              {DraftSlot ? (
                <DraftSlot targetId={queryTargetId}>{(data) => renderContent(data)}</DraftSlot>
              ) : (
                renderContent(null)
              )}
            </Profiler>
          </LazyViewportMount>
        </div>
      </div>
    </BlockSelectionWrapper>
  )
}

function QuerySettings({
  queryDocName = '',
  block,
  onValuesChange,
  queryIncludes,
  querySort,
  queryFilters,
  editor,
  banner,
  beginEditIfNeeded,
}: {
  queryDocName: string
  block: EditorQueryBlock
  queryIncludes: HMQueryBlockIncludes
  querySort: HMQueryBlockSort
  queryFilters: HMQueryBlockFilters
  banner: boolean
  onValuesChange: ({id, props}: {id: UnpackedHypermediaId | null; props: EditorQueryBlock['props']}) => void
  editor: BlockNoteEditor<HMBlockSchema>
  beginEditIfNeeded: () => void
}) {
  // @ts-expect-error
  const popoverState = usePopoverState(block.props.defaultOpen === 'true')
  const [limit, setLimit] = useState(!!block.props.queryLimit)
  // Portal the popover to document.body so it escapes the .blockNode's
  // stacking context, otherwise siblings rendered later in the document
  // render above it regardless of z-index.
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const [popoverRect, setPopoverRect] = useState<{top: number; right: number} | null>(null)

  useEffect(() => {
    if (!popoverState.open || !triggerRef.current) return
    const update = () => {
      if (!triggerRef.current) return
      const rect = triggerRef.current.getBoundingClientRect()
      // Pin top to just below the trigger and right to the trigger's right
      // edge so the popover hangs off the right side.
      setPopoverRect({top: rect.bottom + 4, right: window.innerWidth - rect.right})
    }
    update()
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
  }, [popoverState.open])

  // Click-outside dismissal. Using a document-level mousedown listener
  // instead of a `fixed inset-0` overlay because the overlay would cover
  // the editor's scroll container and silently block wheel events, leaving
  // scrolling visibly frozen while the popover is open.
  useEffect(() => {
    if (!popoverState.open) return
    const handleOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      if (!target) return
      if (triggerRef.current?.contains(target)) return
      if (popoverRef.current?.contains(target)) return
      if (target.closest('[data-radix-popper-content-wrapper]')) return
      popoverState.onOpenChange(false)
    }
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [popoverState.open, popoverState.onOpenChange])

  // When the popover opens, put a NodeSelection on the query block so
  // ProseMirror keeps it as the active selection..
  useEffect(() => {
    const view = editor._tiptapEditor?.view
    if (!view) return
    if (popoverState.open) {
      view.state.doc.descendants((node: PMNode, pos: number) => {
        if (node.type.name === 'blockNode' && node.attrs?.id === block.id) {
          view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos + 1)))
          return false
        }
        return true
      })
    } else {
      view.focus()
    }
  }, [popoverState.open, editor, block.id])

  useEffect(() => {
    // @ts-expect-error
    if (block.props.defaultOpen === 'true') {
      queueMicrotask(() => {
        editor.updateBlock(block.id, {
          ...block,
          // @ts-expect-error
          props: {...block.props, defaultOpen: 'false'},
        })
      })
    }
    {
    }
    // @ts-expect-error
  }, [block.props.defaultOpen])

  const authorFilters = queryFilters.filter((filter) => filter.type === 'Author')

  const saveFilters = (filters: HMQueryBlockFilters) => {
    const queryFilters = JSON.stringify(filters)
    queueMicrotask(() => {
      onValuesChange({
        id: null,
        props: {
          queryFilters,
        } as EditorQueryBlock['props'],
      })
    })
  }

  const updateAuthorFilters = (uids: string[]) => {
    saveFilters(uids.map((uid) => ({type: 'Author' as const, uid})))
  }

  return (
    <>
      <div className="relative flex justify-end py-1">
        <Tooltip content="Edit Query">
          <Button
            ref={triggerRef}
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

        {popoverState.open &&
          popoverRect &&
          createPortal(
            <div
              ref={popoverRef}
              className="bg-background fixed z-40 flex w-[350px] max-w-[90vw] flex-col gap-4 rounded-lg p-4 shadow-lg"
              style={{top: popoverRect.top, right: popoverRect.right}}
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

              <QueryAccountFilterInput
                selectedUids={authorFilters.map((filter) => filter.uid)}
                onSelectedUidsChange={updateAuthorFilters}
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
            </div>,
            document.body,
          )}
      </div>
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
