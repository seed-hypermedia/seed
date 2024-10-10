import {DAEMON_FILE_UPLOAD_URL} from '@shm/shared'
import {
  Button,
  Input,
  Label,
  SizableText,
  Spinner,
  Tooltip,
  XStack,
  YStack,
  useDocContentContext,
} from '@shm/ui'
import {NodeSelection, TextSelection} from 'prosemirror-state'
import {
  ChangeEvent,
  FunctionComponent,
  SetStateAction,
  useEffect,
  useState,
} from 'react'
import {RiUpload2Fill} from 'react-icons/ri'
import {Block, BlockNoteEditor, useEditorSelectionChange} from './blocknote'
import {MultipleNodeSelection} from './blocknote/core/extensions/SideMenu/MultipleNodeSelection'
import {MaxFileSizeB, MaxFileSizeMB} from './file'
import {HMBlockSchema} from './schema'
import {getNodesInSelection} from './utils'

export type MediaType = {
  id: string
  props: {
    url: string
    name: string
    size?: string
    display?: 'content' | 'card'
    width?: string
  }
  children: []
  content: []
  type: string
}

const boolRegex = new RegExp('true')

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
}

export const MediaRender: React.FC<RenderProps> = ({
  block,
  editor,
  mediaType,
  submit,
  DisplayComponent,
  CustomInput,
  icon,
}) => {
  const [selected, setSelected] = useState(false)
  const [uploading, setUploading] = useState(false)
  const tiptapEditor = editor._tiptapEditor
  const hasSrc = !!block.props.src
  const {importWebFile} = useDocContentContext()

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

  const assignMedia = (newFile: MediaType) => {
    editor.updateBlock(block.id, {
      props: {...block.props, ...newFile.props},
    })
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
    <YStack>
      {block.props.url ? (
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
        />
      ) : (
        <></>
      )}
    </YStack>
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

  const handleUpload = async (files: File[]) => {
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

    const {name} = files[0]
    const formData = new FormData()
    formData.append('file', files[0])

    try {
      const response = await fetch(DAEMON_FILE_UPLOAD_URL, {
        method: 'POST',
        body: formData,
      })
      const data = await response.text()
      assign({
        props: {
          url: data ? `ipfs://${data}` : '',
          name: name,
          size: mediaType === 'file' ? files[0].size.toString() : undefined,
        },
      } as MediaType)
    } catch (error) {
      console.error(`Editor: ${mediaType} upload error (MediaForm): ${error}`)
    }
    for (let i = files.length - 1; i > 0; i--) {
      const {name} = files[i]
      const formData = new FormData()
      formData.append('file', files[i])

      try {
        const response = await fetch(DAEMON_FILE_UPLOAD_URL, {
          method: 'POST',
          body: formData,
        })
        const data = await response.text()
        assign({
          props: {
            url: data ? `ipfs://${data}` : '',
            name: name,
            size: mediaType === 'file' ? files[0].size.toString() : undefined,
          },
        } as MediaType)
      } catch (error) {
        console.error(
          `Editor: ${mediaType} upload error (MediaForm forloop): ${error}`,
        )
      }
    }
    const cursorPosition = editor.getTextCursorPosition()
    editor.focus()
    if (cursorPosition.block.id === block.id) {
      if (cursorPosition.nextBlock)
        editor.setTextCursorPosition(cursorPosition.nextBlock, 'start')
      else {
        editor.insertBlocks(
          [{type: 'paragraph', content: ''}],
          block.id,
          'after',
        )
        editor.setTextCursorPosition(
          editor.getTextCursorPosition().nextBlock!,
          'start',
        )
      }
    }
  }

  return (
    <YStack
      position="relative"
      borderColor={drag ? '$color8' : selected ? '$color8' : '$color6'}
      borderWidth={4}
      borderRadius="$2"
      borderStyle={drag ? 'dashed' : 'solid'}
      outlineWidth={0}
      contentEditable={false}
      {...(isEmbed ? {} : dragProps)}
    >
      {drag && !isEmbed && (
        <XStack
          width="100%"
          height="100%"
          position="absolute"
          top={0}
          left={0}
          zIndex="$zIndex.5"
          alignItems="center"
          justifyContent="center"
          backgroundColor="rgb(255, 255, 255, 0.5)"
          borderRadius="$2"
        >
          <SizableText fontWeight="bold">DROP MEDIA HERE</SizableText>
        </XStack>
      )}
      <XStack
        padding="$4"
        alignItems="center"
        backgroundColor="$background"
        borderRadius="$2"
      >
        {mediaType !== 'file' ? (
          <YStack flex={1}>
            <XStack flex={1} gap="$3" width="100%">
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
                  borderColor="$color8"
                  borderWidth="$1"
                  borderRadius="$2"
                  paddingLeft="$3"
                  height="$3"
                  width="100%"
                  placeholder={`Input ${
                    mediaType === 'web-embed' ? 'X.com' : mediaType
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
                    placement="top"
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
            </XStack>
            {fileName.name !== 'Upload File' && (
              <SizableText size="$2" color={fileName.color} paddingTop="$2">
                {fileName.name}
              </SizableText>
            )}
          </YStack>
        ) : (
          <XStack
            alignItems="center"
            backgroundColor="$background"
            width="100%"
            height="$3"
          >
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
                  <RiUpload2Fill size="18" />
                  <SizableText
                    padding="$2"
                    overflow="hidden"
                    whiteSpace="nowrap"
                    textOverflow="ellipsis"
                  >
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
          </XStack>
        )}
      </XStack>
    </YStack>
  )
}
