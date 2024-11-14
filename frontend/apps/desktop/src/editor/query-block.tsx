import {useAppContext} from '@/app-context'
import {useGatewayUrlStream} from '@/models/gateway-settings'
import {ErrorBlock, SizableText, XStack} from '@shm/ui'
import {Fragment} from '@tiptap/pm/model'
import {MediaContainer} from './media-container'

import {RiGridFill} from 'react-icons/ri'
import {Block, BlockNoteEditor} from './blocknote'
import {createReactBlockSpec} from './blocknote/react'
import {DisplayComponentProps, MediaRender} from './media-render'
import {HMBlockSchema} from './schema'

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
      default: '',
    },
    querySort: {
      default: '',
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
  const {queryClient} = useAppContext()
  const gwUrl = useGatewayUrlStream()
  return (
    <MediaRender
      block={block}
      hideForm={!!block.props.queryIncludes}
      editor={editor}
      mediaType="query"
      DisplayComponent={display}
      icon={<RiGridFill />}
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
      mediaType="query"
      selected={selected}
      setSelected={setSelected}
      assign={assign}
    >
      <XStack height="$5" width="100%" jc="center" ai="center">
        <SizableText>Query</SizableText>
      </XStack>
    </MediaContainer>
  )
}
