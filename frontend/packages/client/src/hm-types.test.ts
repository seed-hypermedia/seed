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

describe('HMPrepareDocumentChangeInputSchema protobuf instances', () => {
  it('serializes message instances to JSON instead of passing their in-memory shape through', () => {
    // A protobuf-es Struct instance looks like {fields: {x: {kind: {case, value}}}}
    // in memory; the CBOR request body is built by walking own properties, so
    // without this conversion the daemon would store that shape verbatim.
    const struct = {
      fields: {query: {kind: {case: 'structValue', value: {fields: {}}}}},
      toJson: () => ({query: {includes: [{space: 'uid', path: 'projects', mode: 'Children'}]}, style: 'List'}),
    }
    const block = {
      id: 'q1',
      type: 'Query',
      attributes: struct,
      annotations: [],
      toJson: (options?: {emitDefaultValues?: boolean}) => ({
        id: 'q1',
        type: 'Query',
        text: options?.emitDefaultValues ? '' : undefined,
        attributes: struct.toJson(),
        annotations: [],
      }),
    }
    const parsed = HMPrepareDocumentChangeInputSchema.parse({
      account: 'account',
      changes: [{op: {case: 'replaceBlock', value: block}}],
    })
    expect(parsed.changes[0]!.op).toEqual({
      case: 'replaceBlock',
      value: {
        id: 'q1',
        type: 'Query',
        text: '',
        attributes: {query: {includes: [{space: 'uid', path: 'projects', mode: 'Children'}]}, style: 'List'},
        annotations: [],
      },
    })
  })

  it('still converts a bare Struct instance in a plain block object', () => {
    const parsed = HMPrepareDocumentChangeInputSchema.parse({
      account: 'account',
      changes: [
        {
          op: {
            case: 'replaceBlock',
            value: {
              id: 'h1',
              type: 'Heading',
              attributes: {fields: {}, toJson: () => ({childrenType: 'Group'})},
            },
          },
        },
      ],
    })
    expect(parsed.changes[0]!.op.case === 'replaceBlock' && parsed.changes[0]!.op.value.attributes).toEqual({
      childrenType: 'Group',
    })
  })
})
