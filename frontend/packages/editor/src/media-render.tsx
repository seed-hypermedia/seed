import {MultipleNodeSelection} from '@/blocknote/core/extensions/SideMenu/MultipleNodeSelection'
import {useEditorSelectionChange} from '@/blocknote/react/hooks/useEditorSelectionChange'
import {MaxFileSizeB, MaxFileSizeMB} from '@/file'
import {HMBlockSchema} from '@/schema'
import {getNodesInSelection} from '@/utils'
import {DAEMON_FILE_UPLOAD_URL} from '@shm/shared/constants'
import {useDocContentContext} from '@shm/ui/document-content'
import {getDaemonFileUrl} from '@shm/ui/get-file-url'
import {Upload} from '@shm/ui/icons'
import {Button} from '@shm/ui/legacy/button'
import {Spinner} from '@shm/ui/spinner'
import {SizableText} from '@shm/ui/text'
import {Tooltip} from '@shm/ui/tooltip'
import {cn} from '@shm/ui/utils'
import {NodeSelection, TextSelection} from 'prosemirror-state'
import {
  ChangeEvent,
  FunctionComponent,
  SetStateAction,
  useEffect,
  useState,
} from 'react'
import {Input, Label} from 'tamagui'
import {BlockNoteEditor} from './blocknote/core/BlockNoteEditor'
import {Block} from './blocknote/core/extensions/Blocks/api/blockTypes'

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
  const {importWebFile} = useDocContentContext()

  useEditorSelectionChange(editor, () =>
    updateSelection(editor, block, setSelected),
  )

  useEffect(() => {
    if (!uploading && hasSrc) {
      if (block.props.src.startsWith('ipfs')) {
        editor.updateBlock(block, {
          props: {url: block.props.src, src: ''},
        })
        return
      }
      setUploading(true)

      importWebFile
        .mutateAsync(block.props.src)
        .then(({cid, size}: {cid: string; size: number}) => {
          setUploading(false)
          editor.updateBlock(block, {
            props: {
              url: `ipfs://${cid}`,
              size: size.toString(),
              src: '',
            },
          })
        })
    }
  }, [hasSrc, block, uploading, editor])

  const assignMedia = (props: MediaType) => {
    // we used to spread the current block.props into the new props, but now we just overwrite the whole thing because it was causing bugs
    editor.updateBlock(block.id, props)
  }

  const setSelection = (isSelected: boolean) => {
    setSelected(isSelected)
  }

  if (hasSrc || uploading) {
    // this means we have a URL in the props.url that is not starting with `ipfs://`, which means we are uploading the image to IPFS
    return (
      <Button
        // @ts-ignore
        contentEditable={false}
        borderRadius={0}
        size="$5"
        justifyContent="flex-start"
        backgroundColor="$color4"
        width="100%"
      >
        uploading...
      </Button>
    )
  }

  return (
    <div className="flex flex-col">
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

  const {handleFileAttachment, comment} = useDocContentContext()

  const handleUpload = async (files: File[]) => {
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
                largeFile.name.length < 36
                  ? largeFile.name
                  : largeFile.name.slice(0, 32) + '...'
              } exceeds ${MaxFileSizeMB} MB.`
            : `The file size exceeds ${MaxFileSizeMB} MB.`,
        color: 'red',
      })
      return
    }

    const {name, size} = files[0]
    if (handleFileAttachment) {
      const {displaySrc, fileBinary} = await handleFileAttachment(files[0])
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
        formData.append('file', files[0])
        const response = await fetch(DAEMON_FILE_UPLOAD_URL, {
          method: 'POST',
          body: formData,
        })
        const responseCID = await response.text()
        if (!responseCID) {
          throw new Error('Failed to upload file to IPFS')
        }
        const ipfsUrl = `ipfs://${responseCID}`
        assign({
          props: {
            url: ipfsUrl,
            displaySrc: getDaemonFileUrl(ipfsUrl),
            name,
            size: size.toString(),
          },
        } as MediaType)
      } catch (error) {
        console.error(`Editor: file upload error: ${error}`)
      }
    }
  }

  return (
    <div
      className={cn(
        'relative flex flex-col rounded-sm border-[3px] outline-none',
        drag || selected ? 'border-border' : 'border-transparent',
        drag ? 'border-dashed' : 'border-solid',
        comment ? 'bg-muted/60' : 'bg-muted',
      )}
      {...(isEmbed ? {} : dragProps)}
    >
      {drag && !isEmbed && (
        <div className="absolute top-0 left-0 z-[5] flex h-full w-full items-center justify-center rounded-sm bg-white/50">
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
                  unstyled
                  backgroundColor={comment ? '$color6' : '$color4'}
                  borderColor="$color8"
                  color="$color12"
                  borderWidth="$1"
                  borderRadius="$2"
                  paddingLeft="$3"
                  height="$3"
                  width="100%"
                  placeholder={`Input ${
                    mediaType === 'web-embed' ? 'X.com or Instagram' : mediaType
                  } URL here...`}
                  hoverStyle={{
                    borderColor: '$color11',
                  }}
                  focusStyle={{
                    borderColor: '$color11',
                  }}
                  onChange={(e: {
                    nativeEvent: {text: SetStateAction<string>}
                  }) => {
                    setUrl(e.nativeEvent.text)
                    if (fileName.color)
                      setFileName({
                        name: 'Upload File',
                        color: undefined,
                      })
                  }}
                  autoFocus={true}
                />
              )}
              {['image', 'video'].includes(mediaType) ? (
                <>
                  <Tooltip
                    content="Select file if the input is empty"
                    side="top"
                  >
                    <Button
                      alignItems="center"
                      justifyContent="center"
                      width="$12"
                      borderRadius="$2"
                      fontWeight="normal"
                      size="$3"
                      backgroundColor={
                        fileName.color === 'red' ? '$color5' : '$color7'
                      }
                      disabled={fileName.color === 'red'}
                      hoverStyle={
                        fileName.color !== 'red'
                          ? {
                              backgroundColor: '$color5',
                            }
                          : {cursor: 'auto'}
                      }
                      onClick={(event: any) => {
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
                          color="$green9"
                          paddingHorizontal="$3"
                        />
                      ) : (
                        'UPLOAD'
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
                  alignItems="center"
                  justifyContent="center"
                  width="$12"
                  borderRadius="$2"
                  fontWeight="normal"
                  size="$3"
                  backgroundColor={
                    fileName.color === 'red' ? '$color5' : '$color7'
                  }
                  disabled={fileName.color === 'red'}
                  hoverStyle={
                    fileName.color !== 'red'
                      ? {
                          backgroundColor: '$color5',
                        }
                      : {cursor: 'auto'}
                  }
                  onClick={(event: any) => {
                    if (url) {
                      submit!(url, assign, setFileName, setLoading)
                    }
                  }}
                >
                  {loading ? (
                    <Spinner
                      size="small"
                      color="$green9"
                      paddingHorizontal="$3"
                    />
                  ) : (
                    'UPLOAD'
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
          <div className="bg-background flex h-12 w-full items-center">
            <Label
              htmlFor={'file-upload' + block.id}
              borderColor="$color12"
              borderWidth="$0.5"
              width="100%"
              height="$3"
              justifyContent="center"
              hoverStyle={{
                backgroundColor: '$borderColorHover',
              }}
              gap={3}
            >
              {!drag && (
                <>
                  <Upload size={18} />
                  <SizableText className="truncate overflow-hidden p-2 whitespace-nowrap">
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
                background: 'white',
                padding: '0 2px',
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
