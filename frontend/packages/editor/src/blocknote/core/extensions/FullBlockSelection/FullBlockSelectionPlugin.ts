import {AllSelection, EditorState, NodeSelection, Plugin, PluginKey, PluginView, TextSelection} from 'prosemirror-state'
import {Decoration, DecorationSet, EditorView} from 'prosemirror-view'
import {Node} from 'prosemirror-model'

import type {BlockNoteEditor} from '../../BlockNoteEditor'
import {EventEmitter} from '../../shared/EventEmitter'
import type {BlockSchema} from '../Blocks/api/blockTypes'
import {getBlockInfoWithManualOffset} from '../Blocks/helpers/getBlockInfoFromPos'
import {MultipleNodeSelection} from '../SideMenu/MultipleNodeSelection'
import {selectableNodeTypes} from '../Blocks/api/selectable-node-types'

import './full-block-selection.css'

/**
 * The state emitted to React subscribers whenever the set of fully-selected
 * blocks changes.
 */
export type FullBlockSelectionState = {
  /** IDs of blocks whose content is fully covered by the current selection. */
  blockIds: string[]
}

/** Internal EventEmitter event map. */
type FullBlockSelectionEvents = {
  update: [FullBlockSelectionState]
}

/** Combined plugin state: block IDs for the callback + decorations for the CSS class. */
type PluginState = {
  blockIds: string[]
  decorations: DecorationSet
}

/** ProseMirror plugin key for the FullBlockSelection plugin. */
export const fullBlockSelectionPluginKey = new PluginKey<PluginState>('FullBlockSelectionPlugin')

const DECORATION_CLASS = 'bn-full-block-selected'

/**
 * Window after a user press on an editable target during which the
 * NodeSelection-protection machinery (focus recovery, echo restore) stands
 * down — the user is deliberately placing a text selection.
 */
const RECENT_INTERACTION_MS = 500

/**
 * Detect which blocks have their entire text content covered by the current
 * selection. Returns an array of block IDs.
 */
function detectFullySelectedBlocks(state: EditorState): string[] {
  const {selection} = state
  const fullySelected: string[] = []

  if (selection.empty) return fullySelected

  // MultipleNodeSelection: each node in the selection is a fully-selected block.
  if (selection instanceof MultipleNodeSelection) {
    for (const node of selection.nodes) {
      if (node.type.name === 'blockNode' || node.type.isInGroup('blockNodeChild')) {
        const id = node.attrs['id'] as string | undefined
        if (id) fullySelected.push(id)
      }
    }
    return fullySelected
  }

  // NodeSelection: the selected node itself (or its parent block) is fully selected.
  if (selection instanceof NodeSelection) {
    const node = selection.node
    if (node.type.name === 'blockNode' || node.type.isInGroup('blockNodeChild')) {
      const id = node.attrs['id'] as string | undefined
      if (id) fullySelected.push(id)
    } else if (node.type.spec.group === 'block') {
      // Selected node is a blockContent — find the parent blockNode.
      const $pos = state.doc.resolve(selection.from)
      for (let depth = $pos.depth; depth > 0; depth--) {
        const ancestor = $pos.node(depth)
        if (ancestor.type.name === 'blockNode' || ancestor.type.isInGroup('blockNodeChild')) {
          const id = ancestor.attrs['id'] as string | undefined
          if (id) fullySelected.push(id)
          break
        }
      }
    }
    return fullySelected
  }

  // TextSelection: check each block in the selection range.
  if (selection instanceof TextSelection) {
    const {from, to} = selection

    if (selectionSpansOutsideHeadingContent(state, from, to)) {
      return fullySelected
    }

    state.doc.nodesBetween(from, to, (node, pos) => {
      if (node.type.name !== 'blockNode') return true // keep descending

      try {
        const blockInfo = getBlockInfoWithManualOffset(node, pos)
        const contentStart = blockInfo.blockContent.beforePos + 1
        const contentEnd = blockInfo.blockContent.afterPos - 1

        if (from <= contentStart && to >= contentEnd) {
          const id = node.attrs['id'] as string | undefined
          if (id) fullySelected.push(id)
        }
      } catch {
        // Not a valid block structure — skip.
      }

      // Continue descending to check nested blocks independently.
      return true
    })

    return fullySelected
  }

  // AllSelection: every top-level block is fully selected.
  if (selection instanceof AllSelection) {
    state.doc.descendants((node) => {
      if (node.type.name === 'blockNode') {
        const id = node.attrs['id'] as string | undefined
        if (id) fullySelected.push(id)
        return false // don't collect nested blocks inside this blockNode
      }
      return true
    })
    return fullySelected
  }

  // Other selection shapes (e.g. CellSelection inside a table) don't fully
  // select any block.
  return fullySelected
}

/**
 * Returns true when a text selection touches heading text and also extends
 * outside that heading's own text content range.
 *
 * Heading blocks can also be section parents for nested content. When a drag
 * selection starts in a heading and extends into that section's children, the
 * generic full-block detection would otherwise convert the fully-covered child
 * blocks into block selections while the heading remains native text. That
 * mixed visual state makes the two selection backgrounds compete, so heading
 * section-crossing selections stay native text selections end-to-end.
 */
function selectionSpansOutsideHeadingContent(state: EditorState, from: number, to: number): boolean {
  let spansOutsideHeading = false

  state.doc.nodesBetween(from, to, (node, pos) => {
    if (node.type.name !== 'heading') return true

    const contentStart = pos + 1
    const contentEnd = pos + node.nodeSize - 1

    const touchesHeading = from < contentEnd && to > contentStart
    if (!touchesHeading) {
      return true
    }

    if (from < contentStart || to > contentEnd) {
      spansOutsideHeading = true
      return false
    }

    return true
  })

  return spansOutsideHeading
}

/**
 * Build a DecorationSet applying the full-block-selected CSS class to every
 * blockNode whose ID is in the given set.
 */
function buildDecorations(doc: Node, blockIds: string[]): DecorationSet {
  if (blockIds.length === 0) return DecorationSet.empty

  const idSet = new Set(blockIds)
  const decorations: Decoration[] = []

  doc.descendants((node, pos) => {
    if (node.type.name === 'blockNode' && idSet.has(node.attrs['id'] as string)) {
      try {
        const blockInfo = getBlockInfoWithManualOffset(node, pos)
        if (selectableNodeTypes.includes(blockInfo.blockContentType)) {
          return true
        }
      } catch {
        // Not a valid block structure — apply decoration anyway.
      }
      decorations.push(
        Decoration.node(pos, pos + node.nodeSize, {
          class: DECORATION_CLASS,
        }),
      )
    }
    return true
  })

  return DecorationSet.create(doc, decorations)
}

/** Shallow equality check for string arrays. */
function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

/**
 * PluginView that watches for changes in the plugin state and emits events to
 * React subscribers via the EventEmitter.
 *
 * @internal
 */
class FullBlockSelectionView implements PluginView {
  private prevBlockIds: string[] = []
  private prevSelection: EditorState['selection'] | null = null

  constructor(
    private readonly pmView: EditorView,
    private readonly onUpdate: (state: FullBlockSelectionState) => void,
    private readonly interaction: {editableAt: number},
  ) {
    this.pmView.dom.ownerDocument.addEventListener('selectionchange', this.onDocumentSelectionChange)
    this.pmView.dom.ownerDocument.addEventListener('focusin', this.onDocumentSelectionChange)
  }

  /**
   * While a block is node-selected, browsers can bounce the drawn DOM
   * selection into a nested editable island (e.g. an image caption), moving
   * DOM focus there. Keyboard events then stop reaching the editor and the
   * selected block appears "stuck". Pull focus back to the editor root —
   * but ONLY out of a nested contentEditable island the browser bounced
   * into on its own: never within RECENT_INTERACTION_MS of a user press on
   * an editable target (that's the user clicking the caption to edit it),
   * and never from real controls (buttons, inputs — not contentEditable).
   */
  private onDocumentSelectionChange = () => {
    const view = this.pmView
    if (!view.editable || !(view.state.selection instanceof NodeSelection)) return
    if (view.hasFocus()) return
    if (Date.now() - this.interaction.editableAt < RECENT_INTERACTION_MS) return
    const active = view.dom.ownerDocument.activeElement
    if (!active || !view.dom.contains(active)) return
    if (!(active instanceof HTMLElement) || !active.isContentEditable)
      return // Focus the editor root directly — view.focus() would redraw the
      // unrepresentable DOM range and bounce focus right back. With no DOM
      // range at all there is nothing for the browser to normalize; the state
      // selection stays authoritative (observer reads are suppressed above).
    ;(view.dom as HTMLElement).focus({preventScroll: true})
    const domSelection = view.dom.ownerDocument.getSelection()
    domSelection?.removeAllRanges()
  }

  update(view: EditorView) {
    // While a NodeSelection is active, suppress the DOM observer's selection
    // reads. ProseMirror draws a DOM selection spanning the node; browsers
    // bounce it off contentEditable=false node views back to some text
    // position (often asynchronously, after React re-renders), firing
    // selectionchange events that would silently replace the block selection
    // with a stray text cursor. While suppressed, ProseMirror re-asserts the
    // state selection instead of reading the browser's. Real user actions
    // (mouse, keyboard) go through event handlers, not the observer, so they
    // still change the selection normally — and unsuppress it here.
    // Only toggle the flag on NodeSelection transitions so ProseMirror's own
    // short suppression windows (e.g. its Android-Chrome backspace
    // workaround) survive unrelated text-editing transactions.
    const selection = view.state.selection
    const isNode = selection instanceof NodeSelection
    const wasNode = this.prevSelection instanceof NodeSelection
    const domObserver = (view as any).domObserver
    if (domObserver && 'suppressingSelectionUpdates' in domObserver) {
      if (isNode) {
        domObserver.suppressingSelectionUpdates = true
      } else if (wasNode) {
        domObserver.suppressingSelectionUpdates = false
      }
    }
    this.prevSelection = selection

    const pluginState = fullBlockSelectionPluginKey.getState(view.state)
    if (!pluginState) return

    const {blockIds} = pluginState
    if (!arraysEqual(this.prevBlockIds, blockIds)) {
      this.prevBlockIds = blockIds
      this.onUpdate({blockIds})
    }
  }

  destroy() {
    this.pmView.dom.ownerDocument.removeEventListener('selectionchange', this.onDocumentSelectionChange)
    this.pmView.dom.ownerDocument.removeEventListener('focusin', this.onDocumentSelectionChange)
    // Emit empty state on teardown so subscribers can clean up.
    if (this.prevBlockIds.length > 0) {
      this.onUpdate({blockIds: []})
    }
  }
}

/**
 * ProseMirror plugin that detects when the user's selection fully covers a
 * block's text content, applies a CSS decoration, and emits events for React
 * consumption.
 *
 * @example
 * ```ts
 * const plugin = new FullBlockSelectionProsemirrorPlugin(editor)
 * plugin.onUpdate((state) => {
 *   console.log('fully selected blocks:', state.blockIds)
 * })
 * ```
 */
export class FullBlockSelectionProsemirrorPlugin<
  BSchema extends BlockSchema,
> extends EventEmitter<FullBlockSelectionEvents> {
  /** The raw ProseMirror plugin to register in the editor's plugin list. */
  public readonly plugin: Plugin

  constructor(_editor: BlockNoteEditor<BSchema>) {
    super()

    // Timestamp of the last user press on an editable target, shared between
    // the DOM handlers and the plugin view: it marks "the user is placing a
    // text selection right now", so the NodeSelection-protection machinery
    // (focus recovery, echo restore) must stand down.
    const interaction = {editableAt: 0}

    // Lift the observer suppression when the user presses down in an
    // editable text area (mouse AND touch/pen via pointerdown, which fires
    // before long-press text selection on mobile); presses on non-editable
    // block chrome keep it, so the post-dispatch bounce stays contained.
    const liftSuppressionForEditableTarget = (view: EditorView, event: Event) => {
      if (!(view.state.selection instanceof NodeSelection)) return false
      let el: Element | null = event.target instanceof Element ? event.target : null
      let editableTarget = false
      while (el && el !== view.dom) {
        const ce = el.getAttribute?.('contenteditable')
        if (ce === 'true') {
          editableTarget = true
          break
        }
        if (ce === 'false') break
        el = el.parentElement
      }
      if (el === view.dom) editableTarget = true
      if (editableTarget) {
        interaction.editableAt = Date.now()
        const domObserver = (view as any).domObserver
        if (domObserver && 'suppressingSelectionUpdates' in domObserver) {
          domObserver.suppressingSelectionUpdates = false
        }
      }
      return false
    }

    this.plugin = new Plugin<PluginState>({
      key: fullBlockSelectionPluginKey,

      state: {
        init(_, state) {
          const blockIds = detectFullySelectedBlocks(state)
          return {
            blockIds,
            decorations: buildDecorations(state.doc, blockIds),
          }
        },

        apply(tr, prev, _oldState, newState) {
          // Only recompute when the selection or document changed.
          if (!tr.selectionSet && !tr.docChanged) return prev

          const blockIds = detectFullySelectedBlocks(newState)

          if (arraysEqual(blockIds, prev.blockIds)) {
            // Block IDs unchanged — just map decorations through doc changes.
            return {
              blockIds: prev.blockIds,
              decorations: tr.docChanged ? prev.decorations.map(tr.mapping, tr.doc) : prev.decorations,
            }
          }

          return {
            blockIds,
            decorations: buildDecorations(newState.doc, blockIds),
          }
        },
      },

      props: {
        decorations(state) {
          return fullBlockSelectionPluginKey.getState(state)?.decorations ?? DecorationSet.empty
        },

        handleDOMEvents: {
          // While a NodeSelection is active the DOM observer's selection
          // reads are suppressed (see FullBlockSelectionView.update). Plain
          // text clicks and mobile long-press selection rely on that observer
          // path: the browser places the caret/range and ProseMirror reads it
          // back. Lift the suppression for presses on editable text.
          mousedown: liftSuppressionForEditableTarget,
          pointerdown: liftSuppressionForEditableTarget,
        },
      },

      // Keep NodeSelections stable against the DOM-observer echo: after we
      // node-select a block whose node view renders a contentDOM (e.g. an
      // image with its caption), the browser normalizes the drawn DOM
      // selection into that contentDOM and ProseMirror's DOMObserver reads it
      // back as a TextSelection exactly covering the node's inline content —
      // silently downgrading the block selection. Detect that precise shape
      // (selection-only change, same node, full coverage) and restore the
      // NodeSelection. Genuine user selections never match it: clicks produce
      // carets and drags produce ranges that don't exactly equal the node
      // boundaries of a previously node-selected block.
      appendTransaction(transactions, oldState, newState) {
        if (!(oldState.selection instanceof NodeSelection)) return null
        if (newState.selection instanceof NodeSelection) return null
        if (!(newState.selection instanceof TextSelection)) return null
        if (!transactions.some((tr) => tr.selectionSet)) return null

        // Never fight user-driven selection changes: pointer/uiEvent/
        // composition-tagged transactions, or anything right after a press on
        // an editable target (e.g. a click into an EMPTY image caption, whose
        // caret position coincides with "full coverage" below).
        if (transactions.some((tr) => tr.getMeta('pointer') || tr.getMeta('uiEvent') || tr.getMeta('composition'))) {
          return null
        }
        if (Date.now() - interaction.editableAt < RECENT_INTERACTION_MS) return null

        const {from} = oldState.selection
        const node = oldState.selection.node
        const coversExactly = newState.selection.from === from + 1 && newState.selection.to === from + node.nodeSize - 1
        if (!coversExactly) return null

        // The echo can arrive as a doc-"changing" transaction (node-view
        // re-renders get re-parsed), so don't gate on tr.docChanged — require
        // instead that the node at the selection position is still the same
        // block content.
        const nodeAtPos = newState.doc.nodeAt(from)
        if (!nodeAtPos || !nodeAtPos.eq(node)) return null

        return newState.tr.setSelection(NodeSelection.create(newState.doc, from))
      },

      view: (editorView) => {
        return new FullBlockSelectionView(
          editorView,
          (state) => {
            this.emit('update', state)
          },
          interaction,
        )
      },
    })
  }

  /**
   * Subscribes to full-block-selection state updates. Returns an unsubscribe
   * function that should be called on cleanup (e.g. in a React useEffect return).
   */
  public onUpdate(callback: (state: FullBlockSelectionState) => void): () => void {
    return this.on('update', callback)
  }
}
