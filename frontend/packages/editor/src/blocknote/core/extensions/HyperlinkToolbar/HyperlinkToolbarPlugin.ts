import {getMarkRange, posToDOMRect, Range} from '@tiptap/core'
import {MarkType} from '@tiptap/pm/model'
import {EditorView} from '@tiptap/pm/view'
import {Mark, Node as PMNode} from 'prosemirror-model'
import {Plugin, PluginKey} from 'prosemirror-state'
import {getNodeById} from '../../api/util/nodeUtil'
import type {BlockNoteEditor} from '../../BlockNoteEditor'
import {BaseUiElementState} from '../../shared/BaseUiElementTypes'
import {EventEmitter} from '../../shared/EventEmitter'
import {BlockSchema} from '../Blocks/api/blockTypes'
import {getGroupInfoFromPos} from '../Blocks/helpers/getGroupInfoFromPos'

export type HyperlinkNodeType = 'link' | 'inline-embed' | 'embed' | 'card' | 'button' | null

export type HyperlinkToolbarState = BaseUiElementState & {
  // The link node's URL
  url: string
  // The text of the link or button. Not relevant with mention and embed
  text: string
  // Type of the link node
  type: HyperlinkNodeType
  id: string

  props?: {
    alignment?: 'flex-start' | 'center' | 'flex-end'
    view?: string
    [key: string]: any // extensible
  }
}

class HyperlinkToolbarView<BSchema extends BlockSchema> {
  private hyperlinkToolbarState?: HyperlinkToolbarState
  public updateHyperlinkToolbar: () => void

  selectedNode: Mark | PMNode | undefined
  selectedNodeRange: Range | undefined

  constructor(
    private readonly editor: BlockNoteEditor<BSchema>,
    private readonly pmView: EditorView,
    updateHyperlinkToolbar: (hyperlinkToolbarState: HyperlinkToolbarState) => void,
  ) {
    this.updateHyperlinkToolbar = () => {
      if (!this.hyperlinkToolbarState) return
      updateHyperlinkToolbar(this.hyperlinkToolbarState)
    }

    document.addEventListener('click', this.clickHandler, true)
  }

  clickHandler = (event: MouseEvent) => {
    const target = event.target as Node | null
    if (!target) return
    if (isEventInsideToolbar(target)) {
      return
    }

    const editorWrapper = this.pmView.dom.parentElement!
    const clickedOutsideEditor = !(editorWrapper === target || editorWrapper?.contains(target))

    if (
      // Toolbar is open.
      this.selectedNode &&
      // The clicked element is not the editor.
      clickedOutsideEditor
    ) {
      if (this.hyperlinkToolbarState?.show) {
        this.hyperlinkToolbarState = {
          ...this.hyperlinkToolbarState,
          show: false,
        }
        this.updateHyperlinkToolbar()
      }
    }
  }

  updateHyperlink(url: string, text: string, hideMenu: boolean) {
    let tr = this.pmView.state.tr
    let markOrNode = this.selectedNode
    let range = this.selectedNodeRange
    const nodeId = this.hyperlinkToolbarState?.id

    // Try to get the node and range after the document update
    // This is needed when editing link text, as the document changes after each character
    if (!range && nodeId) {
      const nodeAndRange = getNodeAndRange(
        undefined,
        undefined,
        nodeId,
        this.pmView,
        this,
        this.hyperlinkToolbarState?.url,
      )
      if (nodeAndRange.range) {
        markOrNode = nodeAndRange.markOrNode
        range = nodeAndRange.range
        this.selectedNode = markOrNode
        this.selectedNodeRange = range
      }
    }

    if (this.hyperlinkToolbarState && range) {
      const pos = range.from
      if (this.hyperlinkToolbarState.type === 'inline-embed') {
        tr = tr.setNodeMarkup(pos, null, {
          link: url,
        })
      } else if (this.hyperlinkToolbarState.type === 'button') {
        const alignment = this.hyperlinkToolbarState.props
          ? this.hyperlinkToolbarState.props.alignment
          : markOrNode?.attrs.alignment
        tr = tr.setNodeMarkup(pos, null, {
          url: url,
          name: text,
          alignment: alignment,
        })
      } else if (this.hyperlinkToolbarState.type === 'embed' || this.hyperlinkToolbarState.type === 'card') {
        tr = tr.setNodeMarkup(pos, null, {
          url: url,
          view: this.hyperlinkToolbarState.type === 'card' ? 'Card' : 'Content',
        })
      } else {
        const newText = text.length ? text : ' '
        const newLength = range.from + newText.length
        tr = this.pmView.state.tr
          .insertText(newText, range.from, range.to)
          .addMark(range.from, newLength, this.pmView.state.schema.mark('link', {href: url}))

        range.to = newLength
      }
    } else if (this.hyperlinkToolbarState && !range) {
      console.error('Range is undefined', this.hyperlinkToolbarState)
      return
    }

    this.pmView.dispatch(tr)

    if (hideMenu) {
      if (this.hyperlinkToolbarState?.show) {
        this.hyperlinkToolbarState.show = false
        this.updateHyperlinkToolbar()
      }
    }
  }

  highlightHyperlink() {}

  resetHyperlink() {
    // @ts-ignore
    if (!this.hyperlinkToolbarState) return
    this.hyperlinkToolbarState = {
      ...this.hyperlinkToolbarState,
      show: false,
      url: '',
      text: '',
      type: null,
      id: '',
    }
    this.updateHyperlinkToolbar()
  }

  updateFormRect() {
    let markOrNode = this.selectedNode
    let range = this.selectedNodeRange
    const nodeId = this.hyperlinkToolbarState?.id

    const nodeAndRange = getNodeAndRange(markOrNode, range, nodeId, this.pmView, this, this.hyperlinkToolbarState?.url)
    markOrNode = nodeAndRange.markOrNode
    range = nodeAndRange.range

    const nodeRect = posToDOMRect(this.pmView, range!.from, range!.to)

    if (markOrNode && range && this.hyperlinkToolbarState) {
      const dom = this.pmView.domAtPos(range!.from).node as HTMLElement
      const buttonElement = dom.querySelector('button') as HTMLElement | null

      const buttonRect = buttonElement?.getBoundingClientRect?.() ?? nodeRect

      this.hyperlinkToolbarState = {
        ...this.hyperlinkToolbarState,
        referencePos: buttonRect,
        props: {
          alignment: markOrNode.attrs.alignment,
        },
      }

      this.updateHyperlinkToolbar()
    }
  }

  private updateFromSelection(): HyperlinkToolbarState | null {
    this.selectedNode = undefined
    this.selectedNodeRange = undefined
    let nextState: HyperlinkToolbarState | null = null

    const marksAtPos = this.pmView.state.selection.$from.marks()

    if (marksAtPos.length > 0) {
      for (const mark of marksAtPos) {
        if (mark.type.name === this.pmView.state.schema.mark('link').type.name) {
          this.selectedNode = mark
          this.selectedNodeRange = getMarkRange(this.pmView.state.selection.$from, mark.type, mark.attrs) || undefined

          break
        }
      }
    } else {
      const textNode = this.pmView.state.selection.$from.nodeAfter
      if (textNode) {
        switch (textNode.type.name) {
          case 'inline-embed':
            if (this.pmView.state.selection.to - this.pmView.state.selection.from === 1) {
              this.selectedNode = textNode
              this.selectedNodeRange = {
                from: this.pmView.state.selection.from,
                to: this.pmView.state.selection.to,
              }
            }
            break
          case 'button':
            this.selectedNode = textNode
            this.selectedNodeRange = {
              from: this.pmView.state.selection.from,
              to: this.pmView.state.selection.to,
            }
            break
          case 'embed':
            this.selectedNode = textNode
            this.selectedNodeRange = {
              from: this.pmView.state.selection.from,
              to: this.pmView.state.selection.to,
            }
            break
          default:
            this.selectedNode = undefined
            this.selectedNodeRange = undefined
            break
        }
      }
    }

    if (this.selectedNode) {
      const {container} = getGroupInfoFromPos(this.selectedNodeRange!.from, this.pmView.state)
      const nodeRect = posToDOMRect(this.pmView, this.selectedNodeRange!.from, this.selectedNodeRange!.to)
      if (this.selectedNode instanceof Mark) {
        nextState = {
          show: this.pmView.state.selection.empty,
          referencePos: nodeRect,
          url: this.selectedNode!.attrs.href,
          text: this.pmView.state.doc.textBetween(this.selectedNodeRange!.from, this.selectedNodeRange!.to),
          type: 'link',
          id: container ? container.attrs.id : '',
        }
      } else if (this.selectedNode instanceof PMNode) {
        if (this.selectedNode.type.name === 'inline-embed')
          nextState = {
            show: true,
            referencePos: nodeRect,
            url: this.selectedNode!.attrs.link,
            text: ' ',
            type: 'inline-embed',
            id: container ? container.attrs.id : '',
          }
        else if (this.selectedNode.type.name === 'button') {
          const dom = this.pmView.domAtPos(this.selectedNodeRange!.from).node as HTMLElement
          const buttonElement = dom.querySelector('button') as HTMLElement | null

          const buttonRect = buttonElement?.getBoundingClientRect?.() ?? nodeRect

          const alignAttr = this.selectedNode!.attrs.alignment
          const alignment = typeof alignAttr === 'string' && alignAttr.length > 0 ? alignAttr : 'flex-start'

          nextState = {
            show: true,
            referencePos: buttonRect,
            url: this.selectedNode!.attrs.url,
            text: this.selectedNode!.attrs.name,
            type: 'button',
            id: container ? container.attrs.id : '',
            props: {
              // @ts-ignore
              alignment: alignment,
            },
          }
        } else if (this.selectedNode.type.name === 'embed') {
          if (!this.selectedNode.attrs.url.length) return null
          const dom = this.pmView.domAtPos(this.selectedNodeRange!.from).node as HTMLElement
          const embedElement = dom.querySelector('[data-content-type="embed"]')
          const embedRect = embedElement?.getBoundingClientRect?.() ?? nodeRect
          const embedTopRightRect = new DOMRect(embedRect.right - 162, embedRect.top + 12, 1, 1)
          nextState = {
            show: true,
            referencePos: embedTopRightRect,
            url: this.selectedNode!.attrs.url,
            text: '',
            type: this.selectedNode.attrs.view === 'Card' ? 'card' : 'embed',
            id: container ? container.attrs.id : '',
          }
        }
      }

      return nextState
    }

    return nextState
  }

  update() {
    // While the user is actively editing inside the toolbar form (e.g. typing
    // a new URL or link text), the ProseMirror cursor can end up at the
    // boundary of the link mark after a text-replace transaction, and
    // $from.marks() stops returning the link mark. That would close the
    // toolbar and unmount the inputs mid-keystroke. When the toolbar itself
    // holds focus, keep the toolbar visible and re-resolve mark/range/url
    // from the stored block id so the form stays in sync without closing.
    if (this.hyperlinkToolbarState?.show && isToolbarFormFocused()) {
      const {markOrNode, range} = getNodeAndRange(
        undefined,
        undefined,
        this.hyperlinkToolbarState.id,
        this.pmView,
        this,
        this.hyperlinkToolbarState.url,
      )
      if (markOrNode && range) {
        this.selectedNode = markOrNode
        this.selectedNodeRange = range
        const currentState = this.hyperlinkToolbarState
        const href = markOrNode instanceof Mark ? markOrNode.attrs.href : markOrNode.attrs.link ?? markOrNode.attrs.url
        const text = markOrNode instanceof Mark ? this.pmView.state.doc.textBetween(range.from, range.to) : currentState.text
        this.hyperlinkToolbarState = {
          ...currentState,
          url: typeof href === 'string' ? href : currentState.url,
          text,
          referencePos: posToDOMRect(this.pmView, range.from, range.to),
        }
        this.updateHyperlinkToolbar()
      }
      return
    }

    const selectionState = this.updateFromSelection()
    if (selectionState) {
      this.hyperlinkToolbarState = selectionState
      this.updateHyperlinkToolbar()
      return
    }

    // Hides menu when selection moves away from a hypermedia element.
    if (this.hyperlinkToolbarState?.show && !this.selectedNode) {
      const {markOrNode, range} = getNodeAndRange(
        undefined,
        undefined,
        this.hyperlinkToolbarState.id,
        this.pmView,
        this,
        this.hyperlinkToolbarState.url,
      )
      if (this.hyperlinkToolbarState.type === 'link' && markOrNode?.attrs?.href?.length === 0 && range) {
        this.pmView.dispatch(
          this.pmView.state.tr
            .removeMark(range.from, range.to, (markOrNode as Mark).type as MarkType)
            .setMeta('preventAutolink', true),
        )
      }
      this.hyperlinkToolbarState = {...this.hyperlinkToolbarState, show: false}
      this.updateHyperlinkToolbar()
    }
  }

  destroy() {
    document.removeEventListener('click', this.clickHandler, true)
  }
}

export const hyperlinkToolbarPluginKey = new PluginKey('HyperlinkToolbarPlugin')

export class HyperlinkToolbarProsemirrorPlugin<BSchema extends BlockSchema> extends EventEmitter<any> {
  private view: HyperlinkToolbarView<BSchema> | undefined
  public readonly plugin: Plugin

  constructor(editor: BlockNoteEditor<BSchema>) {
    super()
    this.plugin = new Plugin({
      key: hyperlinkToolbarPluginKey,
      view: (editorView) => {
        this.view = new HyperlinkToolbarView(editor, editorView, (state) => {
          this.emit('update', state)
        })
        return this.view
      },
    })
  }

  public onUpdate(callback: (state: HyperlinkToolbarState) => void) {
    return this.on('update', callback)
  }

  /**
   * Edit the currently selected hyperlink.
   */
  public updateHyperlink = (url: string, text: string, hideMenu: boolean) => {
    this.view!.updateHyperlink(url, text, hideMenu)
  }

  /**
   * Delete the currently selected hyperlink.
   */
  public deleteHyperlink = () => {
    // this.view!.deleteHyperlink()
  }

  public updatePosition = () => {
    this.view!.updateFormRect()
  }

  public highlightHyperlink() {}

  public resetHyperlink = () => {
    this.view!.resetHyperlink()
  }
}

// CSS class used on the root of every hypermedia link toolbar popover
// (see HypermediaLinkPreview in `hm-link-preview.tsx`). Keep these two class
// names in sync: the plugin uses them to detect "a click/focus is inside the
// toolbar — don't close it".
const TOOLBAR_ROOT_CLASS = 'link-preview-toolbar'

function isEventInsideToolbar(target: Node): boolean {
  return !!(target as HTMLElement).closest?.(`.${TOOLBAR_ROOT_CLASS}`)
}

function isToolbarFormFocused(): boolean {
  if (typeof document === 'undefined') return false
  const active = document.activeElement
  if (!active) return false
  return !!active.closest?.(`.${TOOLBAR_ROOT_CLASS}`)
}

function getNodeAndRange(
  markOrNode: PMNode | Mark | undefined,
  range: Range | undefined,
  nodeId: string | undefined,
  view: EditorView,
  pluginView: HyperlinkToolbarView<any>,
  url?: string,
) {
  if (!range && nodeId) {
    const {state} = view
    try {
      const {posBeforeNode} = getNodeById(nodeId, state.doc)
      const contentNode = state.doc.nodeAt(posBeforeNode + 1)

      if (contentNode) {
        if (contentNode.type.name === 'embed' || contentNode.type.name === 'button') {
          markOrNode = contentNode
          range = {
            from: posBeforeNode + 1,
            to: posBeforeNode + 1 + contentNode.nodeSize,
          }
        } else {
          let foundLink = false
          // @ts-ignore
          contentNode.descendants((child, childPos) => {
            const linkMark = child.marks?.find((mark) => mark.type.name === 'link')
            if (linkMark) {
              const absolutePos = posBeforeNode + 2 + childPos
              const $pos = state.doc.resolve(absolutePos)
              const markRange = getMarkRange($pos, linkMark.type, linkMark.attrs)
              if (markRange) {
                markOrNode = linkMark
                range = markRange
                foundLink = true
              } else {
                // Fallback to manual calculation if getMarkRange fails
                markOrNode = linkMark
                range = {
                  from: absolutePos,
                  to: absolutePos + (child.text?.length || 1),
                }
                foundLink = true
              }
              return false
            }
            if (child.type.name === 'inline-embed') {
              markOrNode = child
              range = {
                from: posBeforeNode + 2 + childPos,
                to: posBeforeNode + 2 + childPos + child.nodeSize,
              }
              foundLink = true
              return false
            }
          })
          if (!foundLink) {
            // If link mark is missing, create a temporary mark that will be updated in updateHyperlink
            if (contentNode.textContent && contentNode.textContent.length > 0) {
              let textStartPos: number | null = null
              // @ts-ignore
              contentNode.descendants((child, childPos) => {
                if (child.isText && textStartPos === null) {
                  textStartPos = posBeforeNode + 2 + childPos
                  return false
                }
              })
              if (textStartPos !== null) {
                range = {
                  from: textStartPos,
                  to: textStartPos + contentNode.textContent.length,
                }
                const linkMarkType = state.schema.marks.link
                if (linkMarkType) {
                  markOrNode = linkMarkType.create({
                    href: url || '',
                  }) as Mark
                }
                foundLink = true
              }
            }
          }
        }
      }
    } catch (e) {
      let missingId
      state.doc.descendants((node, pos) => {
        if (node.attrs.id && node.attrs.id === nodeId) {
          missingId = nodeId
        }
      })

      if (!missingId) {
        pluginView?.resetHyperlink()
      }
    }
  }
  return {markOrNode, range}
}
