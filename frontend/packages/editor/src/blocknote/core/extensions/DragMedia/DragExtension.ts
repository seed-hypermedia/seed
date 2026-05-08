import {Extension} from '@tiptap/core'
import {Plugin, PluginKey} from 'prosemirror-state'
import type {EditorView} from 'prosemirror-view'
import {HMBlockSchema} from '../../../../schema'
import {createMediaBlock, handleDragMedia} from '../../../../utils'
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
                    const file = data.files[i]
                    if (file) {
                      files.push(file)
                    }
                  }
                } else if (data.items.length) {
                  for (let i = 0; i < data.items.length; i++) {
                    const dataItem = data.items[i]
                    if (!dataItem) continue
                    const item = dataItem.getAsFile()
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
                      return previousPromise.then(() => {
                        event.preventDefault()
                        event.stopPropagation()

                        if (pos && pos.inside !== -1) {
                          return handleDragMedia(file, this.options.editor.handleFileAttachment).then((props) => {
                            const {state} = view
                            const blockNode = createMediaBlock(file, props)
                            if (!blockNode) return false

                            const blockInfo = getBlockInfoFromPos(state, pos.pos)
                            const placement = getDropPlacement(view, blockInfo.block.beforePos, event.clientY)

                            if (index === 0) {
                              this.options.editor.insertBlocks(
                                [blockNode as any],
                                blockInfo.block.node.attrs.id,
                                placement,
                              )
                            } else {
                              this.options.editor.insertBlocks([blockNode as any], lastId, 'after')
                            }

                            lastId = blockNode.id
                            return true
                          })
                        }

                        return false
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

function getDropPlacement(view: EditorView, blockBeforePos: number, clientY: number): 'before' | 'after' {
  const blockEl = view.nodeDOM(blockBeforePos) as HTMLElement | null
  if (!blockEl) return 'after'

  const rect = blockEl.getBoundingClientRect()
  return clientY <= rect.top + rect.height / 2 ? 'before' : 'after'
}
