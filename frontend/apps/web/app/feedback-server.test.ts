import {beforeEach, describe, expect, it, vi} from 'vitest'

const mocks = vi.hoisted(() => ({
  createChangeOps: vi.fn((_input: unknown) => ({
    unsignedBytes: new Uint8Array([1, 2, 3]),
    ts: BigInt(123),
  })),
  createChange: vi.fn(async (_input: unknown, _signer: unknown) => ({
    bytes: new Uint8Array([4, 5, 6]),
    cid: {toString: () => 'bafy-feedback-version'},
  })),
  createVersionRef: vi.fn(async (_input: unknown, _signer: unknown) => ({
    blobs: [{cid: 'bafy-feedback-ref', data: new Uint8Array([7, 8, 9])}],
  })),
  publish: vi.fn(async (_input: unknown) => ({cids: []})),
  fetch: vi.fn(async (_input: unknown) => new Response(new Uint8Array([10, 11, 12]))),
  pushResourcesToPeer: vi.fn(async function* (_input: unknown) {
    yield {
      blobsAnnounced: 2,
      blobsKnown: 0,
      blobsWanted: 2,
      blobsProcessed: 2,
      blobsFailed: 0,
    }
  }),
  config: {
    registeredAccountUid: 'nodos-aprendizaje-uid',
    feedbackDestinationAccountUid: 'seed-surveys-uid',
    feedbackDestinationLabel: 'seed-surveys.hyper.media',
    feedbackSignerAccountUid: 'nodos-conocimiento-uid',
    feedbackDestinationCapabilityCid: 'cap-seed-surveys-writer',
    feedbackDocumentVisibility: undefined as 'private' | 'public' | undefined,
    feedbackDestinationPeerAddrs: ['/dns4/seed-surveys.example/tcp/56001/p2p/seed-surveys-peer'],
  },
}))

vi.mock('@seed-hypermedia/client', () => ({
  createChangeOps: mocks.createChangeOps,
  createChange: mocks.createChange,
  createVersionRef: mocks.createVersionRef,
  signDocumentChange: vi.fn(),
}))

vi.mock('./site-config.server', () => ({
  getConfig: vi.fn(async () => mocks.config),
}))

vi.mock('./server-signing', () => ({
  getServerSigningKey: vi.fn(async () => ({
    name: 'server-key-name',
    signer: {
      getPublicKey: vi.fn(async () => new Uint8Array([1, 2, 3])),
      sign: vi.fn(async () => new Uint8Array(64)),
    },
  })),
}))

vi.mock('./client.server', () => ({
  grpcClient: {
    resources: {
      pushResourcesToPeer: mocks.pushResourcesToPeer,
    },
  },
}))

vi.mock('./server-universal-client', () => ({
  serverUniversalClient: {
    publish: mocks.publish,
  },
}))

vi.mock('./report-error', () => ({
  reportError: vi.fn(),
}))

import {action} from './routes/hm.api.feedback'

describe('feedback server endpoint', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mocks.fetch)
    mocks.createChangeOps.mockClear()
    mocks.createChangeOps.mockReturnValue({
      unsignedBytes: new Uint8Array([1, 2, 3]),
      ts: BigInt(123),
    })
    mocks.createChange.mockClear()
    mocks.createChange.mockResolvedValue({
      bytes: new Uint8Array([4, 5, 6]),
      cid: {toString: () => 'bafy-feedback-version'},
    })
    mocks.createVersionRef.mockClear()
    mocks.createVersionRef.mockResolvedValue({
      blobs: [{cid: 'bafy-feedback-ref', data: new Uint8Array([7, 8, 9])}],
    })
    mocks.publish.mockClear()
    mocks.publish.mockResolvedValue({cids: []})
    mocks.fetch.mockClear()
    mocks.fetch.mockResolvedValue(new Response(new Uint8Array([10, 11, 12])))
    mocks.pushResourcesToPeer.mockClear()
    mocks.pushResourcesToPeer.mockImplementation(async function* (_input: unknown) {
      yield {
        blobsAnnounced: 2,
        blobsKnown: 0,
        blobsWanted: 2,
        blobsProcessed: 2,
        blobsFailed: 0,
      }
    })
    mocks.config.feedbackDocumentVisibility = undefined
  })

  it('publishes submitted feedback into the configured destination account', async () => {
    const request = new Request('https://nodosdeaprendizaje.es/hm/api/feedback', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({firstImpression: 'Me ayuda a entender la red.'}),
    })

    const response = await action({request, params: {}, context: {}})
    const body = (await response.json()) as {
      destinationLabel: string
      documentId: string
      documentVersion: string
      documentPath: string[]
      visibility: 'private' | 'public'
    }

    expect(response.status).toBe(200)
    expect(body.destinationLabel).toBe('seed-surveys.hyper.media')
    expect(body.visibility).toBe('private')
    expect(body.documentId).toContain('hm://seed-surveys-uid/')
    expect(body.documentVersion).toBe('bafy-feedback-version')
    expect(body.documentPath).toHaveLength(1)
    expect(mocks.createChangeOps).toHaveBeenCalledWith(
      expect.objectContaining({
        ops: expect.arrayContaining([expect.objectContaining({type: 'SetAttributes'})]),
        ts: expect.any(BigInt),
      }),
    )
    expect(mocks.createVersionRef).toHaveBeenCalledWith(
      expect.objectContaining({
        space: 'seed-surveys-uid',
        path: expect.stringMatching(/^\/.+/),
        genesis: 'bafy-feedback-version',
        version: 'bafy-feedback-version',
        generation: 123,
        capability: 'cap-seed-surveys-writer',
        visibility: 'Private',
      }),
      expect.any(Object),
    )
    expect(mocks.fetch).toHaveBeenCalledWith('https://seed-surveys.hyper.media/ipfs/cap-seed-surveys-writer')
    expect(mocks.publish).toHaveBeenCalledWith({
      blobs: [
        {cid: 'cap-seed-surveys-writer', data: expect.any(Uint8Array)},
        {cid: 'bafy-feedback-version', data: expect.any(Uint8Array)},
        {cid: 'bafy-feedback-ref', data: expect.any(Uint8Array)},
      ],
    })
    expect(mocks.pushResourcesToPeer).toHaveBeenCalledWith({
      resources: [body.documentId],
      addrs: ['/dns4/seed-surveys.example/tcp/56001/p2p/seed-surveys-peer'],
      recursive: false,
    })
  })

  it('can publish public feedback when configured for debugging', async () => {
    mocks.config.feedbackDocumentVisibility = 'public'
    const request = new Request('https://nodosdeaprendizaje.es/hm/api/feedback', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({firstImpression: 'Public debug feedback.'}),
    })

    const response = await action({request, params: {}, context: {}})
    const body = (await response.json()) as {visibility: 'private' | 'public'}

    expect(response.status).toBe(200)
    expect(body.visibility).toBe('public')
    expect(mocks.createVersionRef).toHaveBeenCalledWith(
      expect.objectContaining({
        space: 'seed-surveys-uid',
        visibility: undefined,
      }),
      expect.any(Object),
    )
    expect(mocks.pushResourcesToPeer).toHaveBeenCalledTimes(1)
  })

  it('returns success when destination push announces no blobs after local publish', async () => {
    mocks.pushResourcesToPeer.mockImplementation(async function* (_input: unknown) {
      yield {
        blobsAnnounced: 0,
        blobsKnown: 0,
        blobsWanted: 0,
        blobsProcessed: 0,
        blobsFailed: 0,
      }
    })
    const request = new Request('https://nodosdeaprendizaje.es/hm/api/feedback', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({firstImpression: 'Push announces nothing.'}),
    })

    const response = await action({request, params: {}, context: {}})

    expect(response.status).toBe(200)
    expect(mocks.publish).toHaveBeenCalledTimes(1)
    expect(mocks.pushResourcesToPeer).toHaveBeenCalledTimes(1)
  })

  it('returns success when destination push fails after local publish', async () => {
    mocks.pushResourcesToPeer.mockImplementation(async function* (_input: unknown) {
      yield {
        blobsAnnounced: 2,
        blobsKnown: 0,
        blobsWanted: 2,
        blobsProcessed: 2,
        blobsFailed: 1,
      }
    })
    const request = new Request('https://nodosdeaprendizaje.es/hm/api/feedback', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({firstImpression: 'Push should fail.'}),
    })

    const response = await action({request, params: {}, context: {}})

    expect(response.status).toBe(200)
    expect(mocks.publish).toHaveBeenCalledTimes(1)
    expect(mocks.pushResourcesToPeer).toHaveBeenCalledTimes(1)
  })

  it('rejects empty feedback server-side', async () => {
    const request = new Request('https://nodosdeaprendizaje.es/hm/api/feedback', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({name: 'Only Name'}),
    })

    const response = await action({request, params: {}, context: {}})

    expect(response.status).toBe(400)
  })
})
