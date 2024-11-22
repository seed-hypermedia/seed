import {useAppContext} from '@/app-context'
import {useGatewayUrlStream} from '@/models/gateway-settings'
import {
  Button,
  ErrorBlock,
  Pencil,
  QueryBlockPlaceholder,
  SelectField,
  SwitchField,
  Tooltip,
  usePopoverState,
  XStack,
  YStack,
} from '@shm/ui'
import {Fragment} from '@tiptap/pm/model'

import {SearchInput} from '@/components/search-input'
import {NodeSelection, TextSelection} from 'prosemirror-state'
import {useCallback, useMemo, useState} from 'react'
import {Block, BlockNoteEditor} from './blocknote'
import {MultipleNodeSelection} from './blocknote/core/extensions/SideMenu/MultipleNodeSelection'
import {createReactBlockSpec, useEditorSelectionChange} from './blocknote/react'
import {EditorQueryBlock} from './editor-types'
import {HMBlockSchema} from './schema'
import {getNodesInSelection} from './utils'

function BlockError() {
  return <ErrorBlock message="Failed to load this Embedded document" />
}

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
      default: '[{"space": "", "path": "", "mode": "Children"}]',
    },
    querySort: {
      default: '[{"term": "UpdateTime", "reverse": false}]',
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
  const {queryClient} = useAppContext()
  const gwUrl = useGatewayUrlStream()
  const tiptapEditor = editor._tiptapEditor

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

  useEditorSelectionChange(editor, updateSelection)

  const assign = useCallback(
    (props: Partial<EditorQueryBlock['props']>) => {
      // @ts-ignore because we have literal string values here that should be ok.
      editor.updateBlock(block.id, {props})
    },
    [editor, block.id],
  )

  return (
    <YStack
      // @ts-ignore
      contentEditable={false}
      group="item"
      borderColor={selected ? '$color8' : '$colorTransparent'}
      borderWidth={3}
      borderRadius="$2"
    >
      <QuerySettings block={block} onValuesChange={assign} />
      <QueryBlockPlaceholder styleType={block.props.style as 'Card' | 'List'} />
    </YStack>
  )
}

function QuerySettings({
  block,
  onValuesChange,
}: {
  block: EditorQueryBlock
  onValuesChange: (props: EditorQueryBlock['props']) => void
}) {
  const popoverState = usePopoverState()
  const [search, setSearch] = useState('')

  const queryIncludes = useMemo(() => {
    return JSON.parse(block.props.queryIncludes || '[]')
  }, [block.props.queryIncludes])
  const querySort = useMemo(() => {
    return JSON.parse(block.props.querySort || '[]')
  }, [block.props.querySort])
  console.log(`== ~ queryValues ~ queryIncludes:`, {
    block,
    queryIncludes,
    querySort,
  })

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
        jc="flex-end"
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
              overflow="hidden"
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
              <XStack position="relative" bg="$background" w="100%">
                <SearchInput
                  onSelect={({id, route}) => {
                    console.log('SELECT QUERY', {id, route})
                  }}
                />
              </XStack>

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

                  onValuesChange({queryIncludes: JSON.stringify(newVal)})
                }}
              />
              <SelectField
                size="$2"
                value={block.props.style}
                onValue={(value) => {
                  onValuesChange({style: value as 'Card' | 'List'})
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
