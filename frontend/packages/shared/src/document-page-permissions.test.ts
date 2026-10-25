import {describe, expect, it, vi} from 'vitest'
import {
  pagePermissionScopes,
  pageReadRequest,
  pagePermissionStorageKey,
  createDocumentPageAccess,
  readPagePermissionGrants,
  type PagePermissionDecision,
  type PagePermissionRequest,
} from './document-page-permissions'

const comment: PagePermissionRequest = {
  kind: 'sign',
  type: 'Comment',
  site: 'alice',
  title: 'Comment',
  details: {text: 'Hello'},
}
const signal = () => new AbortController().signal

describe('page permission rules', () => {
  it('remembers comment scope without expanding to other sites, signatures or reading', async () => {
    const approve = vi.fn(async (): Promise<PagePermissionDecision> => 'type-site')
    const access = createDocumentPageAccess(approve)
    await access.authorize(comment, signal())
    await access.authorize({...comment, details: {text: 'Another'}}, signal())
    expect(approve).toHaveBeenCalledTimes(1)
    approve.mockResolvedValue('deny')
    for (const request of [
      {...comment, site: 'bob'},
      {...comment, type: 'Capability'},
      {...comment, type: 'CommentEdit'},
      {...comment, type: 'raw'},
      {...comment, kind: 'read' as const},
    ]) {
      await expect(access.authorize(request, signal())).rejects.toThrow('denied')
    }
    expect(access.snapshot()).toEqual([{kind: 'sign', type: 'Comment', site: 'alice', scope: 'type-site'}])
  })

  it('serializes distinct once approvals without coalescing them', async () => {
    const decisions: ((decision: PagePermissionDecision) => void)[] = []
    const approve = vi.fn(() => new Promise<PagePermissionDecision>((resolve) => decisions.push(resolve)))
    const access = createDocumentPageAccess(approve)
    const first = access.authorize(comment, signal())
    const second = access.authorize({...comment, details: {text: 'Different'}}, signal())
    await vi.waitFor(() => expect(approve).toHaveBeenCalledTimes(1))
    decisions[0]!('once')
    await first
    await vi.waitFor(() => expect(approve).toHaveBeenCalledTimes(2))
    decisions[1]!('deny')
    await expect(second).rejects.toThrow('denied')
    expect(access.snapshot()).toEqual([])
  })

  it('aborts pending approvals and existing result delivery on revocation', async () => {
    const approve = vi.fn(async (_request, active: AbortSignal): Promise<PagePermissionDecision> => {
      await new Promise<void>((resolve) => active.addEventListener('abort', () => resolve(), {once: true}))
      return 'once'
    })
    const access = createDocumentPageAccess(approve)
    const active = access.signal(signal())
    const pending = access.authorize(comment, signal())
    await vi.waitFor(() => expect(approve).toHaveBeenCalled())
    access.revoke()
    await expect(pending).rejects.toThrow('revoked')
    expect(active.aborted).toBe(true)
  })

  it('restores rules for the same account and document, independent of versions', async () => {
    const key = pagePermissionStorageKey('viewer', 'hm://alice/page')
    expect(key).not.toBe(pagePermissionStorageKey('other', 'hm://alice/page'))
    expect(key).not.toBe(pagePermissionStorageKey('viewer', 'hm://alice/other'))
    const original = createDocumentPageAccess(async () => 'type')
    await original.authorize(comment, signal())
    const storage = {getItem: () => JSON.stringify(original.snapshot())}
    original.close()
    const approve = vi.fn(async (): Promise<PagePermissionDecision> => 'deny')
    const reopened = createDocumentPageAccess(approve, () => {}, readPagePermissionGrants(storage, key))
    await reopened.authorize({...comment, site: 'bob'}, signal())
    expect(approve).not.toHaveBeenCalled()
    const active = reopened.signal(signal())
    reopened.replace([])
    expect(active.aborted).toBe(true)
    await expect(reopened.authorize(comment, signal())).rejects.toThrow('denied')
    expect(readPagePermissionGrants({getItem: () => '{malformed'}, key)).toEqual([])
  })

  it('offers no misleading narrow scope for unrecognized signatures or unbounded reads', () => {
    expect(pagePermissionScopes({...comment, type: 'raw'})).toEqual(['once', 'all'])
    expect(pagePermissionScopes({kind: 'read', type: 'Query', title: '', details: {}})).toEqual(['once', 'all'])
  })
  it('derives query space only from bounded inclusions or restrictive predicates', () => {
    expect(pageReadRequest('Query', {includes: [{space: 'alice'}, {space: 'alice'}]}).site).toBe('alice')
    for (const includes of [[], [{space: ''}], [{space: 'alice'}, {space: 'bob'}]])
      expect(pageReadRequest('Query', {includes}).site).toBeUndefined()
    expect(
      pageReadRequest('QueryDocuments', {
        filter: {or: {filters: [{spaceMatch: {space: 'alice'}}, {spaceMatch: {space: 'alice'}}]}},
      }).site,
    ).toBe('alice')
    for (const filter of [
      undefined,
      {},
      {not: {filter: {spaceMatch: {space: 'alice'}}}},
      {or: {filters: [{spaceMatch: {space: 'alice'}}, {exists: {key: 'name'}}]}},
      {spaceMatch: {space: 'alice'}, or: {filters: []}},
    ])
      expect(pageReadRequest('QueryDocuments', {filter}).site).toBeUndefined()
  })
})
