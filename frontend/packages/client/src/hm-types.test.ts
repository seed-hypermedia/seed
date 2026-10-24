import {describe, expect, it} from 'vitest'
import {
  HMBlockFileSchema,
  HMListedDraftReadSchema,
  HMPrepareDocumentChangeInputSchema,
  isKnownBlockType,
} from './hm-types'

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

describe('schema parsing compatibility', () => {
  it('parses default file attributes through the size transform', () => {
    const file = {id: 'file', type: 'File', link: 'ipfs://file'}
    expect(HMBlockFileSchema.parse(file).attributes).toEqual({size: null})
    expect(HMBlockFileSchema.parse({...file, attributes: {}}).attributes).toEqual({size: null})
    expect(HMBlockFileSchema.parse({...file, attributes: {size: 42}}).attributes.size).toBe(42)
  })

  it('strips runtime fields from protobuf empty values', () => {
    const parsed = HMPrepareDocumentChangeInputSchema.parse({
      account: 'account',
      changes: [
        {
          op: {
            case: 'setAttribute',
            value: {
              blockId: 'block',
              key: ['removed'],
              value: {case: 'nullValue', value: {runtimeField: true}},
            },
          },
        },
      ],
    })
    expect(parsed.changes[0]).toEqual({
      op: {
        case: 'setAttribute',
        value: {
          blockId: 'block',
          key: ['removed'],
          value: {case: 'nullValue', value: {}},
        },
      },
    })
  })

  it('recognizes built-in blocks without treating custom block names as known', () => {
    expect(isKnownBlockType('Paragraph')).toBe(true)
    expect(isKnownBlockType('File')).toBe(true)
    expect(isKnownBlockType('CustomWidget')).toBe(false)
  })
})
