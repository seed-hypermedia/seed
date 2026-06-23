import {describe, expect, it} from 'vitest'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {createRepublishRefOperation, getMovedChildPath, isChildDocumentPath} from '../document-relocation'

describe('document relocation path helpers', () => {
  it('detects descendants and preserves relative child paths when moving a subtree', () => {
    expect(isChildDocumentPath(['specs', 'api'], ['specs'])).toBe(true)
    expect(isChildDocumentPath(['specs'], ['specs'])).toBe(false)
    expect(isChildDocumentPath(['design', 'api'], ['specs'])).toBe(false)

    expect(getMovedChildPath(['specs', 'api', 'auth'], ['specs'], ['docs', 'specs'])).toEqual([
      'docs',
      'specs',
      'api',
      'auth',
    ])
  })
})

describe('republish ref operation', () => {
  it('creates a republish redirect at the destination that points to the source document', () => {
    const sourceId = hmId('source-site', {path: ['specs', 'api']})
    const destinationId = hmId('target-site', {path: ['library', 'api-copy']})

    expect(
      createRepublishRefOperation({
        sourceId,
        destinationId,
        sourceDocument: {
          version: 'bafy-version',
          generationInfo: {genesis: 'bafy-genesis', generation: 7},
        } as any,
        capabilityId: 'bafy-capability',
      }),
    ).toEqual({
      space: 'target-site',
      path: '/library/api-copy',
      genesis: 'bafy-genesis',
      generation: 7,
      targetSpace: 'source-site',
      targetPath: '/specs/api',
      republish: true,
      capability: 'bafy-capability',
    })
  })
})
