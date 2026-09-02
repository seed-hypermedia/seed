import {describe, expect, it} from 'vitest'
import {blocksToMarkdown} from './blocks-to-markdown'

// A root-level Slot wrapping a list of paragraph items.
function slotDoc(childrenType: string, items: string[]) {
  return {
    metadata: {},
    content: [
      {
        block: {type: 'Slot', id: 'slot1', attributes: {childrenType}, text: '', annotations: []},
        children: items.map((text, i) => ({
          block: {type: 'Paragraph', id: `item${i}`, text, annotations: []},
          children: [],
        })),
      },
    ],
  } as any
}

describe('blocksToMarkdown Slot export', () => {
  it('emits a root Unordered Slot as markdown bullet items', () => {
    const md = blocksToMarkdown(slotDoc('Unordered', ['one', 'two']))
    expect(md).toContain('- one')
    expect(md).toContain('- two')
    // The invisible Slot is a comment-only line carrying its type.
    expect(md).toContain('<!-- id:slot1 type:Slot -->\n- one')
  })

  it('emits a root Ordered Slot as markdown numbered items', () => {
    const md = blocksToMarkdown(slotDoc('Ordered', ['a', 'b']))
    expect(md).toContain('1. a')
    expect(md).toContain('2. b')
  })

  it('emits a root Blockquote Slot as markdown blockquote items', () => {
    const md = blocksToMarkdown(slotDoc('Blockquote', ['quoted']))
    expect(md).toContain('> quoted')
  })
})
