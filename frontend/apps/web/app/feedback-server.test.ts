import {beforeEach, describe, expect, it, vi} from 'vitest'

const mocks = vi.hoisted(() => ({
  request: vi.fn(async (_key: string, _input: unknown) => ({unsignedChange: new Uint8Array([1, 2, 3])})),
  publish: vi.fn(async (_input: unknown) => ({cids: []})),
  config: {
    registeredAccountUid: 'nodos-aprendizaje-uid',
    feedbackDestinationAccountUid: 'seed-surveys-uid',
    feedbackDestinationLabel: 'seed-surveys.hyper.media',
    feedbackSignerAccountUid: 'nodos-conocimiento-uid',
    feedbackDestinationCapabilityCid: 'cap-seed-surveys-writer',
    feedbackDocumentVisibility: undefined as 'private' | 'public' | undefined,
  },
}))

vi.mock('@seed-hypermedia/client', () => ({
  signDocumentChange: vi.fn(async () => ({
    changeCid: {toString: () => 'bafy-feedback-version'},
    publishInput: {blobs: [{cid: 'bafy-feedback-version', data: new Uint8Array([1])}]},
  })),
}))

vi.mock('./site-config.server', () => ({
  getConfig: vi.fn(async () => mocks.config),
}))

vi.mock('./server-signing', () => ({
  getServerSigner: vi.fn(async () => ({
    getPublicKey: vi.fn(async () => new Uint8Array([1, 2, 3])),
    sign: vi.fn(async () => new Uint8Array(64)),
  })),
}))

vi.mock('./server-universal-client', () => ({
  serverUniversalClient: {
    request: mocks.request,
    publish: mocks.publish,
  },
}))

vi.mock('./report-error', () => ({
  reportError: vi.fn(),
}))

import {action} from './routes/hm.api.feedback'

describe('feedback server endpoint', () => {
  beforeEach(() => {
    mocks.request.mockClear()
    mocks.publish.mockClear()
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
    expect(mocks.request).toHaveBeenCalledWith(
      'PrepareDocumentChange',
      expect.objectContaining({
        account: 'seed-surveys-uid',
        capability: 'cap-seed-surveys-writer',
        visibility: 2,
      }),
    )
    expect(mocks.publish).toHaveBeenCalledTimes(1)
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
    expect(mocks.request).toHaveBeenCalledWith(
      'PrepareDocumentChange',
      expect.objectContaining({
        account: 'seed-surveys-uid',
        visibility: 0,
      }),
    )
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
