// @vitest-environment jsdom
import {describe, expect, it} from 'vitest'
// BlockNoteEditor must load before the HM schema, which depends on it through a cycle.
import {BlockNoteEditor} from '../BlockNoteEditor'
import type {PartialBlock} from '../extensions/Blocks/api/blockTypes'
import {hmBlockSchema} from '../../../schema'

function createEditor(initialContent: PartialBlock<any>[]) {
  return new BlockNoteEditor({initialContent, blockSchema: hmBlockSchema})
}

const paragraph = (id: string, text = `text ${id}`): PartialBlock<any> => ({
  id,
  type: 'paragraph',
  content: text,
})

const draftCard = (id: string, draftId: string): PartialBlock<any> => ({
  id,
  type: 'embed',
  props: {url: '', view: 'Card', draftId},
})

const topLevelIds = (editor: BlockNoteEditor<any>) => editor.topLevelBlocks.map((b) => b.id)

const getBlock = (editor: BlockNoteEditor<any>, id: string) => editor.topLevelBlocks.find((b) => b.id === id)

describe('replaceBlocks', () => {
  it('applies incoming props when a replacement block reuses an existing id', () => {
    const editor = createEditor([paragraph('p1'), draftCard('card', 'child-draft'), paragraph('p2')])

    editor.replaceBlocks(editor.topLevelBlocks, [
      paragraph('p1'),
      {id: 'card', type: 'embed', props: {url: 'hm://uid/child', view: 'Card'}},
      paragraph('p2'),
    ])

    const card = getBlock(editor, 'card')
    expect(card?.props.url).toBe('hm://uid/child')
    expect(card?.props.draftId).toBe('')
    expect(topLevelIds(editor).slice(0, 3)).toEqual(['p1', 'card', 'p2'])
  })

  it('places a block that only exists in the replacement where the replacement puts it', () => {
    const editor = createEditor([paragraph('p1'), draftCard('card', 'child-draft'), paragraph('p2')])

    editor.replaceBlocks(editor.topLevelBlocks, [
      paragraph('p1'),
      draftCard('card', 'child-draft'),
      paragraph('p2'),
      {id: 'card2', type: 'embed', props: {url: 'hm://uid/child2', view: 'Card'}},
    ])

    const ids = topLevelIds(editor)
    expect(ids.indexOf('p1')).toBe(0)
    expect(ids.indexOf('card2')).toBe(ids.indexOf('p2') + 1)
  })

  it('keeps the documented contract for non-adjacent removals', () => {
    const editor = createEditor([paragraph('a'), paragraph('b'), paragraph('c')])

    editor.replaceBlocks(['a', 'c'], [paragraph('x', 'inserted')])

    const ids = topLevelIds(editor)
    expect(ids.slice(0, 2)).toEqual(['x', 'b'])
    expect(ids).not.toContain('a')
    expect(ids).not.toContain('c')
  })
})
