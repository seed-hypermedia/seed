import {describe, expect, test} from 'vitest'
import {Block, DocumentChange} from '../.generated/documents/v3alpha/documents_pb'

/**
 * Regression tests for issue #322: Subdocuments published as embeds instead of cards.
 *
 * The Block.attributes field is a google.protobuf.Struct. When creating a Block
 * from a plain JS object, Block.fromJson() must be used to properly convert
 * the attributes into a Struct. Using new Block({attributes: {view: 'Card'}})
 * via initPartial silently drops the attributes because the plain object
 * doesn't match the Struct's internal {fields: {...}} structure.
 */
describe('Block Struct attributes round-trip', () => {
  test('Block.fromJson preserves embed view attribute in Struct', () => {
    const embedBlock = {
      id: 'test-id',
      type: 'Embed',
      link: 'hm://test-uid/parent/child',
      attributes: {view: 'Card'},
    }
    const block = Block.fromJson(embedBlock)
    const json = block.toJson({emitDefaultValues: true}) as Record<string, any>
    expect(json.attributes.view).toBe('Card')
  })

  test('DocumentChange with Block.fromJson preserves attributes through binary round-trip', () => {
    const embedBlock = {
      id: 'test-id',
      type: 'Embed',
      link: 'hm://test-uid/parent/child',
      attributes: {view: 'Card'},
    }
    const change = new DocumentChange({
      op: {case: 'replaceBlock' as const, value: Block.fromJson(embedBlock)},
    })

    // Serialize to binary and back (simulates gRPC transport)
    const bytes = change.toBinary()
    const restored = DocumentChange.fromBinary(bytes)

    expect(restored.op.case).toBe('replaceBlock')
    if (restored.op.case === 'replaceBlock') {
      const restoredJson = restored.op.value.toJson({emitDefaultValues: true}) as Record<string, any>
      expect(restoredJson.attributes.view).toBe('Card')
    }
  })

  test('plain object without Block.fromJson loses Struct attributes (documents the bug)', () => {
    // This test documents the broken behavior that caused issue #322.
    // If this test ever starts passing (attributes preserved), the underlying
    // protobuf library changed behavior and the Block.fromJson guard is no longer needed.
    const embedBlock = {
      id: 'test-id',
      type: 'Embed',
      link: 'hm://test-uid/parent/child',
      attributes: {view: 'Card'},
    }
    const change = new DocumentChange({
      op: {case: 'replaceBlock' as const, value: embedBlock},
    } as any)

    const bytes = change.toBinary()
    const restored = DocumentChange.fromBinary(bytes)

    if (restored.op.case === 'replaceBlock') {
      const json = restored.op.value.toJson({emitDefaultValues: true}) as Record<string, any>
      // Without Block.fromJson, the Struct attributes are lost in binary round-trip
      expect(json.attributes?.view).toBeUndefined()
    }
  })

  test('Block.fromJson preserves multiple attributes', () => {
    const embedBlock = {
      id: 'test-id',
      type: 'Embed',
      link: 'hm://test-uid/parent/child',
      attributes: {view: 'Card', childrenType: 'Unordered'},
    }
    const block = Block.fromJson(embedBlock)
    const json = block.toJson({emitDefaultValues: true}) as Record<string, any>
    expect(json.attributes.view).toBe('Card')
    expect(json.attributes.childrenType).toBe('Unordered')
  })
})
