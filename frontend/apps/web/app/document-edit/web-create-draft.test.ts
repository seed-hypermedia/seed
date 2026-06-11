import 'fake-indexeddb/auto'
import {indexedDB} from 'fake-indexeddb'
import type {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {isReservedLazyDraftId} from '@shm/shared/utils/reserved-draft-ids'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

import {createWebDocumentDraft, createWebDocumentDraftFromMarkdownFile} from './web-create-draft'
import {_resetWebDocDraftDBForTesting, getWebDocDraft} from './web-draft-db'

const DB_NAME = 'web-doc-drafts-01'

function dropDB(): Promise<void> {
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME)
    req.onsuccess = () => resolve()
    req.onerror = () => resolve()
  })
}

function makeDocId(uid: string, path: string[] = []): UnpackedHypermediaId {
  return {
    uid,
    path,
    id: `hm://${uid}${path.length ? '/' + path.join('/') : ''}`,
    version: null,
    blockRef: null,
    blockRange: null,
    hostname: null,
    scheme: 'hm',
    latest: false,
  } as UnpackedHypermediaId
}

describe('createWebDocumentDraft', () => {
  beforeEach(async () => {
    _resetWebDocDraftDBForTesting()
    await dropDB()
  })

  afterEach(async () => {
    _resetWebDocDraftDBForTesting()
    await dropDB()
  })

  it('creates a public child draft at a placeholder path and navigates to it', async () => {
    const navigate = vi.fn()
    const {routeId} = await createWebDocumentDraft({
      locationId: makeDocId('site', ['parent']),
      signingAccountId: 'author',
      visibility: 'PUBLIC',
      capabilityCid: 'cap-1',
      navigate,
      generateDraftId: () => 'draft-1',
    })

    expect(routeId.path).toEqual(['parent', '-draft-1'])
    expect(navigate).toHaveBeenCalledWith({key: 'document', id: routeId})

    const draft = await getWebDocDraft('draft-1')
    expect(draft).toMatchObject({
      draftId: 'draft-1',
      docId: routeId.id,
      signingAccountId: 'author',
      capabilityCid: 'cap-1',
      locationUid: 'site',
      locationPath: ['parent'],
      editUid: null,
      editPath: null,
      visibility: 'PUBLIC',
    })
  })

  it('creates a private draft at a generated private path', async () => {
    const navigate = vi.fn()
    const {routeId} = await createWebDocumentDraft({
      locationId: makeDocId('site', ['parent']),
      signingAccountId: 'author',
      visibility: 'PRIVATE',
      navigate,
      generateDraftId: () => 'draft-2',
      generatePath: () => 'private-path',
    })

    expect(routeId.path).toEqual(['-private-draft-2'])

    const draft = await getWebDocDraft('draft-2')
    expect(draft).toMatchObject({
      draftId: 'draft-2',
      locationPath: ['-private-draft-2'],
      editPath: ['-private-draft-2'],
      visibility: 'PRIVATE',
    })
  })

  it('can navigate to a public child draft route without persisting an empty draft', async () => {
    const navigate = vi.fn()
    const {routeId, draftId} = await createWebDocumentDraft({
      locationId: makeDocId('site', ['parent']),
      signingAccountId: 'author',
      visibility: 'PUBLIC',
      navigate,
      persist: false,
      generateDraftId: () => 'lazy-draft',
    })

    expect(draftId).toBe('lazy-draft')
    expect(routeId.path).toEqual(['parent', '-lazy-draft'])
    expect(navigate).toHaveBeenCalledWith({key: 'document', id: routeId})
    await expect(getWebDocDraft('lazy-draft')).resolves.toBeNull()
    expect(isReservedLazyDraftId('lazy-draft')).toBe(true)
  })

  it('can navigate to a private draft route without persisting an empty draft', async () => {
    const navigate = vi.fn()
    const {routeId, draftId} = await createWebDocumentDraft({
      locationId: makeDocId('site', ['parent']),
      signingAccountId: 'author',
      visibility: 'PRIVATE',
      navigate,
      persist: false,
      generateDraftId: () => 'lazy-private',
    })

    expect(draftId).toBe('lazy-private')
    expect(routeId.path).toEqual(['-private-lazy-private'])
    expect(navigate).toHaveBeenCalledWith({key: 'document', id: routeId})
    await expect(getWebDocDraft('lazy-private')).resolves.toBeNull()
  })

  it('stores imported content and metadata when provided', async () => {
    const navigate = vi.fn()
    const {routeId} = await createWebDocumentDraft({
      locationId: makeDocId('site', []),
      signingAccountId: 'author',
      metadata: {name: 'Imported Title'},
      content: [{block: {id: 'b1', type: 'Paragraph', text: 'Hello import'} as any}],
      generateDraftId: () => 'import-draft',
      navigate,
    })

    expect(navigate).toHaveBeenCalledWith({key: 'document', id: routeId})
    const draft = await getWebDocDraft('import-draft')
    expect(draft?.metadata).toMatchObject({name: 'Imported Title'})
    expect(draft?.content.length).toBeGreaterThan(0)
  })

  it('imports a Markdown file into a named draft', async () => {
    const navigate = vi.fn()
    const {routeId} = await createWebDocumentDraftFromMarkdownFile({
      file: new File(['# Imported Title\n\nHello import'], 'fallback.md', {type: 'text/markdown'}),
      locationId: makeDocId('site', []),
      signingAccountId: 'author',
      navigate,
    })

    expect(navigate).toHaveBeenCalledWith({key: 'document', id: routeId})
    const draft = await getWebDocDraft(routeId.path?.at(-1)?.replace(/^-/, '') || '')
    expect(draft?.metadata).toMatchObject({name: 'Imported Title'})
    expect((draft?.content[0]?.block as any)?.text).toBe('Hello import')
  })

  it('preserves Markdown frontmatter metadata on import', async () => {
    const {routeId} = await createWebDocumentDraftFromMarkdownFile({
      file: new File(['---\ntitle: Frontmatter Title\nsummary: Imported summary\n---\n\nBody text'], 'fallback.md', {
        type: 'text/markdown',
      }),
      locationId: makeDocId('site', []),
      signingAccountId: 'author',
      navigate: vi.fn(),
    })

    const draft = await getWebDocDraft(routeId.path?.at(-1)?.replace(/^-/, '') || '')
    expect(draft?.metadata).toMatchObject({
      name: 'Frontmatter Title',
      summary: 'Imported summary',
    })
    expect((draft?.content[0]?.block as any)?.text).toBe('Body text')
  })
})
