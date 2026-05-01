import {DAEMON_FILE_UPLOAD_URL} from '@shm/shared/constants'
import {toast} from '@shm/ui/toast'
import {Extension} from '@tiptap/core'
import {Plugin, PluginKey} from 'prosemirror-state'
import type {EditorView} from 'prosemirror-view'
import {HMBlockSchema} from '../../../../schema'
import {BlockNoteEditor} from '../../BlockNoteEditor'
import {getBlockInfoFromPos} from '../Blocks/helpers/getBlockInfoFromPos'

const PLUGIN_KEY = new PluginKey(`drop-plugin`)
const FILE_DROP_INSERTED_EVENT = 'hm-file-drop-inserted'

export interface DragOptions {
  editor: BlockNoteEditor<HMBlockSchema>
}

export const DragExtension = Extension.create<DragOptions>({
  name: 'drag',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: PLUGIN_KEY,
        view: (editorView) => new FileDropIndicatorView(editorView),
        props: {
          handleDOMEvents: {
            dragstart: (_, event) => {
              event.preventDefault()
              return false
            },
            dragleave: (_, event) => {
              event.preventDefault()
              return false
            },
            dragend: (_, event) => {
              event.preventDefault()
              return false
            },
            dragover: (_, event) => {
              event.preventDefault()
              return false
            },
            drop: (view, event) => {
              const data = event.dataTransfer

              if (data) {
                console.log(data)
                const files: File[] = []

                if (data.files.length) {
                  for (let i = 0; i < data.files.length; i++) {
                    // @ts-expect-error
                    files.push(data.files[i])
                  }
                } else if (data.items.length) {
                  for (let i = 0; i < data.items.length; i++) {
                    // @ts-expect-error
                    const item = data.items[i].getAsFile()
                    if (item) {
                      files.push(item)
                    }
                  }
                }

                if (files.length > 0) {
                  const pos = this.editor.view.posAtCoords({
                    left: event.clientX,
                    top: event.clientY,
                  })

                  let lastId: string

                  // using reduce so files get inserted sequentially
                  files
                    // @ts-expect-error
                    .reduce((previousPromise, file, index) => {
                      // @ts-expect-error
                      return previousPromise.then(() => {
                        event.preventDefault()
                        event.stopPropagation()

                        if (pos && pos.inside !== -1) {
                          // @ts-expect-error
                          return handleDragMedia(file, this.options.editor.handleFileAttachment).then((props) => {
                            if (!props) return false

                            const {state} = view
                            let blockNode
                            const newId = generateBlockId()

                            if (
                              props.url &&
                              !('fileBinary' in props && props.fileBinary) &&
                              !('mediaRef' in props && props.mediaRef)
                            ) {
                              if (chromiumSupportedImageMimeTypes.has(file.type)) {
                                blockNode = {
                                  id: newId,
                                  type: 'image',
                                  props: {
                                    url: props.url,
                                    name: props.name,
                                  },
                                }
                              } else if (chromiumSupportedVideoMimeTypes.has(file.type)) {
                                blockNode = {
                                  id: newId,
                                  type: 'video',
                                  props: {
                                    url: props.url,
                                    name: props.name,
                                  },
                                }
                              } else {
                                blockNode = {
                                  id: newId,
                                  type: 'file',
                                  props: {
                                    url: props.url,
                                    name: props.name,
                                    size: props.size,
                                  },
                                }
                              }
                            } else if (chromiumSupportedImageMimeTypes.has(file.type)) {
                              blockNode = {
                                id: newId,
                                type: 'image',
                                props: {
                                  displaySrc: props.displaySrc,
                                  fileBinary: props.fileBinary,
                                  mediaRef: props.mediaRef ? JSON.stringify(props.mediaRef) : '',
                                  name: props.name,
                                },
                              }
                            } else if (chromiumSupportedVideoMimeTypes.has(file.type)) {
                              blockNode = {
                                id: newId,
                                type: 'video',
                                props: {
                                  displaySrc: props.displaySrc,
                                  fileBinary: props.fileBinary,
                                  mediaRef: props.mediaRef ? JSON.stringify(props.mediaRef) : '',
                                  name: props.name,
                                },
                              }
                            } else {
                              blockNode = {
                                id: newId,
                                type: 'file',
                                props: {
                                  fileBinary: props.fileBinary,
                                  mediaRef: props.mediaRef ? JSON.stringify(props.mediaRef) : '',
                                  name: props.name,
                                  size: props.size,
                                  ...(props.url ? {url: props.url} : {}),
                                },
                              }
                            }

                            const blockInfo = getBlockInfoFromPos(state, pos.pos)
                            const placement = pos.pos <= blockInfo.block.beforePos ? 'before' : 'after'

                            if (index === 0) {
                              this.options.editor.insertBlocks(
                                [blockNode as any],
                                blockInfo.block.node.attrs.id,
                                placement,
                              )
                            } else {
                              this.options.editor.insertBlocks([blockNode as any], lastId, 'after')
                            }

                            lastId = newId
                          })
                        }
                      })
                    }, Promise.resolve())
                    // @ts-expect-error
                    .then(() => {
                      view.dom.dispatchEvent(new CustomEvent(FILE_DROP_INSERTED_EVENT))
                      return true
                    })

                  return true
                }

                return false
              }

              return false
            },
          },
        },
      }),
    ]
  },
})

class FileDropIndicatorView {
  element: HTMLElement | null = null
  currentKey: string | null = null

  constructor(readonly editorView: EditorView) {
    this.handleDragOver = this.handleDragOver.bind(this)
    this.handleDragLeave = this.handleDragLeave.bind(this)
    this.handleDrop = this.handleDrop.bind(this)
    this.handleDragEnd = this.handleDragEnd.bind(this)

    editorView.dom.addEventListener('dragover', this.handleDragOver)
    editorView.dom.addEventListener('dragleave', this.handleDragLeave)
    editorView.dom.addEventListener('drop', this.handleDrop)
    editorView.dom.addEventListener('dragend', this.handleDragEnd)
  }

  destroy() {
    this.editorView.dom.removeEventListener('dragover', this.handleDragOver)
    this.editorView.dom.removeEventListener('dragleave', this.handleDragLeave)
    this.editorView.dom.removeEventListener('drop', this.handleDrop)
    this.editorView.dom.removeEventListener('dragend', this.handleDragEnd)
    this.clear()
  }

  handleDragOver(event: DragEvent) {
    if (!hasFileDrag(event.dataTransfer)) {
      this.clear()
      return
    }
    const pos = this.editorView.posAtCoords({left: event.clientX, top: event.clientY})
    if (!pos || pos.inside === -1) {
      this.clear()
      return
    }
    const blockInfo = getBlockInfoFromPos(this.editorView.state, pos.pos)
    const blockEl = this.editorView.nodeDOM(blockInfo.block.beforePos) as HTMLElement | null
    if (!blockEl) {
      this.clear()
      return
    }

    const rect = blockEl.getBoundingClientRect()
    const contentEl =
      (blockEl.querySelector('[data-content-type]') as HTMLElement | null) ||
      (blockEl.firstElementChild as HTMLElement | null)
    const contentRect = contentEl ? contentEl.getBoundingClientRect() : rect
    const insertBefore = event.clientY <= rect.top + rect.height / 2
    const key = `${blockInfo.block.beforePos}:${insertBefore ? 'before' : 'after'}`
    if (key === this.currentKey) return
    this.currentKey = key

    const top = insertBefore ? rect.top : rect.bottom
    this.render({
      left: contentRect.left,
      width: Math.min(28, Math.max(18, contentRect.width)),
      top,
    })
  }

  handleDragLeave(event: DragEvent) {
    if (this.editorView.dom.contains(event.relatedTarget as Node | null)) return
    this.clear()
  }

  handleDrop() {
    this.clear()
  }

  handleDragEnd() {
    this.clear()
  }

  render({left, width, top}: {left: number; width: number; top: number}) {
    if (!this.element) {
      this.element = document.body.appendChild(document.createElement('div'))
      this.element.className = 'hm-file-drop-indicator'
      this.element.innerHTML = '<div class="hm-file-drop-indicator-dot"></div>'
      this.element.style.cssText = 'position:fixed;z-index:51;pointer-events:none;'
    }

    this.element.style.left = `${left}px`
    this.element.style.top = `${top - 1}px`
    this.element.style.width = `${width}px`
    this.element.style.height = '2px'
  }

  clear() {
    this.currentKey = null
    if (this.element?.parentNode) {
      this.element.parentNode.removeChild(this.element)
    }
    this.element = null
  }
}

function hasFileDrag(dataTransfer: DataTransfer | null) {
  return !!dataTransfer && Array.from(dataTransfer.types || []).includes('Files')
}

export {FILE_DROP_INSERTED_EVENT}

type FileType = {
  id: string
  props: {
    url: string
    name: string
    size: string
  }
  children: []
  content: []
  type: string
}

type PreparedMedia = {
  displaySrc?: string
  url?: string
  fileBinary?: Uint8Array
  mediaRef?: {
    draftId: string
    mediaId: string
    name: string
    mime: string
    size: number
  }
  name: string
  size: string
}

async function handleDragMedia(
  file: File,
  handleFileAttachment?: (file: File) => Promise<{
    displaySrc: string
    url?: string
    fileBinary?: Uint8Array
    mediaRef?: {
      draftId: string
      mediaId: string
      name: string
      mime: string
      size: number
    }
  }>,
): Promise<PreparedMedia | null> {
  if (file.size > 62914560) {
    toast.error(`The size of ${file.name} exceeds 60 MB.`)
    return null
  }

  if (handleFileAttachment) {
    const result = await handleFileAttachment(file)
    const prepared: Record<string, any> = {
      displaySrc: result.displaySrc,
      name: result.mediaRef?.name || file.name,
      size: (result.mediaRef?.size || file.size).toString(),
    }
    if (result.url) prepared.url = result.url
    if (result.fileBinary) prepared.fileBinary = result.fileBinary
    if (result.mediaRef) prepared.mediaRef = result.mediaRef
    return prepared as PreparedMedia
  }

  const formData = new FormData()
  formData.append('file', file)

  try {
    const response = await fetch(DAEMON_FILE_UPLOAD_URL, {
      method: 'POST',
      body: formData,
    })
    const data = await response.text()
    return {
      url: data ? `ipfs://${data}` : '',
      name: file.name,
      size: file.size.toString(),
    }
  } catch (error) {
    // @ts-expect-error
    console.log(error.message)
    toast.error('Failed to upload file.')
    return null
  }
}

function generateBlockId(length: number = 8): string {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let result = ''
  for (let i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * characters.length))
  }
  return result
}

const chromiumSupportedImageMimeTypes = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/bmp',
  'image/svg+xml',
  'image/x-icon',
  'image/vnd.microsoft.icon',
  'image/apng',
  'image/avif',
])

const chromiumSupportedVideoMimeTypes = new Set(['video/mp4', 'video/webm'])
