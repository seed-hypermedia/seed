import {describe, expect, it} from 'vitest'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {
  createRepublishRefOperation,
  getDocumentCardReconciliationInputsForMove,
  getDocumentCardReconciliationInputForRepublish,
  getMovedChildPath,
  isChildDocumentPath,
} from '../document-relocation'

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

describe('document card reconciliation inputs', () => {
  it('plans remove and add jobs for a move across parents', () => {
    const from = hmId('site', {path: ['old-parent', 'child']})
    const to = hmId('site', {path: ['new-parent', 'child']})

    expect(getDocumentCardReconciliationInputsForMove({from, to, signingAccountUid: 'site'})).toEqual([
      {
        operation: 'remove',
        parentDocumentId: 'hm://site/old-parent',
        sourceDocumentId: from.id,
        signingAccountUid: 'site',
      },
      {
        operation: 'add',
        parentDocumentId: 'hm://site/new-parent',
        targetDocumentId: to.id,
        signingAccountUid: 'site',
      },
    ])
  })

  it('plans a rewrite job for a same-parent move', () => {
    const from = hmId('site', {path: ['parent', 'old']})
    const to = hmId('site', {path: ['parent', 'new']})

    expect(getDocumentCardReconciliationInputsForMove({from, to, signingAccountUid: 'site'})).toEqual([
      {
        operation: 'rewrite',
        parentDocumentId: 'hm://site/parent',
        sourceDocumentId: from.id,
        targetDocumentId: to.id,
        signingAccountUid: 'site',
      },
    ])
  })

  it('plans an add job for a republish destination parent', () => {
    const to = hmId('site', {path: ['library', 'copy']})

    expect(getDocumentCardReconciliationInputForRepublish({to, signingAccountUid: 'site'})).toEqual({
      operation: 'add',
      parentDocumentId: 'hm://site/library',
      targetDocumentId: to.id,
      signingAccountUid: 'site',
    })
  })
})
