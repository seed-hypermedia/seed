import {LibraryListItem} from '@/components/list-item'
import {SearchInput} from '@/components/search-input'
import {useListDirectory} from '@/models/documents'
import {LibraryData} from '@/models/library'
import {Block, BlockNoteEditor} from '@shm/editor/blocknote'
import {MultipleNodeSelection} from '@shm/editor/blocknote/core/extensions/SideMenu/MultipleNodeSelection'
import {
  createReactBlockSpec,
  useEditorSelectionChange,
} from '@shm/editor/blocknote/react'
import {getNodesInSelection} from '@shm/editor/utils'
import {entityQueryPathToHmIdPath} from '@shm/shared'
import {queryBlockSortedItems} from '@shm/shared/content'
import {EditorQueryBlock} from '@shm/shared/editor-types'
import {
  HMBlockQuery,
  HMEntityContent,
  UnpackedHypermediaId,
} from '@shm/shared/hm-types'
import {useResource, useResources} from '@shm/shared/models/entity'
import {NavRoute} from '@shm/shared/routes'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {Button} from '@shm/ui/button'
import {Input} from '@shm/ui/components/input'
import {DocumentCardGrid} from '@shm/ui/document-content'
import {SelectField, SwitchField} from '@shm/ui/form-fields'
import {Pencil, Search, Trash} from '@shm/ui/icons'
import {SizableText} from '@shm/ui/text'
import {Tooltip} from '@shm/ui/tooltip'
import {usePopoverState} from '@shm/ui/use-popover-state'
import type {UseQueryResult} from '@tanstack/react-query'
import {Fragment} from '@tiptap/pm/model'
import {NodeSelection, TextSelection} from 'prosemirror-state'
import {useCallback, useEffect, useMemo, useState} from 'react'
import {HMBlockSchema} from './schema'

const defaultQueryIncludes = '[{"space":"","path":"","mode":"Children"}]'
const defaultQuerySort = '[{"term":"UpdateTime","reverse":false}]'

export const QueryBlock = createReactBlockSpec({
  type: 'query',
  propSchema: {
    style: {
      values: ['Card', 'List'], // TODO: convert HMEmbedView type to array items
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

  render: ({
    block,
    editor,
  }: {
    block: Block<HMBlockSchema>
    editor: BlockNoteEditor<HMBlockSchema>
  }) => Render(block, editor),

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

function Render(
  block: Block<HMBlockSchema>,
  editor: BlockNoteEditor<HMBlockSchema>,
) {
  const [selected, setSelected] = useState(false)
  const tiptapEditor = editor._tiptapEditor

  console.log(block.props.queryIncludes)

  const queryIncludes: HMQueryBlockIncludes = useMemo(() => {
    return JSON.parse(block.props.queryIncludes || defaultQueryIncludes)
  }, [block.props.queryIncludes])

  const querySort = useMemo(() => {
    return JSON.parse(block.props.querySort || defaultQuerySort)
  }, [block.props.querySort])

  const banner = useMemo(() => {
    return Boolean(block.props.banner == 'true')
  }, [block.props.banner])

  const [queryId, setQueryId] = useState<UnpackedHypermediaId | null>(() => {
    if (queryIncludes?.[0]?.space) {
      return hmId(queryIncludes[0].space, {
        path: queryIncludes[0].path ? queryIncludes[0].path.split('/') : null,
        latest: true,
      })
    }
    return null
  })
  const entity = useResource(queryId, {
    enabled: !!queryId,
  })
  const directoryItems = useListDirectory(queryId, {
    // @ts-ignore
    mode: queryIncludes[0]?.mode,
  })

  const sortedItems = useMemo(() => {
    if (directoryItems.data && querySort) {
      const sorted = queryBlockSortedItems({
        entries: directoryItems.data,
        sort: querySort,
      })
      const queryLimit = parseInt(block.props.queryLimit || '', 10)
      return sorted.slice(0, queryLimit > 0 ? queryLimit : undefined)
    }
    return []
  }, [directoryItems, querySort, block.props.queryLimit])

  const docResults = useResources(
    sortedItems.map((item) =>
      hmId(item.account, {
        path: item.path,
        latest: true,
        version: item.version,
      }),
    ) || [],
    {
      enabled: !!directoryItems.data?.length || false,
    },
  )

  useEditorSelectionChange(editor, updateSelection)

  const assign = useCallback(
    (props: Partial<EditorQueryBlock['props']>) => {
      console.log('ASSIGN', props)
      // @ts-ignore because we have literal string values here that should be ok.
      editor.updateBlock(block.id, {props})
    },
    [editor, block.id],
  )

  function updateSelection() {
    const {view} = tiptapEditor
    const {selection} = view.state
    let isSelected = false

    if (selection instanceof NodeSelection) {
      // If the selection is a NodeSelection, check if this block is the selected node
      const selectedNode = view.state.doc.resolve(selection.from).parent
      if (
        selectedNode &&
        selectedNode.attrs &&
        selectedNode.attrs.id === block.id
      ) {
        isSelected = true
      }
    } else if (
      selection instanceof TextSelection ||
      selection instanceof MultipleNodeSelection
    ) {
      // If it's a TextSelection or MultipleNodeSelection (TODO Fix for drag), check if this block's node is within the selection range
      const selectedNodes = getNodesInSelection(view)
      isSelected = selectedNodes.some(
        (node) => node.attrs && node.attrs.id === block.id,
      )
    }

    setSelected(isSelected)
  }

  const DataComponent = block.props.style == 'List' ? ListView : CardView

  return (
    <div
      // @ts-ignore
      contentEditable={false}
      className={`group -mx-4 flex flex-col px-4 select-none`}
    >
      <QuerySettings
        // @ts-expect-error
        queryDocName={entity.data?.document?.metadata.name || ''}
        queryIncludes={queryIncludes}
        querySort={querySort}
        style={block.props.style as 'Card' | 'List'}
        banner={banner}
        // @ts-expect-error
        block={block}
        editor={editor}
        onValuesChange={({id, props}) => {
          if (id) {
            setQueryId(id)
          }
          assign(props)
        }}
      />
      <DataComponent
        items={docResults}
        block={block as unknown as EditorQueryBlock}
      />
    </div>
  )
}

function CardView({
  items,
  block,
}: {
  block: EditorQueryBlock
  items: Array<UseQueryResult<HMEntityContent | null, unknown>>
}) {
  const banner = useMemo(() => {
    return Boolean(block.props.banner == 'true')
  }, [block.props.banner])

  const docs = useMemo(() => {
    return items.map((item) => {
      if (item.data) {
        return {
          id: item.data.id,
          item: {
            type: 'document',
            path: item.data.id.path,
            metadata: item.data.document?.metadata,
          },
        }
      }
      return null
    })
  }, [items])

  function getEntity(path: string[]) {
    return (
      items.find((item) => item.data?.id?.path?.join('/') == path.join('/'))
        ?.data || null
    )
  }

  const firstItem = banner ? docs[0] : null
  const restItems = banner ? docs.slice(1) : docs

  return (
    <DocumentCardGrid
      // @ts-expect-error
      firstItem={firstItem}
      getEntity={getEntity}
      // @ts-expect-error
      items={restItems}
      accountsMetadata={{}}
      columnCount={parseInt(block.props.columnCount || '1', 10) as number}
    />
  )
}

function ListView({
  items,
  block,
}: {
  block: EditorQueryBlock
  items: Array<UseQueryResult<HMEntityContent | null, unknown>>
}) {
  const entries = useMemo(
    () =>
      items
        .filter((item) => !!item.data)
        .map((item) => {
          return {
            id: item.data?.id,
            document: item.data?.document,
            location: [],
            authors: [],
            isFavorite: false,
            isSubscribed: false,
          } as LibraryData['items'][0]
        }),
    [items],
  )
  return (
    <div className="flex flex-col gap-3">
      {entries.length ? (
        entries.map((entry) => (
          // @ts-expect-error
          <LibraryListItem
            key={entry.id.id}
            entry={entry}
            exportMode={false}
            selected={false}
            toggleDocumentSelection={(id) => {}}
          />
        ))
      ) : (
        <EmptyQueryBlock queryIncludes={block.props.queryIncludes} />
      )}
    </div>
  )
}

function EmptyQueryBlock({queryIncludes}: {queryIncludes: string | undefined}) {
  const queryIncludesData = queryIncludes ? JSON.parse(queryIncludes) : null
  const queryIncludesFirst = queryIncludesData?.[0]
  const includesEntity = useResource(
    queryIncludesFirst
      ? hmId(queryIncludesFirst.space, {
          path: entityQueryPathToHmIdPath(queryIncludesFirst.path),
        })
      : null,
  )
  if (!queryIncludesFirst || !queryIncludesFirst.space) {
    return (
      <BlankQueryBlockMessage message="Empty Query. Select a Document to Query the Children Documents." />
    )
  }
  return (
    <BlankQueryBlockMessage
      // @ts-expect-error
      message={`No Documents found in "${includesEntity.data?.document?.metadata.name}". Add a Document there, or query for other Parent Documents.`}
    />
  )
}

function BlankQueryBlockMessage({message}: {message: string}) {
  return (
    <div className="bg-muted flex items-center rounded-lg p-4">
      <SizableText className="text-muted-foreground">{message}</SizableText>
    </div>
  )
}

type HMQueryBlockIncludes = HMBlockQuery['attributes']['query']['includes']
type HMQueryBlockSort = NonNullable<HMBlockQuery['attributes']['query']['sort']>

function QuerySettings({
  queryDocName = '',
  block,
  onValuesChange,
  queryIncludes,
  querySort,
  editor,
  banner,
}: {
  queryDocName: string
  block: EditorQueryBlock
  queryIncludes: HMQueryBlockIncludes
  querySort: HMQueryBlockSort
  banner: boolean
  onValuesChange: ({
    id,
    props,
  }: {
    id: UnpackedHypermediaId | null
    props: EditorQueryBlock['props']
  }) => void
  editor: BlockNoteEditor<HMBlockSchema>
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
      <div
        className={`query-settings editor-controls absolute left-0 flex h-full w-full items-start justify-end gap-2 p-2 ${
          popoverState.open ? 'z-[999] opacity-100' : 'z-20 opacity-0'
        } group-hover:opacity-100`}
        onClick={
          popoverState.open
            ? (e) => {
                e.stopPropagation()
                popoverState.onOpenChange(false)
              }
            : undefined
        }
        style={{
          top: queryIncludes.length > 0 ? 12 : 0,
        }}
      >
        <Tooltip content="Edit Query">
          <Button
            size="icon"
            onClick={() => popoverState.onOpenChange(!popoverState.open)}
          >
            <Pencil className="size-4" />
          </Button>
        </Tooltip>

        {popoverState.open ? (
          <>
            <div
              className="bg-background z-30 flex w-full max-w-[350px] flex-col gap-4 rounded-lg p-4 shadow-lg"
              onClick={(e) => {
                console.log('CLICK MODAL')
                e.stopPropagation()
              }}
            >
              <QuerySearch
                selectedDocName={queryDocName}
                onSelect={({id, route}) => {
                  console.log('query-block SELECT', id, route)
                  if (id) {
                    const newVal: HMQueryBlockIncludes = [
                      {
                        ...queryIncludes[0],
                        space: id.uid,
                        path:
                          id.path && id.path.length ? id.path.join('/') : '',
                        mode: queryIncludes[0]?.mode
                          ? queryIncludes[0]?.mode
                          : 'AllDescendants',
                      },
                    ]
                    // console.log('=== NEW VAL', id, newVal)
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
                  {
                    label: 'Show only Direct Children',
                    value: 'Children',
                  },
                  {
                    label: 'Show all Descendants',
                    value: 'AllDescendants',
                  },
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
                  {
                    label: 'Card',
                    value: 'Card',
                  },
                  {
                    label: 'List',
                    value: 'List',
                  },
                ]}
              />
              <SelectField
                // @ts-ignore
                value={querySort[0].term}
                onValue={(value) => {
                  console.log('SORT', querySort[0])
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
                  {
                    label: 'Update time',
                    value: 'UpdateTime',
                  },
                  {
                    label: 'Create time',
                    value: 'CreateTime',
                  },
                  {
                    label: 'Display time',
                    value: 'DisplayTime',
                  },
                  // {
                  //   label: 'By Path',
                  //   value: 'Path',
                  // },
                  {
                    label: 'By Title',
                    value: 'Title',
                  },
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
                      {
                        label: '1',
                        value: '1',
                      },
                      {
                        label: '2',
                        value: '2',
                      },
                      {
                        label: '3',
                        value: '3',
                      },
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
                      editor.removeBlocks([block.id])
                    }}
                  >
                    <Trash className="size-4" />
                  </Button>
                </div>
              </div>
            </div>
          </>
        ) : null}
      </div>
      {popoverState.open ? (
        <div
          className="fixed inset-0 z-10"
          onClick={() => popoverState.onOpenChange(false)}
        />
      ) : null}
    </>
  )
}

export function QuerySearch({
  selectedDocName = '',
  onSelect,
  allowWebURL,
}: {
  selectedDocName?: string | null | undefined
  onSelect: ({
    id,
    route,
    webUrl,
  }: {
    id?: UnpackedHypermediaId
    route?: NavRoute
    webUrl?: string
  }) => void
  allowWebURL?: boolean
}) {
  const [showSearch, setShowSearch] = useState(false)

  return (
    <div className="relative flex flex-col">
      <Button
        onClick={() => setShowSearch(true)}
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
      {showSearch ? (
        <>
          <div
            className="fixed inset-0 z-[800]"
            onClick={() => setShowSearch(false)}
          />
          <div className="no-window-drag border-muted bg-background absolute -top-2 -left-2 z-[800] h-[260px] min-h-[80%] w-[calc(100%+16px)] max-w-[800px] rounded-md border p-2 shadow-lg">
            <SearchInput
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
