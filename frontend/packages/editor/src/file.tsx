import {useUniversalAppContext} from '@shm/shared'
import {useEditorGate} from '@shm/shared/models/use-editor-gate'
import {formatBytes} from '@shm/shared/utils/format-bytes'
import {Button} from '@shm/ui/button'
import {extractIpfsUrlCid, getDaemonFileUrl} from '@shm/ui/get-file-url'
import {File} from '@shm/ui/icons'
import {SizableText} from '@shm/ui/text'
import {cn} from '@shm/ui/utils'
import {Block, BlockNoteEditor, defaultProps} from './blocknote/core'
import {createReactBlockSpec} from './blocknote/react'
import {MediaContainer} from './media-container'
import {DisplayComponentProps, MediaRender} from './media-render'
import {HMBlockSchema} from './schema'

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
    mediaRef: {
      default: '', // object with {draftId, mediaId, name, mime, size}
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
  render: ({block, editor}: {block: Block<HMBlockSchema>; editor: BlockNoteEditor<HMBlockSchema>}) =>
    Render(block, editor),
})

const Render = (block: Block<HMBlockSchema>, editor: BlockNoteEditor<HMBlockSchema>) => {
  return (
    <MediaRender
      block={block}
      hideForm={!!block.props.url || !!block.props.fileBinary || !!block.props.mediaRef}
      editor={editor}
      mediaType="file"
      DisplayComponent={FileDisplay}
      icon={<File />}
    />
  )
}

const FileDisplay = ({editor, block, assign}: DisplayComponentProps) => {
  const {saveCidAsFile} = useUniversalAppContext()
  const {isEditing} = useEditorGate()
  const url: string = block.props.url || ''
  const fileCid = url ? extractIpfsUrlCid(url) : ''
  const fileName: string = block.props.name || 'File'
  const showDownload = !!fileCid && !isEditing

  return (
    <MediaContainer editor={editor} block={block} mediaType="file" assign={assign}>
      <div className="group relative w-full">
        <Button className="w-full justify-start px-4 py-3 select-none" disabled>
          <File className="size-4 shrink-0" />
          <SizableText size="md" className="min-w-0 flex-1 truncate overflow-hidden whitespace-nowrap">
            {block.props.name}
          </SizableText>
          <SizableText className="shrink-0 pt-1" color="muted" size="sm">
            {/* @ts-ignore */}
            {formatBytes(parseInt(block.props.size))}
          </SizableText>
        </Button>
        {showDownload && (
          <Button
            variant="accent"
            size="xs"
            className={cn(
              'sel-btn absolute top-2 right-2 z-10 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100',
            )}
            asChild
          >
            {saveCidAsFile ? (
              <a
                download
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  saveCidAsFile(fileCid, fileName)
                }}
              >
                download
              </a>
            ) : (
              <a
                href={getDaemonFileUrl(url, fileName)}
                onClick={(e) => {
                  e.stopPropagation()
                }}
                download={fileName}
              >
                download
              </a>
            )}
          </Button>
        )}
      </div>
    </MediaContainer>
  )
}
