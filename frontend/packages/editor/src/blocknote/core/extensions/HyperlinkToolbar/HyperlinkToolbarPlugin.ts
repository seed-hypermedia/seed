import {getMarkRange, posToDOMRect, Range} from '@tiptap/core'
import {EditorView} from '@tiptap/pm/view'
import {Mark, Node as PMNode} from 'prosemirror-model'
import {Plugin, PluginKey} from 'prosemirror-state'
import type {BlockNoteEditor} from '../../BlockNoteEditor'
import {BaseUiElementState} from '../../shared/BaseUiElementTypes'
import {EventEmitter} from '../../shared/EventEmitter'
import {BlockSchema} from '../Blocks/api/blockTypes'
import {getBlockInfoFromPos} from '../Blocks/helpers/getBlockInfoFromPos'
import {getGroupInfoFromPos} from '../Blocks/helpers/getGroupInfoFromPos'

export type HyperlinkToolbarState = BaseUiElementState & {
  // The hovered hyperlink's URL, and the text it's displayed with in the
  // editor.
  url: string
  text: string
  type: string
  id: string
}

class HyperlinkToolbarView<BSchema extends BlockSchema> {
  private hyperlinkToolbarState?: HyperlinkToolbarState
  public updateHyperlinkToolbar: () => void

  menuUpdateTimer: ReturnType<typeof setTimeout> | undefined
  startMenuUpdateTimer: () => void
  stopMenuUpdateTimer: () => void

  mouseHoveredHyperlinkMark: Mark | PMNode | undefined
  mouseHoveredHyperlinkMarkRange: Range | undefined

  public isHoveringToolbar = false

  keyboardHoveredHyperlinkMark: Mark | PMNode | undefined
  keyboardHoveredHyperlinkMarkRange: Range | undefined

  hyperlinkMark: Mark | PMNode | undefined
  hyperlinkMarkRange: Range | undefined

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
      }, 250)
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

    // const smth = document.getElementsByClassName('switch-toolbar')

    // // console.log(smth)
    // if (smth.length > 0) return

    // // console.log('mouseOver')

    // if (target.closest('.switch-toolbar')) {
    //   console.log('return in toolbar')
    //   // Do NOT reset anything if we're hovering the toolbar itself
    //   return
    // }

    if (this.isHoveringToolbar) return

    // Resets the hyperlink mark currently hovered by the mouse cursor.
    this.mouseHoveredHyperlinkMark = undefined
    this.mouseHoveredHyperlinkMarkRange = undefined

    this.stopMenuUpdateTimer()

    const tiptap = this.editor._tiptapEditor
    const editorElement = document.getElementsByClassName(
      'mantine-Editor-root',
    )[0]
    const editorBoundingBox = editorElement.getBoundingClientRect()
    const {state, view} = tiptap
    if (target.closest('.link')) {
      // Existing link hover logic
      // console.log('link?', target)
      const pos = view.posAtCoords({
        left: editorBoundingBox.left + editorBoundingBox.width / 2,
        top: event.clientY,
      })
      if (pos?.pos) {
        const $pos = state.doc.resolve(pos.pos)
        $pos.parent.descendants((child, childPos) => {
          const linkMark = child.marks.find(
            (mark) => mark.type.name === state.schema.mark('link').type.name,
          )
          // console.log(linkMark)
          if (linkMark) {
            const $childPos = state.doc.resolve(
              childPos + $pos.start() + child.nodeSize,
            )
            // console.log($childPos, $pos, $childPos.parent)
            // console.log(childPos, $pos.start(), child.text, child.nodeSize)
            const markRange = getMarkRange(
              $childPos,
              linkMark.type,
              linkMark.attrs,
            )
            this.mouseHoveredHyperlinkMark = linkMark
            this.mouseHoveredHyperlinkMarkRange = markRange
            // console.log(linkMark, markRange)
          }
        })
      }
    } else if (target.closest('.inline-embed-token')) {
      const pos = view.posAtCoords({
        left: editorBoundingBox.left + editorBoundingBox.width / 2,
        top: event.clientY,
      })
      if (pos?.pos) {
        const $pos = state.doc.resolve(pos.pos)
        $pos.parent.descendants((child, childPos) => {
          if (child.type.name === 'inline-embed') {
            const $childPos = state.doc.resolve(
              childPos + $pos.start() + child.nodeSize,
            )
            // console.log(childPos, $pos.start(), child.text, child.nodeSize)
            const range = {from: $childPos.start(), to: $childPos.end()}
            this.mouseHoveredHyperlinkMark = child
            this.mouseHoveredHyperlinkMarkRange = range
          }
        })
      }
    } else if (target.closest('[data-content-type="button"]')) {
      const pos = view.posAtCoords({
        left: editorBoundingBox.left + editorBoundingBox.width / 2,
        top: event.clientY,
      })
      if (pos?.pos) {
        const $pos = state.doc.resolve(pos.pos)
        if ($pos.parent.type.name === 'button') {
          this.mouseHoveredHyperlinkMark = $pos.parent
          const blockInfo = getBlockInfoFromPos(state, pos.pos)
          this.mouseHoveredHyperlinkMarkRange = {
            from: blockInfo.blockContent.beforePos,
            to: blockInfo.blockContent.afterPos,
          }
        }
      }
    } else if (target.closest('[data-content-type="embed"]')) {
      const pos = view.posAtCoords({
        left: editorBoundingBox.left + editorBoundingBox.width / 2,
        top: event.clientY,
      })
      if (pos?.pos) {
        const $pos = state.doc.resolve(pos.pos)
        if ($pos.parent.type.name === 'embed') {
          this.mouseHoveredHyperlinkMark = $pos.parent
          const blockInfo = getBlockInfoFromPos(state, pos.pos)
          this.mouseHoveredHyperlinkMarkRange = {
            from: blockInfo.blockContent.beforePos,
            to: blockInfo.blockContent.afterPos,
          }
        }
      }
    }

    // const target = event.target
    // if (target instanceof HTMLSpanElement && target.nodeName === 'SPAN') {
    //   if (target.classList.contains('mention-text')) {
    //     const parent = target.parentElement
    //     if (parent && parent.nodeName === 'DIV') {
    //       // const link = parent.getAttribute('data-inline-embed')
    //       const domPos = this.pmView.posAtDOM(target, 0)
    //       const pos = this.pmView.state.doc.resolve(domPos)
    //       let mention = pos.parent.firstChild
    //       if (mention) {
    //         if (mention.type.name === 'inline-embed') {
    //           this.mouseHoveredHyperlinkMark = mention
    //           this.mouseHoveredHyperlinkMarkRange = {
    //             from: pos.start(),
    //             to: pos.end(),
    //           }
    //         } else {
    //           let offset = 0
    //           pos.parent.descendants((node, pos) => {
    //             if (node.type.name === 'inline-embed') {
    //               mention = node
    //               offset = pos
    //             }
    //           })
    //           this.mouseHoveredHyperlinkMark = mention
    //           this.mouseHoveredHyperlinkMarkRange = {
    //             from: pos.start() + offset,
    //             to: pos.start() + offset + 2,
    //           }
    //         }
    //       }
    //     }
    //   }
    // else if (target.classList.contains('hm-link')) {
    //   const posInHoveredHyperlinkMark = this.pmView.posAtDOM(target, 0) + 1
    //   const resolvedPosInHoveredHyperlinkMark = this.pmView.state.doc.resolve(
    //     posInHoveredHyperlinkMark,
    //   )
    //   const marksAtPos = resolvedPosInHoveredHyperlinkMark.marks()

    //   for (const mark of marksAtPos) {
    //     if (
    //       mark.type.name === this.pmView.state.schema.mark('link').type.name
    //     ) {
    //       this.mouseHoveredHyperlinkMark = mark
    //       this.mouseHoveredHyperlinkMarkRange =
    //         getMarkRange(
    //           resolvedPosInHoveredHyperlinkMark,
    //           mark.type,
    //           mark.attrs,
    //         ) || undefined

    //       break
    //     }
    //   }
    // }
    // }
    // if (
    //   (target instanceof HTMLButtonElement &&
    //     target.nodeName === 'BUTTON' &&
    //     target.getAttribute('data-type') === 'hm-button') ||
    //   (target instanceof HTMLSpanElement &&
    //     target.parentElement?.nodeName === 'BUTTON' &&
    //     target.parentElement.getAttribute('data-type') === 'hm-button')
    // ) {
    //   // console.log(target.className, target.getAttribute('data-type'))
    //   console.log(event.target, event.relatedTarget, event.currentTarget)
    // }

    // if (target instanceof HTMLDivElement && target.nodeName === 'DIV') {
    //   console.log(target)
    // }
    this.startMenuUpdateTimer()

    return false
  }

  clickHandler = (event: MouseEvent) => {
    const editorWrapper = this.pmView.dom.parentElement!

    if (
      // Toolbar is open.
      this.hyperlinkMark &&
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
    if (this.hyperlinkMark !== undefined) {
      if (this.hyperlinkToolbarState?.show) {
        this.hyperlinkToolbarState.referencePos = posToDOMRect(
          this.pmView,
          this.hyperlinkMarkRange!.from,
          this.hyperlinkMarkRange!.to,
        )
        this.updateHyperlinkToolbar()
      }
    }
  }
  // the latest param here is to change the latest HM param without closing the link modal.
  // it should be TRUE if you DON't want to close the modal when called.
  editHyperlink(url: string, text: string) {
    let tr = this.pmView.state.tr
    if (
      this.hyperlinkToolbarState &&
      this.hyperlinkToolbarState.type === 'mention'
    ) {
      const pos = this.hyperlinkMarkRange
        ? this.hyperlinkMarkRange.from
        : this.pmView.state.selection.from
      tr = tr.setNodeMarkup(pos, null, {
        link: url,
      })
      // return
    } else {
      tr = this.pmView.state.tr.insertText(
        text,
        this.hyperlinkMarkRange!.from,
        this.hyperlinkMarkRange!.to,
      )
      tr.addMark(
        this.hyperlinkMarkRange!.from,
        this.hyperlinkMarkRange!.from + text.length,
        this.pmView.state.schema.mark('link', {href: url}),
      )
    }

    this.pmView.dispatch(tr)

    this.pmView.focus()

    if (this.hyperlinkToolbarState?.show) {
      this.hyperlinkToolbarState.show = false
      this.updateHyperlinkToolbar()
    }
  }

  updateHyperlink(url: string, text: string) {
    let tr = this.pmView.state.tr
    if (
      this.hyperlinkToolbarState &&
      this.hyperlinkToolbarState.type === 'mention'
    ) {
      const pos = this.hyperlinkMarkRange
        ? this.hyperlinkMarkRange.from
        : this.pmView.state.selection.from
      tr = tr.setNodeMarkup(pos, null, {
        link: url,
      })
      // return
    } else {
      const newLength = this.hyperlinkMarkRange!.from + text.length
      tr = this.pmView.state.tr
        .insertText(
          text,
          this.hyperlinkMarkRange!.from,
          this.hyperlinkMarkRange!.to,
        )
        .addMark(
          this.hyperlinkMarkRange!.from,
          newLength,
          this.pmView.state.schema.mark('link', {href: url}),
        )

      this.hyperlinkMarkRange!.to = newLength
    }

    this.pmView.dispatch(tr)
  }

  highlightHyperlink() {}

  resetHyperlink() {
    // @ts-ignore
    this.hyperlinkToolbarState = {
      ...this.hyperlinkToolbarState,
      show: false,
      url: '',
      text: '',
      type: '',
      id: '',
    }
    this.isHoveringToolbar = false
    this.updateHyperlinkToolbar()
  }

  deleteHyperlink() {
    if (this.hyperlinkMark instanceof Mark) {
      this.pmView.dispatch(
        this.pmView.state.tr
          .removeMark(
            this.hyperlinkMarkRange!.from,
            this.hyperlinkMarkRange!.to,
            this.hyperlinkMark!.type,
          )
          .setMeta('preventAutolink', true),
      )
    } else if (
      this.hyperlinkToolbarState &&
      this.hyperlinkToolbarState.type === 'mention'
    ) {
      const state = this.pmView.state
      let tr = state.tr
      const pos = this.hyperlinkMarkRange
        ? this.hyperlinkMarkRange.from
        : this.pmView.state.selection.from
      const $pos = state.doc.resolve(pos)
      let offset = 0
      $pos.parent.descendants((node, pos) => {
        if (
          node.type.name === 'inline-embed' &&
          node.attrs.link === this.hyperlinkToolbarState!.url
        ) {
          offset = pos
        }
      })
      tr = tr.replaceRangeWith(
        $pos.start() + offset,
        $pos.start() + offset + 1,
        state.schema.text(this.hyperlinkToolbarState.text),
      )
      // tr = tr.setNodeMarkup(pos, state.schema.nodes['paragraph'])
      this.pmView.dispatch(tr)
    }

    this.pmView.focus()

    if (this.hyperlinkToolbarState?.show) {
      this.hyperlinkToolbarState.show = false
      this.updateHyperlinkToolbar()
    }
  }

  update() {
    // if (!this.pmView.hasFocus()) {
    //   return
    // }

    // Saves the currently hovered hyperlink mark before it's updated.
    const prevHyperlinkMark = this.hyperlinkMark
    const prevHyperlinkMarkRange = this.hyperlinkMarkRange

    // Resets the currently hovered hyperlink mark.
    this.hyperlinkMark = undefined
    this.hyperlinkMarkRange = undefined

    // Resets the hyperlink mark currently hovered by the keyboard cursor.
    this.keyboardHoveredHyperlinkMark = undefined
    this.keyboardHoveredHyperlinkMarkRange = undefined

    // Finds link mark at the editor selection's position to update keyboardHoveredHyperlinkMark and
    // keyboardHoveredHyperlinkMarkRange.
    // if (this.pmView.state.selection.empty) {
    const marksAtPos = this.pmView.state.selection.$from.marks()

    if (marksAtPos.length > 0) {
      for (const mark of marksAtPos) {
        if (
          mark.type.name === this.pmView.state.schema.mark('link').type.name
        ) {
          this.keyboardHoveredHyperlinkMark = mark
          this.keyboardHoveredHyperlinkMarkRange =
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
              this.keyboardHoveredHyperlinkMark = textNode
              this.keyboardHoveredHyperlinkMarkRange = {
                from: this.pmView.state.selection.from,
                to: this.pmView.state.selection.to,
              }
            }
            break
          case 'button':
            this.keyboardHoveredHyperlinkMark = textNode
            this.keyboardHoveredHyperlinkMarkRange = {
              from: this.pmView.state.selection.from,
              to: this.pmView.state.selection.to,
            }
            break
          case 'embed':
            this.keyboardHoveredHyperlinkMark = textNode
            this.keyboardHoveredHyperlinkMarkRange = {
              from: this.pmView.state.selection.from,
              to: this.pmView.state.selection.to,
            }
            break
          default:
            break
        }
      }
    }

    if (this.mouseHoveredHyperlinkMark) {
      this.hyperlinkMark = this.mouseHoveredHyperlinkMark
      this.hyperlinkMarkRange = this.mouseHoveredHyperlinkMarkRange
    }

    // Keyboard cursor position takes precedence over mouse hovered hyperlink.
    if (this.keyboardHoveredHyperlinkMark) {
      this.hyperlinkMark = this.keyboardHoveredHyperlinkMark
      this.hyperlinkMarkRange = this.keyboardHoveredHyperlinkMarkRange
    }

    if (this.hyperlinkMark && this.editor.isEditable) {
      const {container} = getGroupInfoFromPos(
        this.pmView.state.selection.from,
        this.pmView.state,
      )
      if (this.hyperlinkMark instanceof Mark) {
        this.hyperlinkToolbarState = {
          show: this.pmView.state.selection.empty,
          referencePos: posToDOMRect(
            this.pmView,
            this.hyperlinkMarkRange!.from,
            this.hyperlinkMarkRange!.to,
          ),
          url: this.hyperlinkMark!.attrs.href,
          text: this.pmView.state.doc.textBetween(
            this.hyperlinkMarkRange!.from,
            this.hyperlinkMarkRange!.to,
          ),
          type: 'link',
          id: container ? container.attrs.id : '',
        }
      } else if (this.hyperlinkMark instanceof PMNode) {
        // const parent = this.pmView.state.selection.$anchor.parent
        if (this.hyperlinkMark.type.name === 'inline-embed')
          this.hyperlinkToolbarState = {
            // show:
            //   parent &&
            //   this.pmView.state.doc
            //     .resolve(this.hyperlinkMarkRange!.from)
            //     .parent.eq(parent),
            show: true,
            referencePos: posToDOMRect(
              this.pmView,
              this.hyperlinkMarkRange!.from,
              this.hyperlinkMarkRange!.to,
            ),
            url: this.hyperlinkMark!.attrs.link,
            text: ' ',
            type: 'mention',
            id: container ? container.attrs.id : '',
          }
        else if (this.hyperlinkMark.type.name === 'button') {
          this.hyperlinkToolbarState = {
            // show:
            //   parent &&
            //   this.pmView.state.doc
            //     .resolve(this.hyperlinkMarkRange!.from)
            //     .parent.eq(parent),
            show: true,
            referencePos: posToDOMRect(
              this.pmView,
              this.hyperlinkMarkRange!.from,
              this.hyperlinkMarkRange!.to,
            ),
            url: this.hyperlinkMark!.attrs.url,
            text: this.hyperlinkMark!.attrs.name,
            type: 'button',
            id: container ? container.attrs.id : '',
          }
        } else if (this.hyperlinkMark.type.name === 'embed') {
          this.hyperlinkToolbarState = {
            // show:
            //   parent &&
            //   this.pmView.state.doc
            //     .resolve(this.hyperlinkMarkRange!.from)
            //     .parent.eq(parent),
            show: true,
            referencePos: posToDOMRect(
              this.pmView,
              this.hyperlinkMarkRange!.from,
              this.hyperlinkMarkRange!.to,
            ),
            url: this.hyperlinkMark!.attrs.url,
            text: '',
            type: 'embed',
            id: container ? container.attrs.id : '',
          }
        }
      }

      this.updateHyperlinkToolbar()

      return
    }

    // console.log(
    //   prevHyperlinkMark,
    //   this.hyperlinkMark,
    //   this.hyperlinkToolbarState?.show,
    // )

    // Hides menu.
    if (
      this.hyperlinkToolbarState?.show &&
      // prevHyperlinkMark &&
      (!this.hyperlinkMark || !this.editor.isEditable)
    ) {
      // console.log('here', this.isHoveringToolbar)
      if (this.isHoveringToolbar) {
        return
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
  public editHyperlink = (url: string, text: string) => {
    this.view!.editHyperlink(url, text)
  }

  /**
   * Edit the currently hovered hyperlink.
   */
  public updateHyperlink = (url: string, text: string) => {
    this.view!.updateHyperlink(url, text)
  }

  /**
   * Delete the currently hovered hyperlink.
   */
  public deleteHyperlink = () => {
    this.view!.deleteHyperlink()
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
