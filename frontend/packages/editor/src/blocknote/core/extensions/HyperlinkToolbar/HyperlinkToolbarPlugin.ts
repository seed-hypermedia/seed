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

export type HyperlinkToolbarState = BaseUiElementState & {
  // The link node's URL
  url: string
  // The text of the link or button. Not relevant with mention and embed
  text: string
  // Type of the link node
  type: 'link' | 'inline-embed' | 'embed' | 'card' | 'button'
  id: string

  props?: {
    alignment?: 'flex-start' | 'center' | 'flex-end'
    view?: string
    [key: string]: any // extensible
  }
}

function getNodeIdFromCoords(
  coords: {left: number; top: number},
  view: EditorView,
) {
  if (!view.dom.isConnected) {
    // view is not connected to the DOM, this can cause posAtCoords to fail
    // (Cannot read properties of null (reading 'nearestDesc'), https://github.com/TypeCellOS/BlockNote/issues/123)
    return undefined
  }

  const pos = view.posAtCoords(coords)

  if (!pos) {
    return undefined
  }

  let node =
    view.nodeDOM(pos.inside) || (view.domAtPos(pos.pos).node as HTMLElement)
  // let atomNode = view.nodeDOM(pos.inside) as HTMLElement

  if (node === view.dom) {
    // mouse over root
    return undefined
  }

  while (
    node &&
    node.parentNode &&
    node.parentNode !== view.dom &&
    // @ts-expect-error
    !node.hasAttribute?.('data-id')
  ) {
    node = node.parentNode as HTMLElement
  }
  if (!node) {
    return undefined
  }

  // @ts-expect-error
  return {node, id: node.getAttribute('data-id')!}
}

class HyperlinkToolbarView<BSchema extends BlockSchema> {
  private hyperlinkToolbarState?: HyperlinkToolbarState
  public updateHyperlinkToolbar: () => void

  menuUpdateTimer: ReturnType<typeof setTimeout> | undefined
  startMenuUpdateTimer: () => void
  stopMenuUpdateTimer: () => void

  selectedNode: Mark | PMNode | undefined
  selectedNodeRange: Range | undefined

  hoveredId: string | undefined
  hoveredNode: Mark | PMNode | undefined
  hoveredNodeRange: Range | undefined

  public isHoveringToolbar = false

  constructor(
    private readonly editor: BlockNoteEditor<BSchema>,
    private readonly pmView: EditorView,
    updateHyperlinkToolbar: (
      hyperlinkToolbarState: HyperlinkToolbarState,
    ) => void,
  ) {
    this.updateHyperlinkToolbar = () => {
      if (!this.hyperlinkToolbarState) {
        throw new Error('Attempting to update uninitialized hyperlink toolbar')
      }

      updateHyperlinkToolbar(this.hyperlinkToolbarState)
    }

    this.startMenuUpdateTimer = () => {
      // console.log(this.isHoveringToolbar)
      this.menuUpdateTimer = setTimeout(() => {
        this.update()
        if (!this.isHoveringToolbar) {
          this.hoveredId = undefined
        }
      }, 200)
    }

    this.stopMenuUpdateTimer = () => {
      if (this.menuUpdateTimer) {
        clearTimeout(this.menuUpdateTimer)
        this.menuUpdateTimer = undefined
      }

      return false
    }

    this.pmView.dom.addEventListener('mouseover', this.mouseOverHandler)
    document.addEventListener('click', this.clickHandler, true)
    document.addEventListener('scroll', this.scrollHandler)
  }

  mouseOverHandler = (event: MouseEvent) => {
    const target = event.target as HTMLElement

    if (!target) return

    if (target.closest('.query-settings')) return

    this.stopMenuUpdateTimer()

    const tiptap = this.editor._tiptapEditor
    const coords = {
      left: event.clientX,
      top: event.clientY,
    }
    if (target.closest('.link')) {
      const nodeId = getNodeIdFromCoords(coords, this.pmView)
      if (nodeId?.id) this.hoveredId = nodeId.id
    } else if (target.closest('.inline-embed-token')) {
      const nodeId = getNodeIdFromCoords(coords, this.pmView)
      if (nodeId?.id) this.hoveredId = nodeId.id
    } else if (target.closest('[data-content-type="button"]')) {
      if (target.tagName === 'BUTTON' || target.closest('button')) {
        const nodeId = getNodeIdFromCoords(coords, this.pmView)
        if (nodeId?.id) this.hoveredId = nodeId.id
      }
    } else if (target.closest('[data-content-type="embed"]')) {
      if (
        target.closest('[data-content-type="embed"]')?.getAttribute('data-url')
      ) {
        const nodeId = getNodeIdFromCoords(coords, this.pmView)
        if (nodeId?.id) this.hoveredId = nodeId.id
      }
    }

    this.startMenuUpdateTimer()

    return false
  }

  clickHandler = (event: MouseEvent) => {
    const editorWrapper = this.pmView.dom.parentElement!

    if (
      // Toolbar is open.
      (this.selectedNode || this.hoveredId) &&
      // An element is clicked.
      event &&
      event.target &&
      // The clicked element is not the editor.
      !(
        editorWrapper === (event.target as Node) ||
        editorWrapper?.contains(event.target as Node)
      )
    ) {
      if (this.hyperlinkToolbarState?.show) {
        this.hyperlinkToolbarState.show = false
        this.updateHyperlinkToolbar()
      }
    }
  }

  scrollHandler = () => {
    if (this.selectedNode || this.hoveredId) {
      let markOrNode = this.selectedNode || this.hoveredNode
      let range = this.selectedNodeRange || this.hoveredNodeRange
      const nodeId = this.hoveredId || this.hyperlinkToolbarState?.id
      const nodeAndRange = getNodeAndRange(
        markOrNode,
        range,
        nodeId,
        this.pmView,
        this,
      )
      markOrNode = nodeAndRange.markOrNode
      range = nodeAndRange.range
      if (this.hyperlinkToolbarState?.show) {
        this.hyperlinkToolbarState.referencePos = posToDOMRect(
          this.pmView,
          range!.from,
          range!.to,
        )
        this.updateHyperlinkToolbar()
      }
    }
  }

  updateHyperlink(url: string, text: string, hideMenu: boolean) {
    let tr = this.pmView.state.tr
    let markOrNode = this.selectedNode || this.hoveredNode
    let range = this.selectedNodeRange || this.hoveredNodeRange
    const nodeId = this.hoveredId || this.hyperlinkToolbarState?.id

    // console.log(this.hoveredId, this.hoveredNode, this.hoveredNodeRange)
    const nodeAndRange = getNodeAndRange(
      markOrNode,
      range,
      nodeId,
      this.pmView,
      this,
    )
    markOrNode = nodeAndRange.markOrNode
    range = nodeAndRange.range
    if (this.hyperlinkToolbarState) {
      const pos = range!.from
      if (this.hyperlinkToolbarState.type === 'inline-embed') {
        tr = tr.setNodeMarkup(pos, null, {
          link: url,
        })
      } else if (this.hyperlinkToolbarState.type === 'button') {
        tr = tr.setNodeMarkup(pos, null, {
          url: url,
          name: text,
        })
      } else if (
        this.hyperlinkToolbarState.type === 'embed' ||
        this.hyperlinkToolbarState.type === 'card'
      ) {
        tr = tr.setNodeMarkup(pos, null, {
          url: url,
          view: this.hyperlinkToolbarState.type === 'card' ? 'Card' : 'Content',
        })
      } else {
        const newText = text.length ? text : ' '
        const newLength = range!.from + newText.length
        tr = this.pmView.state.tr
          .insertText(newText, range!.from, range!.to)
          .addMark(
            range!.from,
            newLength,
            this.pmView.state.schema.mark('link', {href: url}),
          )

        range!.to = newLength
      }
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
    this.hyperlinkToolbarState = {
      ...this.hyperlinkToolbarState,
      show: false,
      url: '',
      text: '',
      // @ts-expect-error
      type: '',
      id: '',
    }
    this.isHoveringToolbar = false
    this.hoveredId = undefined
    this.updateHyperlinkToolbar()
  }

  // deleteHyperlink() {
  //   if (this.hyperlinkMark instanceof Mark) {
  //     this.pmView.dispatch(
  //       this.pmView.state.tr
  //         .removeMark(
  //           this.hyperlinkMarkRange!.from,
  //           this.hyperlinkMarkRange!.to,
  //           this.hyperlinkMark!.type,
  //         )
  //         .setMeta('preventAutolink', true),
  //     )
  //   } else if (
  //     this.hyperlinkToolbarState &&
  //     this.hyperlinkToolbarState.type === 'inline-embed'
  //   ) {
  //     const state = this.pmView.state
  //     let tr = state.tr
  //     const pos = this.hyperlinkMarkRange
  //       ? this.hyperlinkMarkRange.from
  //       : this.pmView.state.selection.from
  //     const $pos = state.doc.resolve(pos)
  //     let offset = 0
  //     $pos.parent.descendants((node, pos) => {
  //       if (
  //         node.type.name === 'inline-embed' &&
  //         node.attrs.link === this.hyperlinkToolbarState!.url
  //       ) {
  //         offset = pos
  //       }
  //     })
  //     tr = tr.replaceRangeWith(
  //       $pos.start() + offset,
  //       $pos.start() + offset + 1,
  //       state.schema.text(this.hyperlinkToolbarState.text),
  //     )
  //     // tr = tr.setNodeMarkup(pos, state.schema.nodes['paragraph'])
  //     this.pmView.dispatch(tr)
  //   }

  //   this.pmView.focus()

  //   if (this.hyperlinkToolbarState?.show) {
  //     this.hyperlinkToolbarState.show = false
  //     this.updateHyperlinkToolbar()
  //   }
  // }

  update() {
    // if (!this.pmView.hasFocus()) {
    //   return
    // }

    this.selectedNode = undefined
    this.selectedNodeRange = undefined
    this.hoveredNode = undefined
    this.hoveredNodeRange = undefined

    const marksAtPos = this.pmView.state.selection.$from.marks()

    if (marksAtPos.length > 0) {
      for (const mark of marksAtPos) {
        if (
          mark.type.name === this.pmView.state.schema.mark('link').type.name
        ) {
          this.selectedNode = mark
          this.selectedNodeRange =
            getMarkRange(
              this.pmView.state.selection.$from,
              mark.type,
              mark.attrs,
            ) || undefined

          break
        }
      }
    } else {
      const textNode = this.pmView.state.selection.$from.nodeAfter
      if (textNode) {
        switch (textNode.type.name) {
          case 'inline-embed':
            if (
              this.pmView.state.selection.to -
                this.pmView.state.selection.from ===
              1
            ) {
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
      const {container} = getGroupInfoFromPos(
        this.selectedNodeRange!.from,
        this.pmView.state,
      )
      if (this.selectedNode instanceof Mark) {
        this.hyperlinkToolbarState = {
          show: this.pmView.state.selection.empty,
          referencePos: posToDOMRect(
            this.pmView,
            this.selectedNodeRange!.from,
            this.selectedNodeRange!.to,
          ),
          url: this.selectedNode!.attrs.href,
          text: this.pmView.state.doc.textBetween(
            this.selectedNodeRange!.from,
            this.selectedNodeRange!.to,
          ),
          type: 'link',
          id: container ? container.attrs.id : '',
        }
      } else if (this.selectedNode instanceof PMNode) {
        if (this.selectedNode.type.name === 'inline-embed')
          this.hyperlinkToolbarState = {
            show: true,
            referencePos: posToDOMRect(
              this.pmView,
              this.selectedNodeRange!.from,
              this.selectedNodeRange!.to,
            ),
            url: this.selectedNode!.attrs.link,
            text: ' ',
            type: 'inline-embed',
            id: container ? container.attrs.id : '',
          }
        else if (this.selectedNode.type.name === 'button') {
          const dom = this.pmView.domAtPos(this.selectedNodeRange!.from)
            .node as HTMLElement
          const buttonElement = dom.querySelector('button')

          if (buttonElement) {
            const buttonRect = buttonElement.getBoundingClientRect()
            this.hyperlinkToolbarState = {
              show: true,
              referencePos: buttonRect,
              url: this.selectedNode!.attrs.url,
              text: this.selectedNode!.attrs.name,
              type: 'button',
              id: container ? container.attrs.id : '',
              props: {
                alignment:
                  this.selectedNode!.attrs.alignment.length > 0
                    ? this.selectedNode!.attrs.alignment
                    : 'flex-start',
              },
            }
          }
        } else if (this.selectedNode.type.name === 'embed') {
          if (!this.selectedNode.attrs.url.length) return
          const dom = this.pmView.domAtPos(this.selectedNodeRange!.from)
            .node as HTMLElement
          const embedElement = dom.querySelector('[data-content-type="embed"]')
          if (embedElement) {
            const embedRect = embedElement.getBoundingClientRect()
            const embedTopRightRect = new DOMRect(
              embedRect.right - 162,
              embedRect.top + 12,
              1,
              1,
            )
            this.hyperlinkToolbarState = {
              show: true,
              referencePos: embedTopRightRect,
              url: this.selectedNode!.attrs.url,
              text: '',
              type: this.selectedNode.attrs.view === 'Card' ? 'card' : 'embed',
              id: container ? container.attrs.id : '',
            }
          }
        }
      }
      this.updateHyperlinkToolbar()

      return
    }

    if (this.hoveredId) {
      const {state} = this.editor._tiptapEditor
      try {
        const {node: hoveredNode, posBeforeNode} = getNodeById(
          this.hoveredId,
          state.doc,
        )
        const contentNode = hoveredNode.firstChild
        if (contentNode) {
          if (
            contentNode.type.name === 'embed' ||
            contentNode.type.name === 'button'
          ) {
            this.hoveredNode = contentNode
            this.hoveredNodeRange = {
              from: posBeforeNode + 1,
              to: posBeforeNode + 1 + contentNode.nodeSize,
            }
          } else {
            // @ts-ignore
            contentNode.descendants((child, childPos) => {
              const linkMark = child.marks?.find(
                (mark) => mark.type.name === 'link',
              )
              if (linkMark) {
                this.hoveredNode = linkMark
                this.hoveredNodeRange = {
                  from: posBeforeNode + 2 + childPos,
                  to: posBeforeNode + 2 + childPos + (child.text?.length || 1),
                }
                return false
              }
              if (child.type.name === 'inline-embed') {
                this.hoveredNode = child
                this.hoveredNodeRange = {
                  from: posBeforeNode + 2 + childPos,
                  to: posBeforeNode + 2 + childPos + child.nodeSize,
                }
                return false
              }
            })
          }
        }
      } catch (e) {
        let missingId
        // @ts-ignore
        state.doc.descendants((node, pos) => {
          if (node.attrs.id && node.attrs.id === this.hoveredId) {
            missingId = this.hoveredId
          }
        })

        if (!missingId) {
          this.resetHyperlink()
        }
      }
    }

    if (this.hoveredNode) {
      const {container} = getGroupInfoFromPos(
        this.hoveredNodeRange!.from,
        this.pmView.state,
      )
      const rect = posToDOMRect(
        this.pmView,
        this.hoveredNodeRange!.from,
        this.hoveredNodeRange!.to,
      )
      if (this.hoveredNode instanceof Mark) {
        this.hyperlinkToolbarState = {
          show: this.pmView.state.selection.empty,
          referencePos: rect,
          url: this.hoveredNode!.attrs.href,
          text: this.pmView.state.doc.textBetween(
            this.hoveredNodeRange!.from,
            this.hoveredNodeRange!.to,
          ),
          type: 'link',
          id: container ? container.attrs.id : '',
        }
      } else if (this.hoveredNode instanceof PMNode) {
        if (this.hoveredNode.type.name === 'inline-embed')
          this.hyperlinkToolbarState = {
            show: true,
            referencePos: rect,
            url: this.hoveredNode!.attrs.link,
            text: ' ',
            type: 'inline-embed',
            id: container ? container.attrs.id : '',
          }
        else if (this.hoveredNode.type.name === 'button') {
          const dom = this.pmView.domAtPos(this.hoveredNodeRange!.from)
            .node as HTMLElement
          const buttonElement = dom.querySelector('button')

          if (buttonElement) {
            const buttonRect = buttonElement.getBoundingClientRect()

            this.hyperlinkToolbarState = {
              show: true,
              referencePos: buttonRect,
              url: this.hoveredNode!.attrs.url,
              text: this.hoveredNode!.attrs.name,
              type: 'button',
              id: container ? container.attrs.id : '',
              props: {
                alignment:
                  this.hoveredNode!.attrs.alignment.length > 0
                    ? this.hoveredNode!.attrs.alignment
                    : 'flex-start',
              },
            }
          }
        } else if (this.hoveredNode.type.name === 'embed') {
          const dom = this.pmView.domAtPos(this.hoveredNodeRange!.from)
            .node as HTMLElement
          const embedElement = dom.querySelector('[data-content-type="embed"]')
          if (embedElement) {
            const embedRect = embedElement.getBoundingClientRect()
            const embedTopRightRect = new DOMRect(
              embedRect.right - 162,
              embedRect.top + 12,
              1,
              1,
            )
            this.hyperlinkToolbarState = {
              show: true,
              referencePos: embedTopRightRect,
              url: this.hoveredNode!.attrs.url,
              text: '',
              type: this.hoveredNode.attrs.view === 'Card' ? 'card' : 'embed',
              id: container ? container.attrs.id : '',
            }
          }
        }
      }
      this.updateHyperlinkToolbar()

      return
    }

    // Hides menu.
    if (
      this.hyperlinkToolbarState?.show &&
      // prevHyperlinkMark &&
      !this.selectedNode &&
      !this.hoveredId &&
      !this.isHoveringToolbar
    ) {
      const {markOrNode, range} = getNodeAndRange(
        undefined,
        undefined,
        this.hyperlinkToolbarState.id,
        this.pmView,
        this,
      )

      if (
        this.hyperlinkToolbarState.type === 'link' &&
        markOrNode?.attrs.href.length === 0
      ) {
        if (range && markOrNode)
          this.pmView.dispatch(
            this.pmView.state.tr
              .removeMark(range.from, range.to, markOrNode.type as MarkType)
              .setMeta('preventAutolink', true),
          )
      }
      this.hyperlinkToolbarState.show = false

      this.updateHyperlinkToolbar()

      return
    }
  }

  destroy() {
    this.pmView.dom.removeEventListener('mouseover', this.mouseOverHandler)
    document.removeEventListener('scroll', this.scrollHandler)
    document.removeEventListener('click', this.clickHandler, true)
  }
}

export const hyperlinkToolbarPluginKey = new PluginKey('HyperlinkToolbarPlugin')

export class HyperlinkToolbarProsemirrorPlugin<
  BSchema extends BlockSchema,
> extends EventEmitter<any> {
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

  public setToolbarHovered = (hovered: boolean) => {
    if (this.view) {
      this.view.isHoveringToolbar = hovered
    }
  }

  /**
   * Edit the currently hovered hyperlink.
   */
  public updateHyperlink = (url: string, text: string, hideMenu: boolean) => {
    this.view!.updateHyperlink(url, text, hideMenu)
  }

  /**
   * Delete the currently hovered hyperlink.
   */
  public deleteHyperlink = () => {
    // this.view!.deleteHyperlink()
  }

  /**
   * When hovering on/off hyperlinks using the mouse cursor, the hyperlink
   * toolbar will open & close with a delay.
   *
   * This function starts the delay timer, and should be used for when the mouse cursor enters the hyperlink toolbar.
   */
  public startHideTimer = () => {
    this.view!.startMenuUpdateTimer()
  }

  /**
   * When hovering on/off hyperlinks using the mouse cursor, the hyperlink
   * toolbar will open & close with a delay.
   *
   * This function stops the delay timer, and should be used for when the mouse cursor exits the hyperlink toolbar.
   */
  public stopHideTimer = () => {
    this.view!.stopMenuUpdateTimer()
  }

  public highlightHyperlink() {}

  public resetHyperlink = () => {
    this.view!.resetHyperlink()
  }
}

function getNodeAndRange(
  markOrNode: PMNode | Mark | undefined,
  range: Range | undefined,
  nodeId: string | undefined,
  view: EditorView,
  pluginView: HyperlinkToolbarView<any>,
) {
  if (!markOrNode && !range && nodeId) {
    const {state} = view
    try {
      const {posBeforeNode} = getNodeById(nodeId, state.doc)
      const contentNode = state.doc.nodeAt(posBeforeNode + 1)

      if (contentNode) {
        if (
          contentNode.type.name === 'embed' ||
          contentNode.type.name === 'button'
        ) {
          markOrNode = contentNode
          range = {
            from: posBeforeNode + 1,
            to: posBeforeNode + 1 + contentNode.nodeSize,
          }
        } else {
          // @ts-ignore
          contentNode.descendants((child, childPos) => {
            const linkMark = child.marks?.find(
              (mark) => mark.type.name === 'link',
            )
            if (linkMark) {
              markOrNode = linkMark
              range = {
                from: posBeforeNode + 2 + childPos,
                to: posBeforeNode + 2 + childPos + (child.text?.length || 1),
              }
              return false
            }
            if (child.type.name === 'inline-embed') {
              markOrNode = child
              range = {
                from: posBeforeNode + 2 + childPos,
                to: posBeforeNode + 2 + childPos + child.nodeSize,
              }
              return false
            }
          })
        }
      }
    } catch (e) {
      let missingId
      state.doc.descendants((node, pos) => {
        if (node.attrs.id && node.attrs.id === nodeId) {
          console.log(node)
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
