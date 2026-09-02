import {describe, expect, it} from 'vitest'
import {HMListedDraftReadSchema} from './hm-types'

describe('HMListedDraftReadSchema', () => {
  it('preserves the collection type from legacy draft indexes', () => {
    const draft = HMListedDraftReadSchema.parse({
      id: 'draft-id',
      editUid: 'account-id',
      metadata: {},
      visibility: 'PUBLIC',
      deps: [],
      lastUpdateTime: 1,
      isFolder: true,
    })

    expect(draft.isCollection).toBe(true)
    expect(draft).not.toHaveProperty('isFolder')
  })
})
