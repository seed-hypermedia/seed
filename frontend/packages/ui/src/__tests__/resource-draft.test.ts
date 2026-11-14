import {describe, expect, it, vi} from 'vitest'

vi.mock('@shm/shared', () => ({useUniversalClient: () => ({})}))
import {draftBody} from '../apps/resource-draft'

describe('a resource draft body', () => {
  it('reads a saved draft (editor blocks) as Hypermedia blocks', () => {
    const body = draftBody(
      [{id: 'p1', type: 'paragraph', content: [{type: 'text', text: 'Hello', styles: {}}], props: {}, children: []}],
      [],
    )
    expect(body[0]?.block).toMatchObject({id: 'p1', type: 'Paragraph', text: 'Hello'})
  })
  it('keeps Hypermedia blocks, and falls back to the published body', () => {
    const node = {block: {id: 'p1', type: 'Paragraph', text: 'Hi'}, children: []}
    expect(draftBody([node], [])).toEqual([node])
    expect(draftBody(null, [node as never])).toEqual([node])
  })
})
