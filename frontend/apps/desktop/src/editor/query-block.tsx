import {
  Button,
  ButtonFrame,
  ErrorBlock,
  NewspaperCard,
  Pencil,
  QueryBlockPlaceholder,
  Search,
  SelectField,
  SizableText,
  SwitchField,
  Tooltip,
  usePopoverState,
  View,
  XStack,
  YStack,
  YStackProps,
} from '@shm/ui'
import {Fragment} from '@tiptap/pm/model'

import {SearchInput} from '@/components/search-input'
import {useListDirectory} from '@/models/documents'
import {useEntities, useEntity} from '@/models/entities'
import {
  EditorQueryBlock,
  HMBlockQuery,
  hmId,
  NavRoute,
  queryBlockSortedItems,
  UnpackedHypermediaId,
} from '@shm/shared'
import {NodeSelection, TextSelection} from 'prosemirror-state'
import {useCallback, useMemo, useState} from 'react'
import {Block, BlockNoteEditor} from './blocknote'
import {MultipleNodeSelection} from './blocknote/core/extensions/SideMenu/MultipleNodeSelection'
import {createReactBlockSpec, useEditorSelectionChange} from './blocknote/react'
import {HMBlockSchema} from './schema'
import {getNodesInSelection} from './utils'

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

  console.log(`== ~ editor ~ querySort:`, querySort[0])
  const [queryId, setQueryId] = useState<UnpackedHypermediaId | null>(() => {
    if (queryIncludes?.[0].space) {
      console.log('QUERY ID', queryIncludes[0])
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
      console.log('QUERY SORT', querySort)
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

  return (
    <YStack
      // @ts-ignore
      contentEditable={false}
      group="item"
      borderColor={selected ? '$color8' : '$colorTransparent'}
      borderWidth={3}
      borderRadius="$2"
    >
      <QuerySettings
        queryDocName={entity.data?.document?.metadata.name || ''}
        queryIncludes={queryIncludes}
        querySort={querySort}
        // @ts-expect-error
        block={block}
        onValuesChange={({id, props}) => {
          if (id) {
            setQueryId(id)
          }
          assign(props)
        }}
      />

      {docResults?.length ? (
        <XStack f={1} flexWrap="wrap" marginHorizontal="$-3">
          {docResults
            .filter((item) => !!item.data)
            .map((item) => (
              <XStack {...columnProps} p="$3">
                <NewspaperCard
                  id={item.data.id}
                  entity={item.data}
                  key={item.data.id.id}
                  accountsMetadata={[]}
                  flexBasis="100%"
                  $gtSm={{flexBasis: '100%'}}
                  $gtMd={{flexBasis: '100%'}}
                />
              </XStack>
            ))}
        </XStack>
      ) : (
        <QueryBlockPlaceholder
          styleType={block.props.style as 'Card' | 'List'}
        />
      )}
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
}: {
  queryDocName: string
  block: EditorQueryBlock
  queryIncludes: HMQueryBlockIncludes
  querySort: HMQueryBlockSort
  onValuesChange: ({
    id,
    props,
  }: {
    id: UnpackedHypermediaId | null
    props: EditorQueryBlock['props']
  }) => void
}) {
  const popoverState = usePopoverState()

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
        y={8}
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
                onCheckedChange={(value) => {
                  console.log('MODE', queryIncludes[0])
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
                  {
                    label: 'By Path',
                    value: 'Path',
                  },
                  {
                    label: 'By Title',
                    value: 'Title',
                  },
                ]}
              />
              <SwitchField
                label="Reverse?"
                id="sort-everse"
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
      >
        <Search flexShrink={0} size={16} />
        <SizableText
          // color="$color9"
          f={1}
          maxWidth="100%"
          overflow="hidden"
          textOverflow="ellipsis"
          whiteSpace="nowrap"
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
