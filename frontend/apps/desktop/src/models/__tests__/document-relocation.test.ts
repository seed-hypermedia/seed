import {describe, expect, it} from 'vitest'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {
  createRepublishRefOperation,
  getDocumentCardReconciliationInputsForMove,
  getDocumentCardReconciliationInputForRepublish,
  getDocumentMoveRefOperations,
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

    const before = Date.now()
    const operation = createRepublishRefOperation({
      sourceId,
      destinationId,
      sourceDocument: {
        version: 'bafy-version',
        generationInfo: {genesis: 'bafy-genesis', generation: 7},
      } as any,
      capabilityId: 'bafy-capability',
    })
    expect(operation).toEqual({
      space: 'target-site',
      path: '/library/api-copy',
      genesis: 'bafy-genesis',
      generation: operation.generation,
      targetSpace: 'source-site',
      targetPath: '/specs/api',
      republish: true,
      capability: 'bafy-capability',
    })
    // A fresh generation — not the source document's — so the redirect occupies its own
    // generation row and any later publish at the destination supersedes it.
    expect(operation.generation).toBeGreaterThanOrEqual(before)
  })
})

describe('getDocumentMoveRefOperations (what a move publishes)', () => {
  const plainDoc = {version: 'doc-version', generationInfo: {genesis: 'doc-genesis', generation: 3}} as any

  it('forks a plain document to the destination and redirects the source there', () => {
    const before = Date.now()
    const ops = getDocumentMoveRefOperations({
      sourceId: hmId('site', {path: ['old']}),
      targetId: hmId('site', {path: ['new']}),
      doc: plainDoc,
      sourceRedirect: null,
      originalId: hmId('site', {path: ['old']}),
      targetCapabilityId: 'cap',
      sourceCapabilityId: 'cap',
    })

    // Destination gets the document's own history (a version ref), not a redirect.
    expect(ops.destination).toEqual({
      kind: 'version',
      space: 'site',
      path: '/new',
      genesis: 'doc-genesis',
      version: 'doc-version',
      generation: ops.destination.generation,
      capability: 'cap',
    })
    // Source redirects to the destination (a plain move redirect — no republish flag).
    expect(ops.sourceRedirect).toEqual({
      space: 'site',
      path: '/old',
      genesis: 'doc-genesis',
      generation: ops.sourceRedirect.generation,
      targetSpace: 'site',
      targetPath: '/new',
      capability: 'cap',
    })
    // Fresh generations so both refs supersede anything already at their paths.
    expect(ops.destination.generation).toBeGreaterThanOrEqual(before)
    expect(ops.sourceRedirect.generation).toBeGreaterThanOrEqual(before)
  })

  it('moves a republish as a republish: the destination re-publishes the ORIGINAL, not a fork', () => {
    // The source at hm://site/mirror republishes hm://other/resources/guide; following it reaches
    // that original document. Moving the mirror must keep it a mirror of the original.
    const ops = getDocumentMoveRefOperations({
      sourceId: hmId('site', {path: ['mirror']}),
      targetId: hmId('site', {path: ['moved-mirror']}),
      // `doc` is the followed ORIGINAL (its genesis/version), living at `originalId`.
      doc: {version: 'guide-version', generationInfo: {genesis: 'guide-genesis', generation: 9}} as any,
      sourceRedirect: {republish: true, target: hmId('other', {path: ['resources', 'guide']})},
      originalId: hmId('other', {path: ['resources', 'guide']}),
    })

    // Destination is a republish redirect pointing at the original — NOT a version/fork.
    expect(ops.destination.kind).toBe('republish')
    expect(ops.destination).toMatchObject({
      space: 'site',
      path: '/moved-mirror',
      genesis: 'guide-genesis',
      targetSpace: 'other',
      targetPath: '/resources/guide',
      republish: true,
    })
    // Source redirects to the destination (a plain move redirect, no republish).
    expect(ops.sourceRedirect).toMatchObject({
      space: 'site',
      path: '/mirror',
      targetSpace: 'site',
      targetPath: '/moved-mirror',
    })
    expect(ops.sourceRedirect).not.toHaveProperty('republish')
  })

  it('refuses to move a path that has itself already moved (a pointer, not content)', () => {
    expect(() =>
      getDocumentMoveRefOperations({
        sourceId: hmId('site', {path: ['old']}),
        targetId: hmId('site', {path: ['newer']}),
        doc: plainDoc,
        sourceRedirect: {republish: false, target: hmId('site', {path: ['new']})},
        originalId: hmId('site', {path: ['new']}),
      }),
    ).toThrow('already moved')
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
