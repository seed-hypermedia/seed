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
import {useEntities, useEntity} from '@shm/shared/models/entity'
import {NavRoute} from '@shm/shared/routes'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {Button} from '@shm/ui/button'
import {ErrorBlock} from '@shm/ui/document-content'
import {SelectField, SwitchField} from '@shm/ui/form-fields'
import {Pencil, Search} from '@shm/ui/icons'
import {NewspaperCard} from '@shm/ui/newspaper'
import {usePopoverState} from '@shm/ui/use-popover-state'
import type {UseQueryResult} from '@tanstack/react-query'
import {Fragment} from '@tiptap/pm/model'
import {NodeSelection, TextSelection} from 'prosemirror-state'
import {useCallback, useEffect, useMemo, useState} from 'react'
import {
  ButtonFrame,
  SizableText,
  Tooltip,
  View,
  XStack,
  YStack,
  YStackProps,
} from 'tamagui'
import {HMBlockSchema} from './schema'

function BlockError() {
  return <ErrorBlock message="Failed to load this Embedded document" />
}

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
    if (queryIncludes?.[0].space) {
      return hmId('d', queryIncludes[0].space, {
        path: queryIncludes[0].path ? queryIncludes[0].path.split('/') : null,
        latest: true,
      })
    }
    return null
  })
  const entity = useEntity(queryId, {
    enabled: !!queryId,
  })
  const directoryItems = useListDirectory(queryId, {
    mode: queryIncludes[0].mode,
  })

  const sortedItems = useMemo(() => {
    if (directoryItems.data && querySort) {
      return queryBlockSortedItems({
        entries: directoryItems.data,
        sort: querySort,
      })
    }
    return []
  }, [directoryItems, querySort])

  const docResults = useEntities(
    sortedItems.map((item) =>
      hmId('d', item.account, {
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
    <YStack
      // @ts-ignore
      contentEditable={false}
      group="item"
      borderColor={selected ? '$color8' : '$colorTransparent'}
      borderWidth={3}
      borderRadius="$2"
      marginLeft={-16}
      marginRight={-16}
      paddingHorizontal={16}
      userSelect="none"
    >
      <QuerySettings
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
    </YStack>
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

  const firstItem = banner ? items[0] : null
  const restItems = banner ? items.slice(1) : items
  const columnProps = useMemo(() => {
    switch (block.props.columnCount) {
      case '2':
        return {
          flexBasis: '100%',
          $gtSm: {flexBasis: '50%'},
          $gtMd: {flexBasis: '50%'},
        } as YStackProps
      case '3':
        return {
          flexBasis: '100%',
          $gtSm: {flexBasis: '50%'},
          $gtMd: {flexBasis: '33.333%'},
        } as YStackProps
      default:
        return {
          flexBasis: '100%',
          $gtSm: {flexBasis: '100%'},
          $gtMd: {flexBasis: '100%'},
        } as YStackProps
    }
  }, [block.props])

  return (
    <>
      {firstItem ? (
        <NewspaperCard
          id={firstItem.data?.id}
          entity={firstItem.data}
          key={firstItem.data?.id.id}
          accountsMetadata={{}}
          flexBasis="100%"
          $gtSm={{flexBasis: '100%'}}
          $gtMd={{flexBasis: '100%'}}
        />
      ) : null}
      {restItems?.length ? (
        <XStack
          f={1}
          flexWrap="wrap"
          marginHorizontal="$-3"
          justifyContent="center"
        >
          {restItems
            .filter((item) => !!item.data)
            .map((item) => (
              <XStack {...columnProps} p="$3">
                <NewspaperCard
                  id={item.data?.id}
                  entity={item.data}
                  key={item.data?.id.id}
                  accountsMetadata={{}}
                  flexBasis="100%"
                  $gtSm={{flexBasis: '100%'}}
                  $gtMd={{flexBasis: '100%'}}
                />
              </XStack>
            ))}
        </XStack>
      ) : null}
      {!items.length ? (
        <EmptyQueryBlock queryIncludes={block.props.queryIncludes} />
      ) : null}
    </>
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
            id: item.data.id,
            document: item.data?.document,
            hasDraft: false,
            location: [],
            authors: [],
            isFavorite: false,
            isSubscribed: false,
          } as LibraryData['items'][0]
        }),
    [items],
  )
  return (
    <YStack gap="$3">
      {entries.length ? (
        entries.map((entry) => (
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
    </YStack>
  )
}

function EmptyQueryBlock({queryIncludes}: {queryIncludes: string | undefined}) {
  const queryIncludesData = queryIncludes ? JSON.parse(queryIncludes) : null
  const queryIncludesFirst = queryIncludesData?.[0]
  const includesEntity = useEntity(
    queryIncludesFirst
      ? hmId('d', queryIncludesFirst.space, {
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
      message={`No Documents found in "${includesEntity.data?.document?.metadata.name}". Add a Document there, or query for other Parent Documents.`}
    />
  )
}

function BlankQueryBlockMessage({message}: {message: string}) {
  return (
    <YStack backgroundColor="$color4" p="$4" borderRadius="$4" ai="center">
      <SizableText
        fontSize="$4"
        color="$color9"
        fontWeight="bold"
        fontStyle="italic"
      >
        {message}
      </SizableText>
    </YStack>
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
  const popoverState = usePopoverState(block.props.defaultOpen === 'true')

  useEffect(() => {
    if (block.props.defaultOpen === 'true') {
      editor.updateBlock(block.id, {
        ...block,
        props: {...block.props, defaultOpen: 'false'},
      })
    }
  }, [block.props.defaultOpen])

  return (
    <>
      <YStack
        position="absolute"
        zIndex="$zIndex.2"
        // pointerEvents={popoverState.open ? 'none' : undefined}
        onPress={
          popoverState.open
            ? (e) => {
                e.stopPropagation()
                popoverState.onOpenChange(false)
              }
            : undefined
        }
        y={0}
        x={-16}
        width="100%"
        height="100%"
        jc="flex-start"
        ai="flex-end"
        opacity={popoverState.open ? 1 : 0}
        padding="$2"
        gap="$2"
        $group-item-hover={{opacity: 1}}
      >
        <Tooltip content="Edit Query">
          <Button
            size="$2"
            onPress={() => popoverState.onOpenChange(!popoverState.open)}
            icon={Pencil}
            elevation="$2"
          />
        </Tooltip>

        {popoverState.open ? (
          <>
            <YStack
              p="$4"
              bg="$background"
              borderRadius="$4"
              zi="$zIndex.3"
              // overflow="hidden"
              w="100%"
              maxWidth={250}
              onPress={(e) => {
                console.log('CLICK MODAL')
                e.stopPropagation()
              }}
              gap="$4"
              zIndex="$zIndex.3"
              animation="fast"
              enterStyle={{opacity: 0, y: -10}}
              exitStyle={{opacity: 0, y: 10}}
              elevation="$3"
            >
              <QuerySearch
                queryDocName={queryDocName}
                onSelect={({id, route}) => {
                  if (id) {
                    const newVal: HMQueryBlockIncludes = [
                      {
                        ...queryIncludes[0],
                        space: id.uid,
                        path:
                          id.path && id.path.length ? id.path.join('/') : '',
                        mode: queryIncludes[0].mode,
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

              <SwitchField
                label="Show all Children"
                id="mode"
                defaultChecked={queryIncludes[0].mode == 'AllDescendants'}
                opacity={queryIncludes[0].mode == 'AllDescendants' ? 1 : 0.4}
                onCheckedChange={(value) => {
                  let newVal = [
                    {
                      ...queryIncludes[0],
                      mode: value ? 'AllDescendants' : 'Children',
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
              />

              <SelectField
                size="$2"
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
              {block.props.style == 'Card' ? (
                <>
                  <SelectField
                    size="$2"
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

              <SelectField
                size="$2"
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
              <SwitchField
                label="Reverse?"
                defaultChecked={querySort[0].reverse}
                id="sort-everse"
                opacity={querySort[0].reverse ? 1 : 0.4}
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
            </YStack>
          </>
        ) : null}
      </YStack>
      {popoverState.open ? (
        <XStack
          zIndex="$zIndex.1"
          onPress={() => popoverState.onOpenChange(false)}
          fullscreen
          // @ts-ignore
          position="fixed"
          top={0}
          bottom={0}
          right={0}
          left={0}
        />
      ) : null}
    </>
  )
}

function QuerySearch({
  queryDocName = '',
  onSelect,
}: {
  queryDocName: string
  onSelect: ({id, route}: {id?: UnpackedHypermediaId; route?: NavRoute}) => void
}) {
  const [showSearch, setShowSearch] = useState(false)

  return (
    <YStack position="relative">
      <ButtonFrame
        onPress={() => setShowSearch(true)}
        padding="$2"
        h={38}
        gap="$2"
        ai="center"
        borderWidth="$0.5"
        borderColor="$brand5"
      >
        <Search flexShrink={0} size={16} />
        <SizableText
          // color="$color9"
          f={1}
          maxWidth="100%"
          overflow="hidden"
          textOverflow="ellipsis"
          whiteSpace="nowrap"
          color={queryDocName ? '$color' : '$color9'}
        >
          {queryDocName || 'Search Hypermedia Document'}
        </SizableText>
      </ButtonFrame>
      {showSearch ? (
        <>
          <View
            onPress={() => setShowSearch(false)}
            top={0}
            left={0}
            right={0}
            bottom={0}
            // @ts-ignore
            position="fixed"
            zIndex="$zIndex.8"
          />
          <YStack
            elevation="$4"
            className="no-window-drag"
            minHeight="80%"
            position="absolute"
            top={-8}
            left={-8}
            zi="$zIndex.8"
            width="calc(100% + 16px)"
            maxWidth={800}
            backgroundColor="$background"
            borderColor="$color7"
            borderWidth={1}
            borderRadius={6}
            h={260}
            padding="$2"
          >
            <SearchInput
              onClose={() => setShowSearch(false)}
              onSelect={(data) => {
                console.log('SELECT', data)
                setShowSearch(false)
                onSelect(data)
              }}
            />
          </YStack>
        </>
      ) : null}
    </YStack>
  )
}
