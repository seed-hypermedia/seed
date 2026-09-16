import {Code, ConnectError} from '@connectrpc/connect'
import {describe, expect, test, vi} from 'vitest'
import {ListChanges} from '../api-changes'
import {hmId} from '../utils/entity-id-url'

const republishId = hmId('site', {path: ['for-julio']})
const targetId = hmId('origin', {path: ['for-julio']})

/** The daemon reports a redirect Ref as a FailedPrecondition error naming the target. */
function redirectError(to: ReturnType<typeof hmId>, options?: {republish?: boolean}) {
  return new ConnectError(
    `document 'hm://site/for-julio' has a redirect to ${to.id} (republish = ${options?.republish ? 'true' : 'false'})`,
    Code.FailedPrecondition,
  )
}

function createMockGrpcClient(options: {republish: boolean}) {
  const getDocument = vi.fn(async ({account}: {account: string}) => {
    if (account === republishId.uid) throw redirectError(targetId, {republish: options.republish})
    return {version: 'v-target'}
  })
  const listDocumentChanges = vi.fn(async () => ({
    changes: [{toJson: () => ({id: 'change-1', author: 'origin', deps: [], createTime: ''})}],
  }))
  return {client: {documents: {getDocument, listDocumentChanges}} as any, getDocument, listDocumentChanges}
}

describe('ListChanges', () => {
  test('lists the target history for a republish address', async () => {
    const {client, listDocumentChanges} = createMockGrpcClient({republish: true})

    const result = await ListChanges.getData(client, {targetId: republishId}, async () => null as any)

    expect(result.latestVersion).toBe('v-target')
    expect(result.changes).toHaveLength(1)
    expect(listDocumentChanges).toHaveBeenCalledWith(expect.objectContaining({account: 'origin', path: '/for-julio'}))
  })

  test('returns no history for a move redirect', async () => {
    const {client, listDocumentChanges} = createMockGrpcClient({republish: false})

    const result = await ListChanges.getData(client, {targetId: republishId}, async () => null as any)

    expect(result).toEqual({changes: [], latestVersion: ''})
    expect(listDocumentChanges).not.toHaveBeenCalled()
  })
})
