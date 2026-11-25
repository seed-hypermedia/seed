import {hmId} from '@shm/shared'
import {beforeEach, describe, expect, it, vi} from 'vitest'
const state = vi.hoisted(() => ({fetch: vi.fn(), publish: vi.fn(), invalidate: vi.fn()}))
vi.mock('@/models/entities', () => ({fetchResource: state.fetch}))
vi.mock('@/desktop-universal-client', () => ({desktopUniversalClient: {publishDocument: state.publish}}))
vi.mock('@/grpc-client', () => ({grpcClient: {}}))
vi.mock('@/trpc', () => ({client: {}}))
vi.mock('@/errors', () => ({reportError: vi.fn()}))
vi.mock('@shm/shared/models/query-client', () => ({invalidateQueries: state.invalidate}))
import {updateMovedSitePublication} from '../site'

const id = hmId('z6MkTestAccount')
const oldUrl = 'http://old.localhost:3000'
const newUrl = 'http://new.localhost:3000'
describe('publication metadata after a hosting move', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })
  it('publishes the returned URL using a fresh document version', async () => {
    state.fetch.mockResolvedValue({
      type: 'document',
      document: {version: 'fresh', genesis: 'root', metadata: {siteUrl: oldUrl}},
    })
    await updateMovedSitePublication(id, oldUrl, newUrl)
    expect(state.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        account: id.uid,
        baseVersion: 'fresh',
        changes: [{op: {case: 'setMetadata', value: {key: 'siteUrl', value: newUrl}}}],
      }),
    )
    expect(state.invalidate).toHaveBeenCalledTimes(3)
  })
  it.each(['https://custom.example.com', 'https://newer-choice.example.com', ''])(
    'preserves a different publication URL: %s',
    async (siteUrl) => {
      state.fetch.mockResolvedValue({type: 'document', document: {metadata: {siteUrl}}})
      await updateMovedSitePublication(id, oldUrl, newUrl)
      expect(state.publish).not.toHaveBeenCalled()
    },
  )
  it('fails recoverably if the publication cannot be loaded', async () => {
    state.fetch.mockResolvedValue({type: 'error'})
    await expect(updateMovedSitePublication(id, oldUrl, newUrl)).rejects.toThrow('Unable to load')
    expect(state.publish).not.toHaveBeenCalled()
  })
})
