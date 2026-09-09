import 'fake-indexeddb/auto'
import {indexedDB} from 'fake-indexeddb'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'

import {
  _resetWebDocDraftDBForTesting,
  cleanupOldWebDocDrafts,
  compareAndSwapWebDocDraft,
  deleteWebDocDraft,
  getLatestWebDocDraftForDoc,
  getWebDocDraft,
  listWebDocDraftSnapshots,
  listWebDocDraftsForAccount,
  listWebDocDraftsForDoc,
  putWebDocDraft,
  restoreWebDocDraftSnapshot,
  type WebDocDraft,
} from './web-draft-db'

const DB_NAME = 'web-doc-drafts-01'

function dropDB(): Promise<void> {
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME)
    req.onsuccess = () => resolve()
    req.onerror = () => resolve()
  })
}

function makeDraft(overrides: Partial<WebDocDraft> = {}): Omit<WebDocDraft, 'updatedAt'> & {updatedAt?: number} {
  const base: Omit<WebDocDraft, 'updatedAt'> & {updatedAt?: number} = {
    draftId: 'draft-1',
    docId: 'hm://abc',
    signingAccountId: 'sign-account',
    content: [],
    metadata: {},
    deps: ['head-1'],
    navigation: null,
    locationUid: null,
    locationPath: null,
    editUid: null,
    editPath: null,
    cursorPosition: null,
  }
  return {...base, ...overrides}
}

describe('web-draft-db', () => {
  beforeEach(async () => {
    _resetWebDocDraftDBForTesting()
    await dropDB()
  })

  afterEach(async () => {
    _resetWebDocDraftDBForTesting()
    await dropDB()
  })

  it('atomically replaces an unchanged draft and retains a recovery snapshot', async () => {
    await putWebDocDraft(makeDraft())
    const before = (await getWebDocDraft('draft-1'))!
    expect(await compareAndSwapWebDocDraft(before, {...before, deps: ['corrected-head']})).toBe(true)
    expect((await getWebDocDraft('draft-1'))?.deps).toEqual(['corrected-head'])
    expect((await listWebDocDraftSnapshots('draft-1'))[0]?.draft).toEqual(before)
  })

  it('does not overwrite an intervening edit even when timestamps are equal', async () => {
    await putWebDocDraft(makeDraft({updatedAt: 10}))
    const before = (await getWebDocDraft('draft-1'))!
    await putWebDocDraft({...before, metadata: {name: 'Unsaved work'}, updatedAt: 10})
    expect(await compareAndSwapWebDocDraft(before, {...before, deps: ['corrected-head']})).toBe(false)
    expect((await getWebDocDraft('draft-1'))?.metadata).toEqual({name: 'Unsaved work'})
  })

  it('does not recreate a discarded draft during reconciliation', async () => {
    await putWebDocDraft(makeDraft())
    const before = (await getWebDocDraft('draft-1'))!
    await deleteWebDocDraft('draft-1')
    expect(await compareAndSwapWebDocDraft(before, {...before, deps: ['corrected-head']})).toBe(false)
    expect(await getWebDocDraft('draft-1')).toBeNull()
  })

  it('allows only one reconciliation to replace the same saved draft', async () => {
    await putWebDocDraft(makeDraft())
    const before = (await getWebDocDraft('draft-1'))!
    const results = await Promise.all([
      compareAndSwapWebDocDraft(before, {...before, deps: ['head-a']}),
      compareAndSwapWebDocDraft(before, {...before, deps: ['head-b']}),
    ])
    expect(results.filter(Boolean)).toHaveLength(1)
  })

  it('rejects a stale autosave after maintenance without losing its recovery copy', async () => {
    await putWebDocDraft(makeDraft())
    const before = (await getWebDocDraft('draft-1'))!
    await compareAndSwapWebDocDraft(before, {...before, deps: ['corrected-head']})
    await expect(putWebDocDraft({...before, metadata: {name: 'Late edit'}})).rejects.toThrow('baseline changed')
    expect((await getWebDocDraft('draft-1'))?.deps).toEqual(['corrected-head'])
    expect((await listWebDocDraftSnapshots('draft-1')).some((s) => s.draft.metadata.name === 'Late edit')).toBe(true)
    await putWebDocDraft({...before, deps: ['user-rebased-head'], maintenanceRevision: 1})
    expect((await getWebDocDraft('draft-1'))?.deps).toEqual(['user-rebased-head'])
  })

  it('rejects stale content when maintenance changes the draft without changing its published heads', async () => {
    await putWebDocDraft(makeDraft())
    const before = (await getWebDocDraft('draft-1'))!
    await compareAndSwapWebDocDraft(before, {...before, metadata: {name: 'Corrected'}})
    await expect(putWebDocDraft({...before, metadata: {name: 'Stale editor'}})).rejects.toThrow('baseline')
    expect(await getWebDocDraft('draft-1')).toMatchObject({metadata: {name: 'Corrected'}, maintenanceRevision: 1})
    expect(
      (await listWebDocDraftSnapshots('draft-1')).some((snapshot) => snapshot.draft.metadata.name === 'Stale editor'),
    ).toBe(true)
  })

  it('round-trips a draft', async () => {
    const draft = makeDraft({draftId: 'd-rt', docId: 'hm://doc-rt'})
    await putWebDocDraft(draft)
    const loaded = await getWebDocDraft('d-rt')
    expect(loaded).not.toBeNull()
    expect(loaded?.draftId).toBe('d-rt')
    expect(loaded?.docId).toBe('hm://doc-rt')
    expect(typeof loaded?.updatedAt).toBe('number')
  })

  it('indexes Collection status from persisted content', async () => {
    await putWebDocDraft(
      makeDraft({
        draftId: 'collection',
        docId: 'hm://abc/collection',
        content: [
          {
            block: {
              id: 'query123',
              type: 'Query',
              attributes: {query: {includes: []}},
            },
            children: [],
          } as any,
        ],
      }),
    )
    await putWebDocDraft(
      makeDraft({
        draftId: 'document',
        content: [{block: {id: 'p1', type: 'Paragraph', text: 'text'}, children: []} as any],
        isCollection: true,
      }),
    )

    expect((await getWebDocDraft('collection'))?.isCollection).toBe(true)
    expect((await getWebDocDraft('document'))?.isCollection).toBe(false)
  })

  it('lists drafts filtered by docId, newest first', async () => {
    await putWebDocDraft(makeDraft({draftId: 'd-1', docId: 'hm://A', updatedAt: 1}))
    await putWebDocDraft(makeDraft({draftId: 'd-2', docId: 'hm://A', updatedAt: 2}))
    await putWebDocDraft(makeDraft({draftId: 'd-3', docId: 'hm://B', updatedAt: 3}))

    const aDrafts = await listWebDocDraftsForDoc('hm://A')
    expect(aDrafts.map((d) => d.draftId)).toEqual(['d-2', 'd-1'])

    const bDrafts = await listWebDocDraftsForDoc('hm://B')
    expect(bDrafts.map((d) => d.draftId)).toEqual(['d-3'])
  })

  it('lists drafts filtered by account uid, newest first', async () => {
    await putWebDocDraft(makeDraft({draftId: 'loc-old', locationUid: 'site', updatedAt: 1}))
    await putWebDocDraft(makeDraft({draftId: 'edit-new', editUid: 'site', updatedAt: 3}))
    await putWebDocDraft(makeDraft({draftId: 'other', locationUid: 'other', editUid: 'other', updatedAt: 4}))

    const drafts = await listWebDocDraftsForAccount('site')

    expect(drafts.map((d) => d.draftId)).toEqual(['edit-new', 'loc-old'])
  })

  it('returns latest draft for docId', async () => {
    await putWebDocDraft(makeDraft({draftId: 'old', docId: 'hm://X', updatedAt: 100}))
    await putWebDocDraft(makeDraft({draftId: 'new', docId: 'hm://X', updatedAt: 200}))
    const latest = await getLatestWebDocDraftForDoc('hm://X')
    expect(latest?.draftId).toBe('new')
  })

  it('deletes a draft idempotently', async () => {
    await putWebDocDraft(makeDraft({draftId: 'gone'}))
    await deleteWebDocDraft('gone')
    expect(await getWebDocDraft('gone')).toBeNull()
    await deleteWebDocDraft('gone') // no throw on second delete
  })

  it('keeps recoverable snapshots before overwriting a draft', async () => {
    await putWebDocDraft(
      makeDraft({draftId: 'safe', content: [{block: {id: 'b1', type: 'Paragraph', text: 'first'}} as any]}),
    )
    await putWebDocDraft(
      makeDraft({draftId: 'safe', content: [{block: {id: 'b1', type: 'Paragraph', text: 'second'}} as any]}),
    )

    const snapshots = await listWebDocDraftSnapshots('safe')
    expect(snapshots).toHaveLength(1)
    expect((snapshots[0]?.draft.content[0]?.block as any)?.text).toBe('first')
  })

  it('can restore a draft snapshot', async () => {
    await putWebDocDraft(
      makeDraft({draftId: 'restore', content: [{block: {id: 'b1', type: 'Paragraph', text: 'first'}} as any]}),
    )
    await putWebDocDraft(
      makeDraft({draftId: 'restore', content: [{block: {id: 'b1', type: 'Paragraph', text: 'second'}} as any]}),
    )
    const [snapshot] = await listWebDocDraftSnapshots('restore')

    await restoreWebDocDraftSnapshot(snapshot!.snapshotId)

    const restored = await getWebDocDraft('restore')
    expect((restored?.content[0]?.block as any)?.text).toBe('first')
  })

  it('cleanupOldWebDocDrafts prunes only old entries', async () => {
    const now = Date.now()
    const day = 24 * 60 * 60 * 1000
    await putWebDocDraft(makeDraft({draftId: 'old', updatedAt: now - 60 * day}))
    await putWebDocDraft(makeDraft({draftId: 'recent', updatedAt: now - 1 * day}))

    const deleted = await cleanupOldWebDocDrafts(30 * day)
    expect(deleted).toBe(1)
    expect(await getWebDocDraft('old')).toBeNull()
    expect(await getWebDocDraft('recent')).not.toBeNull()
  })

  it('listWebDocDraftsForDoc returns empty when no match', async () => {
    expect(await listWebDocDraftsForDoc('hm://none')).toEqual([])
  })
})
