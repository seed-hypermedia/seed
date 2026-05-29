import {Schema} from 'prosemirror-model'
import {EditorState, TextSelection} from 'prosemirror-state'
import {describe, expect, test} from 'vitest'
import {prosemirrorPosToBlockTextOffset} from '../RangeSelection/RangeSelectionPlugin'
import {blockHighlightPluginKey, codepointOffsetToPos, createBlockHighlightPlugin} from './BlockHighlightPlugin'

const schema = new Schema({
  nodes: {
    doc: {content: 'blockContent'},
    blockContent: {content: 'inline*', group: 'block'},
    text: {group: 'inline'},
    inlineEmbed: {
      group: 'inline',
      inline: true,
      atom: true,
      attrs: {link: {default: ''}},
      toDOM: (node) => ['span', {'data-inline-embed': node.attrs.link}, 0],
    },
  },
})

const blockSchema = new Schema({
  nodes: {
    doc: {content: 'blockNode'},
    blockNode: {
      content: 'blockContent',
      attrs: {id: {default: ''}},
      toDOM: (node) => ['div', {'data-id': node.attrs.id}, 0],
    },
    blockContent: {content: 'inline*', group: 'block'},
    text: {group: 'inline'},
  },
})

describe('codepointOffsetToPos', () => {
  test('maps inline embed atom boundaries as one codepoint', () => {
    const content = schema.nodes.blockContent.create(null, [
      schema.text('Hi '),
      schema.nodes.inlineEmbed.create({link: 'hm://doc'}),
      schema.text('there'),
    ])
    const contentBeforePos = 10
    const contentStart = contentBeforePos + 1

    expect(codepointOffsetToPos(content, contentBeforePos, 0)).toBe(contentStart)
    expect(codepointOffsetToPos(content, contentBeforePos, 3)).toBe(contentStart + 3)
    expect(codepointOffsetToPos(content, contentBeforePos, 4)).toBe(contentStart + 4)
    expect(codepointOffsetToPos(content, contentBeforePos, 5)).toBe(contentStart + 5)
  })

  test('maps unicode text offsets by codepoint, not UTF-16 unit', () => {
    const content = schema.nodes.blockContent.create(null, [schema.text('A😊B')])
    const contentBeforePos = 20
    const contentStart = contentBeforePos + 1

    expect(codepointOffsetToPos(content, contentBeforePos, 1)).toBe(contentStart + 1)
    expect(codepointOffsetToPos(content, contentBeforePos, 2)).toBe(contentStart + 3)
    expect(codepointOffsetToPos(content, contentBeforePos, 3)).toBe(contentStart + 4)
  })
})

describe('prosemirrorPosToBlockTextOffset', () => {
  test('maps split text and inline embed atoms the same way as fragment highlighting', () => {
    const content = schema.nodes.blockContent.create(null, [
      schema.text('Hi '),
      schema.nodes.inlineEmbed.create({link: 'hm://doc'}),
      schema.text('there'),
    ])
    const doc = schema.nodes.doc.create(null, content)
    const contentBeforePos = 0
    const contentStart = contentBeforePos + 1

    expect(prosemirrorPosToBlockTextOffset(doc, contentStart, contentBeforePos)).toBe(0)
    expect(prosemirrorPosToBlockTextOffset(doc, contentStart + 3, contentBeforePos)).toBe(3)
    expect(prosemirrorPosToBlockTextOffset(doc, contentStart + 4, contentBeforePos)).toBe(4)
    expect(prosemirrorPosToBlockTextOffset(doc, contentStart + 5, contentBeforePos)).toBe(5)
  })
})

describe('createBlockHighlightPlugin', () => {
  test('clears fragment highlight when the user selects other text', () => {
    const doc = blockSchema.nodes.doc.create(
      null,
      blockSchema.nodes.blockNode.create(
        {id: 'block-1'},
        blockSchema.nodes.blockContent.create(null, [blockSchema.text('hello world')]),
      ),
    )
    let state = EditorState.create({doc, plugins: [createBlockHighlightPlugin()]})

    state = state.apply(
      state.tr.setMeta(blockHighlightPluginKey, {
        type: 'rangeFocus',
        blockId: 'block-1',
        start: 0,
        end: 5,
      }),
    )
    expect(blockHighlightPluginKey.getState(state)?.find()).toHaveLength(1)

    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 3, 8)))
    expect(blockHighlightPluginKey.getState(state)?.find()).toHaveLength(0)
  })
})
