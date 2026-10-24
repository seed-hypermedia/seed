import {describe, expect, it, vi} from 'vitest'
import {
  appPermissionScopes,
  appPermissionStorageKey,
  createDocumentAppAccess,
  readAppPermissionGrants,
  type AppPermissionDecision,
  type AppPermissionRequest,
} from './document-app-permissions'

const comment: AppPermissionRequest = {
  kind: 'sign',
  type: 'Comment',
  site: 'alice',
  title: 'Comment',
  details: {text: 'Hello'},
}
const signal = () => new AbortController().signal

describe('app permission rules', () => {
  it('remembers comment scope without expanding to other sites, signatures or reading', async () => {
    const approve = vi.fn(async (): Promise<AppPermissionDecision> => 'type-site')
    const access = createDocumentAppAccess(approve)
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
    const decisions: ((decision: AppPermissionDecision) => void)[] = []
    const approve = vi.fn(() => new Promise<AppPermissionDecision>((resolve) => decisions.push(resolve)))
    const access = createDocumentAppAccess(approve)
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
    const approve = vi.fn(async (_request, active: AbortSignal): Promise<AppPermissionDecision> => {
      await new Promise<void>((resolve) => active.addEventListener('abort', () => resolve(), {once: true}))
      return 'once'
    })
    const access = createDocumentAppAccess(approve)
    const active = access.signal(signal())
    const pending = access.authorize(comment, signal())
    await vi.waitFor(() => expect(approve).toHaveBeenCalled())
    access.revoke()
    await expect(pending).rejects.toThrow('revoked')
    expect(active.aborted).toBe(true)
  })

  it('restores rules for the same account and document, independent of versions', async () => {
    const key = appPermissionStorageKey('viewer', 'hm://alice/app')
    expect(key).not.toBe(appPermissionStorageKey('other', 'hm://alice/app'))
    expect(key).not.toBe(appPermissionStorageKey('viewer', 'hm://alice/other'))
    const original = createDocumentAppAccess(async () => 'type')
    await original.authorize(comment, signal())
    const storage = {getItem: () => JSON.stringify(original.snapshot())}
    original.close()
    const approve = vi.fn(async (): Promise<AppPermissionDecision> => 'deny')
    const reopened = createDocumentAppAccess(approve, () => {}, readAppPermissionGrants(storage, key))
    await reopened.authorize({...comment, site: 'bob'}, signal())
    expect(approve).not.toHaveBeenCalled()
    const active = reopened.signal(signal())
    reopened.replace([])
    expect(active.aborted).toBe(true)
    await expect(reopened.authorize(comment, signal())).rejects.toThrow('denied')
    expect(readAppPermissionGrants({getItem: () => '{malformed'}, key)).toEqual([])
  })

  it('offers no misleading narrow scope for unrecognized signatures or unbounded reads', () => {
    expect(appPermissionScopes({...comment, type: 'raw'})).toEqual(['once', 'all'])
    expect(appPermissionScopes({kind: 'read', type: 'Query', title: '', details: {}})).toEqual(['once', 'all'])
  })
})
