// @vitest-environment jsdom
import {beforeEach, afterEach, expect, it} from 'vitest'
import {indexedDB} from 'fake-indexeddb'
import {hypermediaUrlToRoute} from '@shm/shared/utils/url-to-route'
import {routeToHref} from '@shm/shared/routing'
import {deleteWebCommentDraft, listWebCommentDrafts} from './comment-draft-utils'
import {_resetWebDocDraftDBForTesting, putWebDocDraft, getWebDocDraft} from './document-edit/web-draft-db'
import {discardWebDraft, listWebDrafts, webDraftResumeReason, type WebDraftItem} from './web-drafts'

const blocks = [{block: {id: 'p', type: 'Paragraph', text: 'Unsent comment', attributes: {}}}]
async function reset() {
  _resetWebDocDraftDBForTesting()
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('web-doc-drafts-01')
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
  localStorage.clear()
}
beforeEach(reset)
afterEach(reset)

it('lists all local document and comment drafts across accounts newest first, then discards only the selected row', async () => {
  for (const [draftId, docId, updatedAt] of [
    ['old', 'hm://alice/notes', 10],
    ['new', 'hm://bob/-new', 30],
  ] as const) {
    await putWebDocDraft({
      draftId,
      docId,
      updatedAt,
      signingAccountId: 'signer',
      content: [],
      metadata: {name: draftId},
      deps: [],
      navigation: null,
      locationUid: null,
      locationPath: null,
      editUid: null,
      editPath: null,
      cursorPosition: null,
    })
  }
  localStorage.setItem(
    'comment-draft-hm://carol/notes-reply-parent-quote-block-range-1-5',
    JSON.stringify({
      blocks,
      timestamp: 20,
      docId: 'hm://carol/notes',
      replyCommentId: 'parent',
      quotingBlockId: 'block',
      quotingRange: {start: 1, end: 5},
    }),
  )
  const drafts = await listWebDrafts()
  expect(drafts.map((draft) => draft.updatedAt)).toEqual([30, 20, 10])
  expect(drafts[0]?.route).toMatchObject({key: 'document', id: {uid: 'bob', path: ['-new']}})
  expect(drafts[1]?.route).toMatchObject({
    key: 'comments',
    id: {uid: 'carol', path: ['notes']},
    openComment: 'parent',
    replyCommentId: 'parent',
    targetBlockId: 'block',
    blockRange: {start: 1, end: 5},
    isReplying: true,
  })
  await discardWebDraft(drafts[1]!)
  expect((await listWebDrafts()).map((draft) => draft.storageId)).toEqual(['new', 'old'])
  await discardWebDraft(drafts[0]!)
  expect(await getWebDocDraft('new')).toBeNull()
  expect(await getWebDocDraft('old')).not.toBeNull()
})

it('uses explicit comment targets when document paths contain legacy delimiters', () => {
  const docId = 'hm://alice/my-reply-draft-quote-notes'
  const storageKey = `comment-draft-${docId}`
  localStorage.setItem(storageKey, JSON.stringify({blocks, timestamp: 10, docId}))
  expect(listWebCommentDrafts()).toMatchObject([
    {storageKey, docId, replyCommentId: undefined, quotingBlockId: undefined},
  ])
  deleteWebCommentDraft(storageKey)
  expect(listWebCommentDrafts()).toEqual([])
})

it('does not let malformed or empty records hide valid drafts or delete stored data', () => {
  localStorage.setItem('comment-draft-broken', '{')
  localStorage.setItem('comment-draft-empty', JSON.stringify({blocks: [], timestamp: 10}))
  localStorage.setItem('comment-draft-hm://alice', JSON.stringify({blocks, timestamp: 20}))
  expect(listWebCommentDrafts()).toHaveLength(1)
  expect(localStorage.getItem('comment-draft-broken')).toBe('{')
  expect(localStorage.getItem('comment-draft-empty')).not.toBeNull()
})

it('maps the shared Drafts navigation route to the web Drafts page', () => {
  expect(routeToHref({key: 'drafts'})).toBe('/hm/drafts')
})

it('keeps the Drafts route when the web provider restores navigation from the URL', () => {
  expect(hypermediaUrlToRoute('https://example.com/hm/drafts')).toEqual({key: 'drafts'})
  expect(hypermediaUrlToRoute('https://example.com/hm/alice/drafts')).toMatchObject({key: 'document'})
})

it('does not resume a different draft when multiple drafts target one document', async () => {
  const base = {
    docId: 'hm://alice/notes',
    signingAccountId: 'alice',
    content: [],
    metadata: {},
    deps: [],
    navigation: null,
    locationUid: null,
    locationPath: null,
    editUid: null,
    editPath: null,
    cursorPosition: null,
  }
  await putWebDocDraft({...base, draftId: 'older', updatedAt: 10})
  await putWebDocDraft({...base, draftId: 'newer', updatedAt: 20})
  const drafts = await listWebDrafts()
  expect(drafts[0]?.route).toMatchObject({key: 'document'})
  expect(drafts[1]?.route).toBeNull()
  expect(drafts[1]?.unavailableReason).toBeTruthy()
  await discardWebDraft(drafts[0]!)
  expect((await listWebDrafts())[0]?.route).toMatchObject({key: 'document'})
})

it('preserves a quoted comment draft target and range through web navigation', async () => {
  localStorage.setItem(
    'comment-draft-hm://alice/notes-quote-block-range-2-8',
    JSON.stringify({
      blocks,
      timestamp: 10,
      docId: 'hm://alice/notes',
      quotingBlockId: 'block',
      quotingRange: {start: 2, end: 8},
    }),
  )
  const draft = (await listWebDrafts())[0]!
  const href = routeToHref(draft.route!)
  expect(href).toBe('/hm/alice/notes/:comments?quote=block&quoteRange=2:8')
  expect(hypermediaUrlToRoute(`https://example.com${href}`)).toMatchObject({
    key: 'comments',
    targetBlockId: 'block',
    blockId: 'block',
    blockRange: {start: 2, end: 8},
  })
})

it('requires the original delegated signer for document drafts but permits pending spaces', () => {
  const draft: WebDraftItem = {
    key: 'doc',
    storageId: 'doc',
    title: 'Draft',
    type: 'document',
    updatedAt: 1,
    route: hypermediaUrlToRoute('hm://alice/notes'),
    signingAccountId: 'alice',
  }
  expect(webDraftResumeReason(draft, 'alice')).toBeUndefined()
  expect(webDraftResumeReason(draft, 'bob')).toContain('Sign in')
  expect(webDraftResumeReason(draft)).toContain('Sign in')
  expect(webDraftResumeReason({...draft, signingAccountId: undefined})).toContain('no saved signing account')
  expect(webDraftResumeReason({...draft, route: hypermediaUrlToRoute('hm://pending-space-test/notes')})).toBeUndefined()
})

it('keeps ambiguous legacy comment targets visible without navigating to a different document', async () => {
  const storageKey = 'comment-draft-hm://alice/my-reply-draft-quote-notes'
  localStorage.setItem(storageKey, JSON.stringify({blocks, timestamp: 10}))
  const drafts = await listWebDrafts()
  expect(drafts).toHaveLength(1)
  expect(drafts[0]?.route).toBeNull()
  expect(drafts[0]?.unavailableReason).toContain('original document')
  expect(localStorage.getItem(storageKey)).not.toBeNull()
  await discardWebDraft(drafts[0]!)
  expect(localStorage.getItem(storageKey)).toBeNull()
})

it('still resumes legacy comments without ambiguous target delimiters', async () => {
  localStorage.setItem('comment-draft-hm://alice/notes', JSON.stringify({blocks, timestamp: 10}))
  expect((await listWebDrafts())[0]?.route).toMatchObject({key: 'comments', id: {uid: 'alice', path: ['notes']}})
})
