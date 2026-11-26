import {history, undo} from '@tiptap/pm/history'
import {Node as PMNode, Schema} from 'prosemirror-model'
import {EditorState, Selection, Transaction} from 'prosemirror-state'
import {describe, expect, it} from 'vitest'
import {BlockRangeSelection} from './BlockRangeSelection'

/** The editor's block structure with one kind of card: doc > blockChildren > blockNode > (paragraph | image). */
const schema = new Schema({
  nodes: {
    doc: {content: 'blockChildren'},
    blockChildren: {content: 'blockNode+', attrs: {listType: {default: 'Group'}}},
    blockNode: {content: 'block blockChildren?', attrs: {id: {default: null}}},
    paragraph: {content: 'text*', group: 'block'},
    image: {group: 'block', atom: true, attrs: {name: {default: ''}}},
    text: {group: 'inline'},
  },
})

/** A block with text, or a card when the content is `{card: name}`. */
type BlockDef = {id: string; text?: string; card?: string; children?: BlockDef[]; listType?: string}

function blockNode(def: BlockDef): PMNode {
  const content = def.card
    ? schema.nodes['image']!.create({name: def.card})
    : schema.nodes['paragraph']!.create(null, def.text ? schema.text(def.text) : null)
  const nested = def.children ? [blockChildren(def.children, def.listType)] : []
  return schema.nodes['blockNode']!.create({id: def.id}, [content, ...nested])
}

function blockChildren(defs: BlockDef[], listType = 'Group'): PMNode {
  return schema.nodes['blockChildren']!.create({listType}, defs.map(blockNode))
}

/** intro, then a parent with a bullet list of the cards a, b and c, then outro. */
function initialState(): EditorState {
  const doc = schema.nodes['doc']!.create(null, [
    blockChildren([
      {id: 'intro', text: 'intro'},
      {
        id: 'parent',
        text: 'parent',
        listType: 'Unordered',
        children: [
          {id: 'a', card: 'a'},
          {id: 'b', card: 'b'},
          {id: 'c', card: 'c'},
        ],
      },
      {id: 'outro', text: 'outro'},
    ]),
  ])
  return EditorState.create({doc, plugins: [history()]})
}

/** Position just before the block's content, where a reading-order range starts on it. */
function contentStart(doc: PMNode, id: string): number {
  let pos = -1
  doc.descendants((node, nodePos) => {
    if (node.type.name === 'blockNode' && node.attrs.id === id) pos = nodePos + 1
    return pos < 0
  })
  return pos
}

/** Position just after the block's own content, where a reading-order range ends on it. */
function contentEnd(doc: PMNode, id: string): number {
  const start = contentStart(doc, id)
  return start + doc.resolve(start).nodeAfter!.nodeSize
}

/** The cards inside the selection, in document order. */
function selectedCards(selection: Selection): string[] {
  const cards: string[] = []
  selection.$from.doc.nodesBetween(selection.from, selection.to, (node, pos) => {
    if (node.type.name === 'image' && pos >= selection.from && pos + node.nodeSize <= selection.to) {
      cards.push(node.attrs.name)
    }
  })
  return cards
}

/** Selects the cards a and b, as a shift-click from a to b does. */
function withCardsSelected(state: EditorState): EditorState {
  const range = BlockRangeSelection.create(state.doc, contentStart(state.doc, 'a'), contentEnd(state.doc, 'b'))
  return state.apply(state.tr.setSelection(range))
}

function apply(state: EditorState, edit: (tr: Transaction) => void): EditorState {
  const tr = state.tr
  edit(tr)
  return state.apply(tr)
}

describe('BlockRangeSelection', () => {
  it('keeps its cards selected through an edit elsewhere in the document', () => {
    const state = apply(withCardsSelected(initialState()), (tr) => tr.insertText('new ', 1 + 2 + 1))

    expect(state.selection).toBeInstanceOf(BlockRangeSelection)
    expect(selectedCards(state.selection)).toEqual(['a', 'b'])
  })

  it('keeps its cards selected when their list turns into a grid', () => {
    const selected = withCardsSelected(initialState())
    const listPos = selected.doc.resolve(contentStart(selected.doc, 'a')).before(3)
    const state = apply(selected, (tr) => tr.setNodeMarkup(listPos, null, {listType: 'Grid'}))

    expect(state.doc.resolve(contentStart(state.doc, 'a')).node(3).attrs.listType).toBe('Grid')
    expect(selectedCards(state.selection)).toEqual(['a', 'b'])
  })

  it('keeps a card at either end selected when the card itself changes', () => {
    const selected = withCardsSelected(initialState())
    const state = apply(selected, (tr) => {
      tr.setNodeMarkup(contentStart(tr.doc, 'a'), null, {name: 'a2'})
      tr.setNodeMarkup(contentStart(tr.doc, 'b'), null, {name: 'b2'})
    })

    expect(selectedCards(state.selection)).toEqual(['a2', 'b2'])
  })

  it('comes back as the same range with undo', () => {
    const selected = withCardsSelected(initialState())
    const edited = apply(selected, (tr) => tr.delete(contentStart(tr.doc, 'a') - 1, contentEnd(tr.doc, 'b') + 1))
    // With its cards gone, the selection moves to what follows them.
    expect(selectedCards(edited.selection)).toEqual(['c'])

    let restored = edited
    undo(edited, (tr) => (restored = edited.apply(tr)))

    expect(restored.selection).toBeInstanceOf(BlockRangeSelection)
    expect(selectedCards(restored.selection)).toEqual(['a', 'b'])
  })
})
