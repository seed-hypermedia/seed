import {Schema} from 'prosemirror-model'
import {EditorState, Plugin} from 'prosemirror-state'
import {redo, undo, history} from '@tiptap/pm/history'
import {describe, expect, it} from 'vitest'
import {createBlockRevisionInvalidationPlugin, getReferenceableRevision} from './BlockRevisionInvalidation'

const schema = new Schema({
  nodes: {
    doc: {content: 'blockNode+'},
    blockNode: {content: 'block blockChildren?', attrs: {id: {default: ''}}},
    blockChildren: {content: 'blockNode+', attrs: {listType: {default: 'Group'}}},
    paragraph: {
      group: 'block',
      content: 'inline*',
      attrs: {
        revision: {default: ''},
        textAlignment: {default: 'left'},
        textColor: {default: 'default'},
      },
    },
    heading: {group: 'block', content: 'inline*', attrs: {revision: {default: ''}, level: {default: '2'}}},
    image: {group: 'block', attrs: {revision: {default: ''}, url: {default: ''}}},
    table: {group: 'block', content: 'tableRow+'},
    tableRow: {content: 'tableCell+', attrs: {id: {default: ''}}},
    tableCell: {content: 'paragraph+', attrs: {id: {default: ''}}},
    inlineEmbed: {group: 'inline', inline: true, atom: true, attrs: {link: {default: ''}}},
    text: {group: 'inline'},
  },
  marks: {
    bold: {},
    link: {attrs: {href: {default: ''}}},
    textColor: {attrs: {value: {default: 'default'}}},
  },
})

function paragraphBlock(id: string, text: string, revision = 'rev-1') {
  return schema.nodes.blockNode.create(
    {id},
    schema.nodes.paragraph.create({revision}, text ? schema.text(text) : undefined),
  )
}

function imageBlock(id: string, url: string, revision = 'rev-1') {
  return schema.nodes.blockNode.create({id}, schema.nodes.image.create({revision, url}))
}

function copiedTableBlock() {
  const cell = (id: string, text: string) =>
    schema.nodes.tableCell.create({id}, schema.nodes.paragraph.create({revision: 'stale-cell-rev'}, schema.text(text)))
  return schema.nodes.blockNode.create(
    {id: 'table-block'},
    schema.nodes.table.create(
      null,
      schema.nodes.tableRow.create({id: 'row-1'}, [cell('cell-1', 'one'), cell('cell-2', 'two')]),
    ),
  )
}

function createState(doc = schema.nodes.doc.create(null, paragraphBlock('block-1', 'hello'))) {
  return EditorState.create({
    doc,
    plugins: [history(), createBlockRevisionInvalidationPlugin({} as any)] as Plugin[],
  })
}

function apply(state: EditorState, tr = state.tr) {
  return state.applyTransaction(tr).state
}

function revisionFor(state: EditorState, id = 'block-1') {
  let revision = ''
  state.doc.descendants((node) => {
    if (node.type.name === 'blockNode' && node.attrs.id === id) {
      revision = String(node.firstChild?.attrs.revision ?? '')
      return false
    }
    return true
  })
  return revision
}

function cellRevisionFor(state: EditorState, id: string) {
  let revision = ''
  state.doc.descendants((node) => {
    if (node.type.name === 'tableCell' && node.attrs.id === id) {
      revision = String(node.firstChild?.attrs.revision ?? '')
      return false
    }
    return true
  })
  return revision
}

function posOfNode(state: EditorState, typeName: string) {
  let result = 0
  state.doc.descendants((node, pos) => {
    if (node.type.name === typeName) {
      result = pos
      return false
    }
    return true
  })
  return result
}

describe('BlockRevisionInvalidation', () => {
  it('reads the revision from a block content node', () => {
    expect(getReferenceableRevision(paragraphBlock('block-1', 'hello'))).toBe('rev-1')
  })

  it('clears revision when text content changes', () => {
    const state = createState()

    const next = apply(state, state.tr.insertText('!', 7))

    expect(next.doc.textContent).toBe('hello!')
    expect(revisionFor(next)).toBe('')
  })

  it('keeps revision when only formatting marks change', () => {
    const state = createState()

    const next = apply(state, state.tr.addMark(2, 7, schema.marks.bold.create()))

    expect(revisionFor(next)).toBe('rev-1')
  })

  it('clears revision when an inline link is added', () => {
    const state = createState()

    const next = apply(state, state.tr.addMark(2, 7, schema.marks.link.create({href: 'hm://doc'})))

    expect(revisionFor(next)).toBe('')
  })

  it('clears revision when semantic block content attrs change', () => {
    const state = createState(schema.nodes.doc.create(null, imageBlock('image-1', 'ipfs://old')))

    const next = apply(state, state.tr.setNodeAttribute(posOfNode(state, 'image'), 'url', 'ipfs://new'))

    expect(revisionFor(next, 'image-1')).toBe('')
  })

  it('restores revision when undoing the first semantic edit and clears it again on redo', () => {
    let state = createState()

    state = apply(state, state.tr.insertText('!', 7))
    expect(revisionFor(state)).toBe('')

    undo(state, (tr) => {
      state = apply(state, tr)
    })
    expect(state.doc.textContent).toBe('hello')
    expect(revisionFor(state)).toBe('rev-1')

    redo(state, (tr) => {
      state = apply(state, tr)
    })
    expect(state.doc.textContent).toBe('hello!')
    expect(revisionFor(state)).toBe('')
  })

  it('clears stale revisions from inserted blocks', () => {
    const state = createState()
    const inserted = paragraphBlock('copied-block', 'copied', 'stale-rev')

    const next = apply(state, state.tr.insert(state.doc.content.size, inserted))

    expect(revisionFor(next, 'copied-block')).toBe('')
  })

  it('clears stale revisions from inserted table cells', () => {
    const state = createState()

    const next = apply(state, state.tr.insert(state.doc.content.size, copiedTableBlock()))

    expect(cellRevisionFor(next, 'cell-1')).toBe('')
    expect(cellRevisionFor(next, 'cell-2')).toBe('')
  })

  it('does not clear revisions while editor changes are suppressed', () => {
    const suppressChangeRef = {current: true}
    const state = EditorState.create({
      doc: schema.nodes.doc.create(null, paragraphBlock('block-1', 'hello')),
      plugins: [createBlockRevisionInvalidationPlugin({_suppressChangeRef: suppressChangeRef} as any)],
    })

    const next = apply(state, state.tr.insertText('!', 7))

    expect(next.doc.textContent).toBe('hello!')
    expect(revisionFor(next)).toBe('rev-1')
  })
})
