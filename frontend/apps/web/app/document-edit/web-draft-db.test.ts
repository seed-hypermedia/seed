import 'fake-indexeddb/auto'
import {indexedDB} from 'fake-indexeddb'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'

import {
  _resetWebDocDraftDBForTesting,
  cleanupOldWebDocDrafts,
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

  it('round-trips a draft', async () => {
    const draft = makeDraft({draftId: 'd-rt', docId: 'hm://doc-rt'})
    await putWebDocDraft(draft)
    const loaded = await getWebDocDraft('d-rt')
    expect(loaded).not.toBeNull()
    expect(loaded?.draftId).toBe('d-rt')
    expect(loaded?.docId).toBe('hm://doc-rt')
    expect(typeof loaded?.updatedAt).toBe('number')
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
