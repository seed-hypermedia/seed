import {Block, BlockNoteEditor, defaultProps} from '@/blocknote/core'
import {createReactBlockSpec} from '@/blocknote/react'
import {MediaContainer} from '@/media-container'
import {DisplayComponentProps, MediaRender} from '@/media-render'
import {HMBlockSchema} from '@/schema'
import {formatBytes} from '@shm/shared/utils/format-bytes'
import {File} from '@shm/ui/icons'
import {Button} from '@shm/ui/legacy/button'
import {SizableText} from '@shm/ui/text'

export const MaxFileSizeMB = 150
export const MaxFileSizeB = MaxFileSizeMB * 1024 * 1024

export const FileBlock = createReactBlockSpec({
  type: 'file',
  propSchema: {
    ...defaultProps,

    url: {
      default: '',
    },
    fileBinary: {
      default: '',
    },
    name: {
      default: '',
    },
    src: {
      default: '',
    },
    defaultOpen: {
      values: ['false', 'true'],
      default: 'false',
    },
    size: {
      default: '0',
    },
  },
  containsInlineContent: true,
  // @ts-ignore
  render: ({
    block,
    editor,
  }: {
    block: Block<HMBlockSchema>
    editor: BlockNoteEditor<HMBlockSchema>
  }) => Render(block, editor),
})

const Render = (
  block: Block<HMBlockSchema>,
  editor: BlockNoteEditor<HMBlockSchema>,
) => {
  return (
    <MediaRender
      block={block}
      hideForm={!!block.props.url || !!block.props.fileBinary}
      editor={editor}
      mediaType="file"
      DisplayComponent={display}
      icon={<File />}
    />
  )
}

const display = ({
  editor,
  block,
  selected,
  setSelected,
  assign,
}: DisplayComponentProps) => {
  return (
    <MediaContainer
      editor={editor}
      block={block}
      mediaType="file"
      selected={selected}
      setSelected={setSelected}
      assign={assign}
    >
      <Button
        borderWidth={0}
        borderRadius={1}
        size="$5"
        fontSize="$4"
        flex={1}
        justifyContent="flex-start"
        icon={<File />}
        disabled
        userSelect="none"
      >
        <SizableText
          size="md"
          className="flex-1 truncate overflow-hidden whitespace-nowrap"
        >
          {block.props.name}
        </SizableText>
        <SizableText className="pt-1" color="muted" size="sm">
          {formatBytes(parseInt(block.props.size))}
        </SizableText>
      </Button>
    </MediaContainer>
  )
}
