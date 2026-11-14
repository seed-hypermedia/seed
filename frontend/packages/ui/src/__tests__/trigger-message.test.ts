import {describe, expect, it, vi} from 'vitest'

vi.mock('@shm/shared', () => ({useUniversalClient: () => ({})}))
import {messageMarkdown} from '../apps/trigger-view'

describe('a trigger message', () => {
  it('reads as plain markdown, without front matter or block ids', () => {
    const text = messageMarkdown([
      {block: {id: 'h1', type: 'Heading', text: 'Shopping list', attributes: {}, annotations: []}, children: []},
      {
        block: {
          id: 'p1',
          type: 'Paragraph',
          text: 'Read the recipes tagged this-week.',
          attributes: {},
          annotations: [],
        },
        children: [],
      },
    ] as never)
    expect(text).not.toContain('---')
    expect(text).not.toContain('<!--')
    expect(text).toContain('Read the recipes tagged this-week.')
  })
})
