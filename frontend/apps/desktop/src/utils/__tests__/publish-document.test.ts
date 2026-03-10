import {DocumentChange, ResourceVisibility} from '@shm/shared/client/.generated/documents/v3alpha/documents_pb'
import {describe, expect, it, vi} from 'vitest'
import {
  createDocumentChangeRequest,
  publishDesktopDocument,
  shouldUseDaemonCreateDocumentChange,
} from '../publish-document'

describe('shouldUseDaemonCreateDocumentChange', () => {
  it('uses daemon createDocumentChange for existing home documents', () => {
    expect(
      shouldUseDaemonCreateDocumentChange({
        signerAccountUid: 'alice',
        account: 'alice',
        path: '',
        baseVersion: 'bafy-base',
        changes: [],
      }),
    ).toBe(true)
  })

  it('keeps brand-new home documents on the seed client path', () => {
    expect(
      shouldUseDaemonCreateDocumentChange({
        signerAccountUid: 'alice',
        account: 'alice',
        path: '',
        changes: [],
      }),
    ).toBe(false)
  })

  it('keeps non-home documents on the seed client path', () => {
    expect(
      shouldUseDaemonCreateDocumentChange({
        signerAccountUid: 'alice',
        account: 'alice',
        path: '/foo',
        baseVersion: 'bafy-base',
        changes: [],
      }),
    ).toBe(false)
  })
})

describe('createDocumentChangeRequest', () => {
  it('normalizes an existing home document publish for daemon createDocumentChange', () => {
    const request = createDocumentChangeRequest({
      signerAccountUid: 'alice',
      account: 'alice',
      path: '',
      baseVersion: 'bafy-base',
      capability: 'bafy-cap',
      visibility: ResourceVisibility.PRIVATE,
      changes: [{op: {case: 'setMetadata', value: {key: 'name', value: 'Home'}}}],
    })

    expect(request.signingKeyName).toBe('alice')
    expect(request.account).toBe('alice')
    expect(request.path).toBe('')
    expect(request.baseVersion).toBe('bafy-base')
    expect(request.capability).toBe('bafy-cap')
    expect(request.visibility).toBe(ResourceVisibility.UNSPECIFIED)
    expect(request.changes).toHaveLength(1)
    expect(request.changes[0]).toBeInstanceOf(DocumentChange)
    expect(request.changes[0]?.op.case).toBe('setMetadata')
  })
})

describe('publishDesktopDocument', () => {
  it('uses daemon createDocumentChange for existing home documents', async () => {
    const createDocumentChange = vi.fn().mockResolvedValue(undefined)
    const publishDocument = vi.fn().mockResolvedValue(undefined)
    const getSigner = vi.fn()

    await publishDesktopDocument(
      {
        createDocumentChange,
        publishDocument,
        getSigner,
      },
      {
        signerAccountUid: 'alice',
        account: 'alice',
        path: '',
        baseVersion: 'bafy-base',
        changes: [{op: {case: 'setMetadata', value: {key: 'name', value: 'Home'}}}],
      },
    )

    expect(createDocumentChange).toHaveBeenCalledTimes(1)
    expect(publishDocument).not.toHaveBeenCalled()
    expect(getSigner).not.toHaveBeenCalled()
  })

  it('uses the seed client path for non-home documents', async () => {
    const createDocumentChange = vi.fn().mockResolvedValue(undefined)
    const publishDocument = vi.fn().mockResolvedValue(undefined)
    const signer = {
      getPublicKey: vi.fn(async () => new Uint8Array([1])),
      sign: vi.fn(async () => new Uint8Array([2])),
    }
    const getSigner = vi.fn(() => signer)

    await publishDesktopDocument(
      {
        createDocumentChange,
        publishDocument,
        getSigner,
      },
      {
        signerAccountUid: 'alice',
        account: 'alice',
        path: '/foo',
        baseVersion: 'bafy-base',
        changes: [{op: {case: 'setMetadata', value: {key: 'name', value: 'Foo'}}}],
      },
    )

    expect(createDocumentChange).not.toHaveBeenCalled()
    expect(getSigner).toHaveBeenCalledWith('alice')
    expect(publishDocument).toHaveBeenCalledWith(
      {
        account: 'alice',
        path: '/foo',
        baseVersion: 'bafy-base',
        changes: [{op: {case: 'setMetadata', value: {key: 'name', value: 'Foo'}}}],
      },
      signer,
    )
  })
})
