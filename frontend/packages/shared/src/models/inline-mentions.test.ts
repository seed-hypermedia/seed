import {afterEach, describe, expect, it, vi} from 'vitest'
import type {UniversalClient} from '../universal-client'
import {hmId} from '../utils/entity-id-url'
import {queryInlineMentions} from './inline-mentions'
import {onQueryCacheError, queryClient} from './query-client'

afterEach(() => queryClient.clear())

describe('mention request failures', () => {
  it('reports failures locally without automatic retries or an error boundary', () => {
    const options = queryInlineMentions({} as UniversalClient, '')
    expect(options).toMatchObject({retry: false, useErrorBoundary: false, meta: {handlesErrorLocally: true}})
  })

  it('does not dispatch global error toasts for locally handled failures', async () => {
    const onGlobalError = vi.fn()
    onQueryCacheError(onGlobalError)
    const error = new Error('Unknown query key: MentionCandidates')
    await expect(
      queryClient.fetchQuery({
        queryKey: ['mention-error-regression'],
        queryFn: () => Promise.reject(error),
        retry: false,
        meta: {handlesErrorLocally: true},
      }),
    ).rejects.toBe(error)
    expect(onGlobalError).not.toHaveBeenCalled()
    await expect(
      queryClient.fetchQuery({
        queryKey: ['unhandled-error-regression'],
        queryFn: () => Promise.reject(error),
        retry: false,
      }),
    ).rejects.toBe(error)
    expect(onGlobalError).toHaveBeenCalledOnce()
  })
})

describe('reply mention search', () => {
  const thread = {
    replyAuthorUid: 'bob',
    participants: [{uid: 'alice', isThreadAuthor: true}, {uid: 'bob'}, {uid: 'bob'}],
  }
  it('seeds thread accounts before local recents and separates thread query caches', async () => {
    const request = vi.fn(async (_key: string, _input: unknown) => [])
    const client = {request, fetchRecents: async () => []} as unknown as UniversalClient
    const options = queryInlineMentions(client, '', undefined, {thread})
    await options.queryFn()
    expect(request.mock.calls[0]?.[1]).toMatchObject({
      mode: 'account',
      seedIds: [{uid: 'bob'}, {uid: 'alice'}],
    })
    expect(options.queryKey).not.toEqual(queryInlineMentions(client, '').queryKey)
  })
  it('does not seed thread accounts or vary document queries by reply context', async () => {
    const request = vi.fn(async (_key: string, _input: unknown) => [])
    const client = {request, fetchRecents: async () => []} as unknown as UniversalClient
    const options = queryInlineMentions(client, '', undefined, {mode: 'document', thread})
    await options.queryFn()
    expect(request.mock.calls[0]?.[1]).toMatchObject({mode: 'document', seedIds: []})
    expect(options.queryKey).toEqual(queryInlineMentions(client, '', undefined, {mode: 'document'}).queryKey)
  })
})

it('keeps alias resolution seeds but excludes the resolved selected account from reply results', async () => {
  const request = vi.fn(async (_key: string, _input: unknown) => [
    {
      id: hmId('current-self'),
      sourceAccountUid: 'self',
      type: 'account',
      title: 'Self',
      icon: '',
      parentNames: [],
      searchQuery: '',
      sameSite: false,
      issuedContact: false,
    },
    {
      id: hmId('other'),
      type: 'account',
      title: 'Other',
      icon: '',
      parentNames: [],
      searchQuery: '',
      sameSite: false,
      issuedContact: false,
    },
  ])
  const client = {request, fetchRecents: async () => []} as unknown as UniversalClient
  const results = await queryInlineMentions(client, '', 'self', {
    thread: {replyAuthorUid: 'self', participants: [{uid: 'self'}, {uid: 'other'}]},
  }).queryFn()
  expect(request.mock.calls[0]?.[1]).toMatchObject({seedIds: [{uid: 'self'}, {uid: 'other'}]})
  expect(results.map((c) => c.id.uid)).toEqual(['other'])
})
