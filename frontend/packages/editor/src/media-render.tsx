import {DAEMON_FILE_UPLOAD_URL} from '@shm/shared/constants'
import {useBlocksContentContext} from '@shm/ui/blocks-content'
import {Button} from '@shm/ui/button'
import {Input} from '@shm/ui/components/input'
import {Label} from '@shm/ui/components/label'
import {useFileUrl} from '@shm/ui/get-file-url'
import {Upload} from '@shm/ui/icons'
import {Spinner} from '@shm/ui/spinner'
import {SizableText} from '@shm/ui/text'
import {Tooltip} from '@shm/ui/tooltip'
import {cn} from '@shm/ui/utils'
import {NodeSelection, TextSelection} from 'prosemirror-state'
import {ChangeEvent, FunctionComponent, useEffect, useState} from 'react'
import {BlockNoteEditor} from './blocknote/core/BlockNoteEditor'
import {Block} from './blocknote/core/extensions/Blocks/api/blockTypes'
import {MultipleNodeSelection} from './blocknote/core/extensions/SideMenu/MultipleNodeSelection'
import {useEditorSelectionChange} from './blocknote/react/hooks/useEditorSelectionChange'
import {MaxFileSizeB, MaxFileSizeMB} from './file'
import {HMBlockSchema} from './schema'
import {getNodesInSelection} from './utils'

export type MediaType = {
  id: string
  props: {
    url?: string
    fileBinary?: Uint8Array
    displaySrc?: string
    name: string
    size?: string
    view?: 'Content' | 'Card'
    width?: string
  }
  children: []
  content: []
  type: string
}

export interface DisplayComponentProps {
  editor: BlockNoteEditor<HMBlockSchema>
  block: Block<HMBlockSchema>
  selected: boolean
  setSelected: any
  assign?: any
}

interface RenderProps {
  block: Block<HMBlockSchema>
  editor: BlockNoteEditor<HMBlockSchema>
  mediaType: string
  submit?: (
    url: string,
    assign: any,
    setFileName: any,
    setLoading: any,
  ) => Promise<void> | void | undefined
  icon: JSX.Element | FunctionComponent<{color?: string; size?: number}>
  DisplayComponent: React.ComponentType<DisplayComponentProps>
  CustomInput?: React.ComponentType<{
    editor: BlockNoteEditor<HMBlockSchema>
    assign: any
    setUrl: any
    fileName: any
    setFileName: any
  }>
  hideForm?: boolean
  validateFile?: (file: File) => boolean
}

export function updateSelection(
  editor: BlockNoteEditor<HMBlockSchema>,
  block: Block<HMBlockSchema>,
  setSelected: (selected: boolean) => void,
) {
  const {view} = editor._tiptapEditor
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

export const MediaRender: React.FC<RenderProps> = ({
  block,
  editor,
  mediaType,
  submit,
  DisplayComponent,
  CustomInput,
  icon,
  hideForm,
  validateFile,
}) => {
  const [selected, setSelected] = useState(false)
  const [uploading, setUploading] = useState(false)
  const hasSrc = !!block.props?.src

  useEditorSelectionChange(editor, () =>
    updateSelection(editor, block, setSelected),
  )

  useEffect(() => {
    if (!uploading && hasSrc && editor.importWebFile && block.props.src) {
      // @ts-ignore
      if (block.props.src.startsWith('ipfs')) {
        editor.updateBlock(block, {
          props: {url: block.props.src, src: ''},
        })
        return
      }
      setUploading(true)

      editor
        .importWebFile(block.props.src)
        .then((imageData) => {
          setUploading(false)
          // Desktop result
          if ('cid' in imageData) {
            editor.updateBlock(block, {
              props: {
                url: `ipfs://${imageData.cid}`,
                size: imageData.size.toString(),
                src: '',
              },
            })
          }
          // Web result
          else if ('displaySrc' in imageData && 'fileBinary' in imageData) {
            editor.updateBlock(block, {
              props: {
                displaySrc: imageData.displaySrc,
                // @ts-expect-error - schema defines fileBinary as string but it's actually Uint8Array
                fileBinary: imageData.fileBinary,
                size: imageData.size?.toString() || '',
                src: '',
              },
            })
          }
        })
        .catch((e: any) => {
          console.error('Failed to import web file:', e)
          setUploading(false)
        })
    }
  }, [hasSrc, block, uploading, editor, editor.importWebFile])

  const assignMedia = (props: MediaType) => {
    // we used to spread the current block.props into the new props, but now we just overwrite the whole thing because it was causing bugs
    // @ts-expect-error
    editor.updateBlock(block.id, props)
  }

  const setSelection = (isSelected: boolean) => {
    setSelected(isSelected)
  }

  if (hasSrc || uploading) {
    // this means we have a URL in the props.url that is not starting with `ipfs://`, which means we are uploading the image to IPFS
    return (
      <Button
        contentEditable={false}
        size="lg"
        className="w-full justify-start"
      >
        uploading...
      </Button>
    )
  }

  return (
    // For some reason, the file block is not taking up the full width of the editor on mobile, so we need to add this style
    <div className={cn('flex flex-col', mediaType === 'file' && 'w-full')}>
      {hideForm ? (
        <MediaComponent
          block={block}
          editor={editor}
          assign={assignMedia}
          selected={selected}
          setSelected={setSelection}
          DisplayComponent={DisplayComponent}
        />
      ) : editor.isEditable ? (
        <MediaForm
          block={block}
          assign={assignMedia}
          editor={editor}
          selected={selected}
          mediaType={mediaType}
          CustomInput={CustomInput}
          submit={submit}
          icon={icon}
          validateFile={validateFile}
        />
      ) : (
        <></>
      )}
    </div>
  )
}

function MediaComponent({
  block,
  editor,
  assign,
  selected,
  setSelected,
  DisplayComponent,
}: {
  block: Block<HMBlockSchema>
  editor: BlockNoteEditor<HMBlockSchema>
  assign: any
  selected: boolean
  setSelected: any
  DisplayComponent: React.ComponentType<DisplayComponentProps>
}) {
  return (
    <DisplayComponent
      editor={editor}
      block={block}
      selected={selected}
      setSelected={setSelected}
      assign={assign}
    />
  )
}

function MediaForm({
  block,
  assign,
  editor,
  selected = false,
  mediaType,
  submit,
  icon,
  CustomInput,
  validateFile,
}: {
  block: Block<HMBlockSchema>
  assign: any
  editor: BlockNoteEditor<HMBlockSchema>
  selected: boolean
  mediaType: string
  submit?: (
    url: string,
    assign: any,
    setFileName: any,
    setLoading: any,
  ) => Promise<void> | void | undefined
  icon: JSX.Element | FunctionComponent<{color?: string; size?: number}> | null
  CustomInput?: React.ComponentType<{
    editor: BlockNoteEditor<HMBlockSchema>
    assign: any
    setUrl: any
    fileName: any
    setFileName: any
  }>
  validateFile?: (file: File) => boolean
}) {
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const isEmbed = ['embed', 'web-embed'].includes(mediaType)
  const [fileName, setFileName] = useState<{
    name: string
    color: string | undefined
  }>({
    name: 'Upload File',
    color: undefined,
  })
  const [drag, setDrag] = useState(false)
  const dragProps = {
    onDrop: (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      e.stopPropagation()
      if (drag) setDrag(false)
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        if (mediaType === 'file') {
          const files = Array.from(e.dataTransfer.files)
          handleUpload(Array.from(files))
          return
        }
        let isMedia = true
        const files = Array.from(e.dataTransfer.files)
        files.forEach((file) => {
          if (!file.type.includes(`${mediaType}/`)) {
            setFileName({
              name: `File ${
                file.name.length < 36
                  ? file.name
                  : file.name.slice(0, 32) + '...'
              } is not ${mediaType === 'image' ? 'an' : 'a'} ${mediaType}.`,
              color: 'red',
            })
            isMedia = false
            return
          }
        })
        if (isMedia) handleUpload(Array.from(files))
        return
      }
    },
    onDragOver: (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      e.stopPropagation()
    },
    onDragEnter: (e: React.DragEvent<HTMLDivElement>) => {
      const relatedTarget = e.relatedTarget as HTMLElement
      e.preventDefault()
      e.stopPropagation()
      if (!relatedTarget || !e.currentTarget.contains(relatedTarget)) {
        setDrag(true)
      }
    },
    onDragLeave: (e: React.DragEvent<HTMLDivElement>) => {
      const relatedTarget = e.relatedTarget as HTMLElement
      e.preventDefault()
      e.stopPropagation()
      if (!relatedTarget || !e.currentTarget.contains(relatedTarget)) {
        setDrag(false)
      }
    },
  }

  const {commentStyle} = useBlocksContentContext()
  const getFileUrl = useFileUrl()

  const handleUpload = async (files: File[]) => {
    // @ts-ignore
    if (validateFile && !validateFile(files[0])) {
      return
    }

    const largeFileIndex = files.findIndex((file) => file.size > MaxFileSizeB)

    if (largeFileIndex > -1) {
      const largeFile = files[largeFileIndex]
      setFileName({
        name:
          largeFileIndex > 0
            ? `The size of ${
                // @ts-ignore
                largeFile.name.length < 36
                  ? // @ts-ignore
                    largeFile.name
                  : // @ts-ignore
                    largeFile.name.slice(0, 32) + '...'
              } exceeds ${MaxFileSizeMB} MB.`
            : `The file size exceeds ${MaxFileSizeMB} MB.`,
        color: 'red',
      })
      return
    }

    const file = files[0]
    if (!file) {
      throw new Error('No file selected')
    }
    const {name, size} = file
    if (editor.handleFileAttachment) {
      const {displaySrc, fileBinary} = await editor.handleFileAttachment(file)
      assign({
        props: {
          fileBinary,
          displaySrc: block.type === 'file' ? undefined : displaySrc,
          name,
          size: size.toString(),
        },
      } as MediaType)
    } else {
      // upload to IPFS immediately if handleFileAttachment is not available
      try {
        const formData = new FormData()
        // @ts-ignore
        formData.append('file', files[0])
        const response = await fetch(DAEMON_FILE_UPLOAD_URL, {
          method: 'POST',
          body: formData,
        })

        if (!response.ok) {
          const errorText = await response.text()
          throw new Error(`Server error: ${response.status} - ${errorText}`)
        }

        const responseCID = await response.text()
        if (!responseCID) {
          throw new Error('Failed to upload file to IPFS: No CID returned')
        }
        const ipfsUrl = `ipfs://${responseCID}`
        assign({
          props: {
            url: ipfsUrl,
            displaySrc: getFileUrl(ipfsUrl),
            name,
            size: size.toString(),
          },
        } as MediaType)
      } catch (error) {
        console.error(`Editor: file upload error: ${error}`)
        setFileName({
          name: `Upload failed: ${
            error instanceof Error ? error.message : 'Unknown error'
          }`,
          color: 'red',
        })
      }
    }
  }

  return (
    <div
      className={cn(
        'bg-muted relative flex flex-col rounded-md border-2 transition-colors outline-none',
        drag || selected
          ? 'border-foreground/20 dark:border-foreground/30'
          : 'border-border',
        drag && 'border-dashed',
        commentStyle &&
          !drag &&
          !selected &&
          'border-border bg-black/5 dark:bg-white/10',
      )}
      {...(isEmbed ? {} : dragProps)}
    >
      {drag && !isEmbed && (
        <div className="absolute top-0 left-0 z-5 flex h-full w-full items-center justify-center rounded-sm bg-white/50">
          <SizableText weight="bold">DROP MEDIA HERE</SizableText>
        </div>
      )}
      <div className="flex items-center rounded-sm p-4">
        {mediaType !== 'file' ? (
          <div className="flex flex-1 flex-col">
            <div className="flex w-full flex-1 gap-3">
              {CustomInput ? (
                <CustomInput
                  editor={editor}
                  assign={assign}
                  setUrl={setUrl}
                  fileName={fileName}
                  setFileName={setFileName}
                />
              ) : (
                <Input
                  className="border-muted-foreground/30 focus-visible:border-ring text-foreground max-w-full pl-3"
                  placeholder={`Input ${
                    mediaType === 'web-embed' ? 'X.com or Instagram' : mediaType
                  } URL here...`}
                  onChangeText={(text) => {
                    setUrl(text)
                    if (fileName.color)
                      setFileName({
                        name: 'Upload File',
                        color: undefined,
                      })
                  }}
                  autoFocus
                />
              )}
              {['image', 'video'].includes(mediaType) ? (
                <>
                  <Tooltip
                    content="Select file if the input is empty"
                    side="top"
                  >
                    <Button
                      variant="default"
                      size="sm"
                      className="shrink-0 font-semibold"
                      disabled={fileName.color === 'red'}
                      onClick={() => {
                        if (url) {
                          // Submit the form if the input is not empty
                          submit!(url, assign, setFileName, setLoading)
                        } else {
                          // Trigger the file picker dialog if input is empty
                          document
                            .getElementById('file-upload' + block.id)
                            ?.click()
                        }
                      }}
                    >
                      {loading ? (
                        <Spinner
                          size="small"
                          className="text-primary-foreground"
                        />
                      ) : (
                        'Upload'
                      )}
                    </Button>
                  </Tooltip>
                  <input
                    id={'file-upload' + block.id}
                    type="file"
                    multiple
                    accept={mediaType !== 'file' ? `${mediaType}/*` : undefined}
                    style={{
                      display: 'none',
                    }}
                    onChange={(event: ChangeEvent<HTMLInputElement>) => {
                      if (event.target.files) {
                        handleUpload(Array.from(event.target.files))
                      }
                    }}
                  />
                </>
              ) : (
                <Button
                  contentEditable={false}
                  variant="default"
                  size="sm"
                  className="shrink-0 font-semibold"
                  style={{
                    backgroundColor:
                      fileName.color === 'red'
                        ? 'text-muted-foreground/60'
                        : 'text-muted-foreground',
                  }}
                  disabled={fileName.color === 'red'}
                  onClick={() => {
                    if (url) {
                      submit!(url, assign, setFileName, setLoading)
                    }
                  }}
                >
                  {loading ? (
                    <Spinner size="small" className="text-primary-foreground" />
                  ) : (
                    'Upload'
                  )}
                </Button>
              )}
            </div>
            {fileName.color && fileName.color === 'red' && (
              <SizableText size="sm" color="destructive" className="pt-2">
                {fileName.name}
              </SizableText>
            )}
          </div>
        ) : (
          <div className="border-muted-foreground/30 bg-muted/50 hover:border-foreground/30 hover:bg-muted flex h-12 w-full cursor-pointer items-center justify-center rounded-md border-2 transition-colors">
            <Label
              contentEditable={false}
              htmlFor={'file-upload' + block.id}
              className="flex h-full w-full cursor-pointer items-center justify-center gap-2 select-none"
            >
              {!drag && (
                <>
                  <Upload className="size-4" />
                  <SizableText className="truncate overflow-hidden font-medium whitespace-nowrap">
                    Upload File
                  </SizableText>
                </>
              )}
            </Label>
            <input
              id={'file-upload' + block.id}
              type="file"
              multiple
              style={{
                // background: 'white',
                // padding: '0 2px',
                display: 'none',
              }}
              onChange={(event: ChangeEvent<HTMLInputElement>) => {
                if (event.target.files) {
                  handleUpload(Array.from(event.target.files))
                }
              }}
            />
          </div>
        )}
      </div>
    </div>
  )
}
