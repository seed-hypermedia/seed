import {createDocumentChange, createGenesisChange, createVersionRef, signDocumentChange} from '@seed-hypermedia/client'
import {beforeEach, describe, expect, it, vi} from 'vitest'
import {createWebUniversalClient} from '../create-web-universal-client'

vi.mock('@seed-hypermedia/client', async () => {
  const actual = await vi.importActual<typeof import('@seed-hypermedia/client')>('@seed-hypermedia/client')
  return {
    ...actual,
    createGenesisChange: vi.fn(),
    createDocumentChange: vi.fn(),
    createVersionRef: vi.fn(),
    signDocumentChange: vi.fn(),
  }
})

describe('createWebUniversalClient publishDocument', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates brand-new site home metadata without PrepareDocumentChange', async () => {
    const mockedCreateGenesisChange = vi.mocked(createGenesisChange)
    const mockedCreateDocumentChange = vi.mocked(createDocumentChange)
    const mockedCreateVersionRef = vi.mocked(createVersionRef)
    const mockedSignDocumentChange = vi.mocked(signDocumentChange)

    mockedCreateGenesisChange.mockResolvedValueOnce({
      bytes: new Uint8Array([1]),
      cid: {toString: () => 'bafy-genesis'} as any,
    })
    mockedCreateDocumentChange.mockResolvedValueOnce({
      bytes: new Uint8Array([2]),
      cid: {toString: () => 'bafy-site-metadata'} as any,
    })
    mockedCreateVersionRef.mockResolvedValueOnce({
      blobs: [{cid: 'bafy-site-ref', data: new Uint8Array([3])}],
    })

    const request = vi.fn()
    const publish = vi.fn().mockResolvedValue({cids: []})
    const signer = {
      getPublicKey: vi.fn(async () => new Uint8Array([1])),
      sign: vi.fn(async () => new Uint8Array([2])),
    }
    const client = createWebUniversalClient({
      CommentEditor: () => null as any,
      request,
      publish,
      getSigner: () => signer,
    })

    await client.publishDocument!({
      account: 'test-uid',
      signerAccountUid: 'test-uid',
      changes: [{op: {case: 'setMetadata', value: {key: 'siteUrl', value: 'https://site.example'}}}],
    })

    expect(request).not.toHaveBeenCalled()
    expect(publish).toHaveBeenCalledTimes(1)
    expect(mockedCreateDocumentChange).toHaveBeenCalledWith(
      expect.objectContaining({
        depth: 1,
        changes: [{op: {case: 'setMetadata', value: {key: 'siteUrl', value: 'https://site.example'}}}],
      }),
      signer,
    )
    expect(mockedCreateVersionRef).toHaveBeenCalledWith(
      expect.objectContaining({
        space: 'test-uid',
        path: '',
        genesis: 'bafy-genesis',
        version: 'bafy-site-metadata',
      }),
      signer,
    )
    expect(mockedSignDocumentChange).not.toHaveBeenCalled()
  })

  it('bootstraps brand-new home documents with blocks before PrepareDocumentChange', async () => {
    const mockedCreateGenesisChange = vi.mocked(createGenesisChange)
    const mockedCreateDocumentChange = vi.mocked(createDocumentChange)
    const mockedCreateVersionRef = vi.mocked(createVersionRef)
    const mockedSignDocumentChange = vi.mocked(signDocumentChange)

    mockedCreateGenesisChange.mockResolvedValueOnce({
      bytes: new Uint8Array([1]),
      cid: {toString: () => 'bafy-genesis'} as any,
    })
    mockedCreateVersionRef.mockResolvedValueOnce({
      blobs: [{cid: 'bafy-genesis-ref', data: new Uint8Array([2])}],
    })
    mockedSignDocumentChange.mockResolvedValueOnce({
      changeCid: {} as any,
      publishInput: {blobs: [{cid: 'bafy-content', data: new Uint8Array([3])}]},
    })

    const request = vi.fn().mockResolvedValue({unsignedChange: new Uint8Array([4, 5, 6])})
    const publish = vi.fn().mockResolvedValue({cids: []})
    const signer = {
      getPublicKey: vi.fn(async () => new Uint8Array([1])),
      sign: vi.fn(async () => new Uint8Array([2])),
    }
    const client = createWebUniversalClient({
      CommentEditor: () => null as any,
      request,
      publish,
      getSigner: () => signer,
    })

    await client.publishDocument!({
      account: 'test-uid',
      signerAccountUid: 'test-uid',
      changes: [
        {op: {case: 'setMetadata', value: {key: 'name', value: 'Home'}}},
        {op: {case: 'moveBlock', value: {blockId: 'b1', parent: '', leftSibling: ''}}},
        {op: {case: 'replaceBlock', value: {id: 'b1', type: 'paragraph', text: 'Hello'}}},
      ],
    })

    expect(publish).toHaveBeenCalledTimes(2)
    expect(request).toHaveBeenCalledWith(
      'PrepareDocumentChange',
      expect.objectContaining({
        account: 'test-uid',
        baseVersion: 'bafy-genesis',
        changes: expect.any(Array),
      }),
    )
    expect(mockedCreateDocumentChange).not.toHaveBeenCalled()
    expect(mockedSignDocumentChange).toHaveBeenCalledWith(
      expect.objectContaining({
        account: 'test-uid',
        unsignedChange: new Uint8Array([4, 5, 6]),
        genesis: 'bafy-genesis',
        generation: 1,
      }),
      signer,
    )
  })

  it('creates brand-new subdocuments through PrepareDocumentChange', async () => {
    const mockedCreateGenesisChange = vi.mocked(createGenesisChange)
    const mockedCreateDocumentChange = vi.mocked(createDocumentChange)
    const mockedSignDocumentChange = vi.mocked(signDocumentChange)

    mockedSignDocumentChange.mockResolvedValueOnce({
      changeCid: {} as any,
      publishInput: {blobs: [{cid: 'bafy-subdoc', data: new Uint8Array([7])}]},
    })

    const request = vi.fn().mockResolvedValue({unsignedChange: new Uint8Array([8, 9])})
    const publish = vi.fn().mockResolvedValue({cids: []})
    const signer = {
      getPublicKey: vi.fn(async () => new Uint8Array([1])),
      sign: vi.fn(async () => new Uint8Array([2])),
    }
    const client = createWebUniversalClient({
      CommentEditor: () => null as any,
      request,
      publish,
      getSigner: () => signer,
    })

    await client.publishDocument!({
      account: 'test-uid',
      signerAccountUid: 'test-uid',
      path: '/docs/intro',
      changes: [
        {op: {case: 'setMetadata', value: {key: 'name', value: 'Intro'}}},
        {op: {case: 'moveBlock', value: {blockId: 'b1', parent: '', leftSibling: ''}}},
        {op: {case: 'replaceBlock', value: {id: 'b1', type: 'paragraph', text: 'Hello'}}},
      ],
    })

    expect(request).toHaveBeenCalledTimes(1)
    expect(request).toHaveBeenCalledWith(
      'PrepareDocumentChange',
      expect.objectContaining({
        account: 'test-uid',
        path: '/docs/intro',
        baseVersion: undefined,
      }),
    )
    expect(publish).toHaveBeenCalledTimes(1)
    expect(mockedCreateGenesisChange).not.toHaveBeenCalled()
    expect(mockedCreateDocumentChange).not.toHaveBeenCalled()
    expect(mockedSignDocumentChange).toHaveBeenCalledWith(
      expect.objectContaining({
        account: 'test-uid',
        path: '/docs/intro',
        unsignedChange: new Uint8Array([8, 9]),
      }),
      signer,
    )
  })
})
