import {describe, expect, it} from 'vitest'
import {collectChildDraftIds} from './child-draft-refs'

describe('collectChildDraftIds', () => {
  it('collects unique draft ids from nested editor embed blocks', () => {
    expect(
      collectChildDraftIds([
        {type: 'paragraph', id: 'p1', props: {}, children: [{type: 'embed', props: {draftId: 'draft-a'}}]},
        {type: 'embed', id: 'e1', props: {draftId: 'draft-b'}},
        {type: 'embed', id: 'e2', props: {draftId: 'draft-a'}},
        {type: 'embed', id: 'e3', props: {draftId: ''}},
      ]),
    ).toEqual(['draft-a', 'draft-b'])
  })

  it('collects draft ids from HM block attributes if present', () => {
    expect(
      collectChildDraftIds([
        {block: {type: 'Embed', attributes: {draftId: 'draft-hm'}, link: 'hm://x'}, children: []},
        {block: {type: 'Paragraph', attributes: {draftId: 'ignored'}}},
      ]),
    ).toEqual(['draft-hm'])
  })
})
