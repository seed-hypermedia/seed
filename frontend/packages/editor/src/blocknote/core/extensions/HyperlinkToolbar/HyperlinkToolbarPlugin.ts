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

export type HyperlinkNodeType =
  | 'link'
  | 'inline-embed'
  | 'embed'
  | 'card'
  | 'button'
  | null

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

  let node: Node | null =
    (pos.inside >= 0 ? view.nodeDOM(pos.inside) : null) ??
    view.domAtPos(pos.pos).node
  if (!node) return undefined
  // let atomNode = view.nodeDOM(pos.inside) as HTMLElement

  if (node === view.dom) {
    // mouse over root
    return undefined
  }

  if (node.nodeType === Node.TEXT_NODE) node = node.parentNode
  let el = node as HTMLElement | null

  while (
    el &&
    el.parentNode &&
    el.parentNode !== view.dom &&
    !(el as any).hasAttribute?.('data-id')
  ) {
    el = el.parentNode as HTMLElement
  }
  if (!el) return undefined

  const id = (el as any).getAttribute?.('data-id')
  if (!id) return undefined
  return {node: el, id}
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
      if (!this.hyperlinkToolbarState) return
      updateHyperlinkToolbar(this.hyperlinkToolbarState)
    }

    this.startMenuUpdateTimer = () => {
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

    const coords = {left: event.clientX, top: event.clientY}
    let nextId: string | undefined
    if (target.closest('.link') || target.closest('.inline-embed-token')) {
      nextId = getNodeIdFromCoords(coords, this.pmView)?.id
    } else if (target.closest('[data-content-type="button"]')) {
      if (target.tagName === 'BUTTON' || target.closest('button')) {
        nextId = getNodeIdFromCoords(coords, this.pmView)?.id
      }
    } else if (
      target.closest('[data-content-type="embed"]')?.getAttribute('data-url')
    ) {
      nextId = getNodeIdFromCoords(coords, this.pmView)?.id
    }

    if (nextId) {
      if (nextId !== this.hoveredId) this.hoveredId = nextId
    }

    // Defer recalculation/close
    this.startMenuUpdateTimer()
    return false
  }

  clickHandler = (event: MouseEvent) => {
    const target = event.target as Node | null
    if (!target) return
    if (
      this.isHoveringToolbar ||
      (target as HTMLElement).closest?.('.hyperlink-preview-toolbar')
    ) {
      return
    }

    const editorWrapper = this.pmView.dom.parentElement!
    const clickedOutsideEditor = !(
      editorWrapper === target || editorWrapper?.contains(target)
    )

    if (
      // Toolbar is open.
      (this.selectedNode || this.hoveredId) &&
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
        this.hyperlinkToolbarState?.url,
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
        // Update the same node/range that was originally set (selected or hovered)
        if (this.selectedNode || this.selectedNodeRange) {
          this.selectedNode = markOrNode
          this.selectedNodeRange = range
        } else if (this.hoveredNode || this.hoveredNodeRange) {
          this.hoveredNode = markOrNode
          this.hoveredNodeRange = range
        }
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
        const newLength = range.from + newText.length
        tr = this.pmView.state.tr
          .insertText(newText, range.from, range.to)
          .addMark(
            range.from,
            newLength,
            this.pmView.state.schema.mark('link', {href: url}),
          )

        range.to = newLength
      }
    } else if (this.hyperlinkToolbarState && !range) {
      console.error('Range is undefined', this.hyperlinkToolbarState)
      return
    }

    this.isHoveringToolbar = true
    setTimeout(() => {
      this.isHoveringToolbar = false
    }, 200)

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
    this.isHoveringToolbar = false
    this.hoveredId = undefined
    this.updateHyperlinkToolbar()
  }

  updateFormRect() {
    let markOrNode = this.selectedNode || this.hoveredNode
    let range = this.selectedNodeRange || this.hoveredNodeRange
    const nodeId = this.hoveredId || this.hyperlinkToolbarState?.id

    const nodeAndRange = getNodeAndRange(
      markOrNode,
      range,
      nodeId,
      this.pmView,
      this,
      this.hyperlinkToolbarState?.url,
    )
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

  private updateFromSelection(): HyperlinkToolbarState | null {
    this.selectedNode = undefined
    this.selectedNodeRange = undefined
    let nextState: HyperlinkToolbarState | null = null

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
      const nodeRect = posToDOMRect(
        this.pmView,
        this.selectedNodeRange!.from,
        this.selectedNodeRange!.to,
      )
      if (this.selectedNode instanceof Mark) {
        nextState = {
          show: this.pmView.state.selection.empty,
          referencePos: nodeRect,
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
          nextState = {
            show: true,
            referencePos: nodeRect,
            url: this.selectedNode!.attrs.link,
            text: ' ',
            type: 'inline-embed',
            id: container ? container.attrs.id : '',
          }
        else if (this.selectedNode.type.name === 'button') {
          const dom = this.pmView.domAtPos(this.selectedNodeRange!.from)
            .node as HTMLElement
          const buttonElement = dom.querySelector(
            'button',
          ) as HTMLElement | null

          const buttonRect =
            buttonElement?.getBoundingClientRect?.() ?? nodeRect

          // console.log('~~~~~ UPDATING SELECTED BUTTON', this.selectedNode)

          const alignAttr = this.selectedNode!.attrs.alignment
          const alignment =
            typeof alignAttr === 'string' && alignAttr.length > 0
              ? alignAttr
              : 'flex-start'

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
          const dom = this.pmView.domAtPos(this.selectedNodeRange!.from)
            .node as HTMLElement
          const embedElement = dom.querySelector('[data-content-type="embed"]')
          const embedRect = embedElement?.getBoundingClientRect?.() ?? nodeRect
          const embedTopRightRect = new DOMRect(
            embedRect.right - 162,
            embedRect.top + 12,
            1,
            1,
          )
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

  private updateFromHover(): HyperlinkToolbarState | null {
    this.hoveredNode = undefined
    this.hoveredNodeRange = undefined
    let nextState: HyperlinkToolbarState | null = null

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
        let stillExists = false
        // @ts-ignore
        state.doc.descendants((node) => {
          if (node.attrs?.id === this.hoveredId) {
            stillExists = true
            return false
          }
        })

        if (!stillExists) {
          this.hoveredId = undefined
          this.resetHyperlink()
          return null
        }
      }
    }

    if (this.hoveredNode) {
      const {container} = getGroupInfoFromPos(
        this.hoveredNodeRange!.from,
        this.pmView.state,
      )
      const nodeRect = posToDOMRect(
        this.pmView,
        this.hoveredNodeRange!.from,
        this.hoveredNodeRange!.to,
      )
      if (this.hoveredNode instanceof Mark) {
        nextState = {
          show: this.pmView.state.selection.empty,
          referencePos: nodeRect,
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
          nextState = {
            show: true,
            referencePos: nodeRect,
            url: this.hoveredNode!.attrs.link,
            text: ' ',
            type: 'inline-embed',
            id: container ? container.attrs.id : '',
          }
        else if (this.hoveredNode.type.name === 'button') {
          const dom = this.pmView.domAtPos(this.hoveredNodeRange!.from)
            .node as HTMLElement
          const buttonElement = dom.querySelector(
            'button',
          ) as HTMLElement | null

          const buttonRect =
            buttonElement?.getBoundingClientRect?.() ?? nodeRect

          const alignAttr = this.hoveredNode!.attrs.alignment
          const alignment =
            typeof alignAttr === 'string' && alignAttr.length > 0
              ? alignAttr
              : 'flex-start'

          nextState = {
            show: true,
            referencePos: buttonRect,
            url: this.hoveredNode!.attrs.url,
            text: this.hoveredNode!.attrs.name,
            type: 'button',
            id: container ? container.attrs.id : '',
            props: {
              // @ts-ignore
              alignment: alignment,
            },
          }
        } else if (this.hoveredNode.type.name === 'embed') {
          const dom = this.pmView.domAtPos(this.hoveredNodeRange!.from)
            .node as HTMLElement
          const embedElement = dom.querySelector('[data-content-type="embed"]')
          const embedRect = embedElement?.getBoundingClientRect?.() ?? nodeRect
          const embedTopRightRect = new DOMRect(
            embedRect.right - 162,
            embedRect.top + 12,
            1,
            1,
          )
          nextState = {
            show: true,
            referencePos: embedTopRightRect,
            url: this.hoveredNode!.attrs.url,
            text: '',
            type: this.hoveredNode.attrs.view === 'Card' ? 'card' : 'embed',
            id: container ? container.attrs.id : '',
          }
        }
      }

      return nextState
    }

    return nextState
  }

  update() {
    // if (!this.pmView.hasFocus()) {
    //   return
    // }

    const selectionState = this.updateFromSelection()
    if (selectionState) {
      this.hyperlinkToolbarState = selectionState
      this.updateHyperlinkToolbar()
      return
    }
    const hoverState = this.updateFromHover()
    if (hoverState) {
      this.hyperlinkToolbarState = hoverState
      this.updateHyperlinkToolbar()
      return
    }

    // Hides menu.
    if (
      this.hyperlinkToolbarState?.show &&
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
        this.hyperlinkToolbarState.url,
      )
      if (
        this.hyperlinkToolbarState.type === 'link' &&
        markOrNode?.attrs?.href?.length === 0 &&
        range
      ) {
        this.pmView.dispatch(
          this.pmView.state.tr
            .removeMark(
              range.from,
              range.to,
              (markOrNode as Mark).type as MarkType,
            )
            .setMeta('preventAutolink', true),
        )
      }
      this.hyperlinkToolbarState = {...this.hyperlinkToolbarState, show: false}
      this.updateHyperlinkToolbar()
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

  public updatePosition = () => {
    this.view!.updateFormRect()
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
  url?: string,
) {
  if (!range && nodeId) {
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
          let foundLink = false
          // @ts-ignore
          contentNode.descendants((child, childPos) => {
            const linkMark = child.marks?.find(
              (mark) => mark.type.name === 'link',
            )
            if (linkMark) {
              const absolutePos = posBeforeNode + 2 + childPos
              const $pos = state.doc.resolve(absolutePos)
              const markRange = getMarkRange(
                $pos,
                linkMark.type,
                linkMark.attrs,
              )
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
