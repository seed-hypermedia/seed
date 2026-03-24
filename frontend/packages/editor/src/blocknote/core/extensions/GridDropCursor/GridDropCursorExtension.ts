import {Extension} from '@tiptap/core'
import {Plugin} from '@tiptap/pm/state'
import {dropPoint} from '@tiptap/pm/transform'
import {EditorView} from '@tiptap/pm/view'

interface DropCursorOptions {
  color?: string | false
  width?: number
  class?: string
}

/**
 * Drop cursor extension with grid layout handling.
 */
class HMDropCursorView {
  private width: number
  private color: string | undefined
  private cssClass: string | undefined
  private cursorPos: number | null = null
  private element: HTMLElement | null = null
  private timeout: ReturnType<typeof setTimeout> | null = null
  private handlers: {name: string; handler: (e: Event) => void}[]

  constructor(
    private readonly view: EditorView,
    options: DropCursorOptions,
  ) {
    this.width = options.width ?? 1
    this.color = options.color === false ? undefined : options.color || 'black'
    this.cssClass = options.class

    this.handlers = ['dragover', 'dragend', 'drop', 'dragleave'].map((name) => {
      const handler = (e: Event) => (this as any)[name](e)
      view.dom.addEventListener(name, handler)
      return {name, handler}
    })
  }

  destroy() {
    this.handlers.forEach(({name, handler}) => this.view.dom.removeEventListener(name, handler))
  }

  private setCursor(pos: number | null) {
    if (pos === this.cursorPos) return
    this.cursorPos = pos
    if (pos == null) {
      this.element?.parentNode?.removeChild(this.element!)
      this.element = null
    } else {
      this.updateOverlay()
    }
  }

  private updateOverlay() {
    const view = this.view
    const $pos = view.state.doc.resolve(this.cursorPos!)
    const isBlock = !$pos.parent.inlineContent
    let rect: {left: number; right: number; top: number; bottom: number} | undefined

    const editorDOM = view.dom as HTMLElement
    const editorRect = editorDOM.getBoundingClientRect()
    const scaleX = editorRect.width / editorDOM.offsetWidth
    const scaleY = editorRect.height / editorDOM.offsetHeight

    if (isBlock) {
      const before = $pos.nodeBefore
      const after = $pos.nodeAfter
      if (before || after) {
        const node = view.nodeDOM(this.cursorPos! - (before ? before.nodeSize : 0)) as HTMLElement | null
        if (node) {
          const nodeRect = node.getBoundingClientRect()
          let top = before ? nodeRect.bottom : nodeRect.top
          if (before && after) {
            // In a grid, "before" and "after" are side-by-side in the same row,
            // so averaging bottom/top would place the cursor at the row midpoint.
            // Only average for vertical layouts.
            const isGrid = $pos.parent.type.name === 'blockChildren' && $pos.parent.attrs.listType === 'Grid'
            if (!isGrid) {
              top = (top + (view.nodeDOM(this.cursorPos!) as HTMLElement).getBoundingClientRect().top) / 2
            }
          }
          const halfWidth = (this.width / 2) * scaleY
          rect = {left: nodeRect.left, right: nodeRect.right, top: top - halfWidth, bottom: top + halfWidth}
        }
      }
    }

    if (!rect) {
      const coords = view.coordsAtPos(this.cursorPos!)
      const halfWidth = (this.width / 2) * scaleX
      rect = {left: coords.left - halfWidth, right: coords.left + halfWidth, top: coords.top, bottom: coords.bottom}
    }

    const parent = view.dom.offsetParent as HTMLElement | null
    if (!this.element) {
      this.element = (parent ?? document.body).appendChild(document.createElement('div'))
      if (this.cssClass) this.element.className = this.cssClass
      this.element.style.cssText = 'position: absolute; z-index: 50; pointer-events: none;'
      if (this.color) this.element.style.backgroundColor = this.color
    }
    this.element.classList.toggle('prosemirror-dropcursor-block', isBlock)
    this.element.classList.toggle('prosemirror-dropcursor-inline', !isBlock)

    let parentLeft = 0
    let parentTop = 0
    if (!parent || (parent === document.body && getComputedStyle(parent).position === 'static')) {
      parentLeft = -window.pageXOffset
      parentTop = -window.pageYOffset
    } else {
      const pr = parent.getBoundingClientRect()
      const parentScaleX = pr.width / parent.offsetWidth
      const parentScaleY = pr.height / parent.offsetHeight
      parentLeft = pr.left - parent.scrollLeft * parentScaleX
      parentTop = pr.top - parent.scrollTop * parentScaleY
    }

    this.element.style.left = (rect.left - parentLeft) / scaleX + 'px'
    this.element.style.top = (rect.top - parentTop) / scaleY + 'px'
    this.element.style.width = (rect.right - rect.left) / scaleX + 'px'
    this.element.style.height = (rect.bottom - rect.top) / scaleY + 'px'
  }

  private scheduleRemoval(ms: number) {
    if (this.timeout != null) clearTimeout(this.timeout)
    this.timeout = setTimeout(() => this.setCursor(null), ms)
  }

  /**
   * If pos is inside a grid cell, return the position after that cell so the
   * cursor draws at the bottom edge of the cell.
   */
  private gridCellAfterPos(rawPos: number): number | null {
    const $pos = this.view.state.doc.resolve(rawPos)
    for (let d = $pos.depth; d >= 1; d--) {
      if ($pos.node(d).type.name === 'blockNode') {
        const parent = $pos.node(d - 1)
        if (parent?.type.name === 'blockChildren' && parent.attrs.listType === 'Grid') {
          return $pos.after(d)
        }
      }
    }
    return null
  }

  dragover(event: DragEvent) {
    if (!this.view.editable) return
    const pos = this.view.posAtCoords({left: event.clientX, top: event.clientY})

    const node = pos && pos.inside >= 0 && this.view.state.doc.nodeAt(pos.inside)
    const disableDropCursor = node && (node.type.spec as any).disableDropCursor
    const disabled =
      typeof disableDropCursor === 'function' ? disableDropCursor(this.view, pos!, event) : disableDropCursor

    if (pos && !disabled) {
      let target = pos.pos

      // Use the position after the hovered cell so the cursor
      // draws at the cell bottom.
      const gridAfter = this.gridCellAfterPos(pos.pos)
      if (gridAfter !== null) {
        target = gridAfter
      } else if (this.view.dragging?.slice) {
        const point = dropPoint(this.view.state.doc, target, this.view.dragging.slice)
        if (point != null) target = point
      }

      this.setCursor(target)
      this.scheduleRemoval(5000)
    }
  }

  dragend() {
    this.scheduleRemoval(20)
  }

  drop() {
    this.scheduleRemoval(20)
  }

  dragleave(event: DragEvent) {
    if (!this.view.dom.contains(event.relatedTarget as Node)) this.setCursor(null)
  }
}

export const HMDropCursor = Extension.create<DropCursorOptions>({
  name: 'hmDropCursor',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        view: (editorView) => new HMDropCursorView(editorView, this.options),
      }),
    ]
  },
})
