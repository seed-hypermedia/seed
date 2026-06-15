import {describe, expect, it, vi} from 'vitest'
import {publishDesktopDocument, shouldUseDaemonCreateDocumentChange} from '../publish-document'

describe('shouldUseDaemonCreateDocumentChange', () => {
  it('does not use daemon createDocumentChange for existing home documents', () => {
    expect(
      shouldUseDaemonCreateDocumentChange({
        signerAccountUid: 'alice',
        account: 'alice',
        path: '',
        baseVersion: 'bafy-base',
        genesis: 'bafy-genesis',
        changes: [],
      }),
    ).toBe(false)
  })

  it('does not use daemon createDocumentChange for existing non-home documents', () => {
    expect(
      shouldUseDaemonCreateDocumentChange({
        signerAccountUid: 'alice',
        account: 'alice',
        path: '/foo',
        baseVersion: 'bafy-base',
        genesis: 'bafy-genesis',
        changes: [],
      }),
    ).toBe(false)
  })

  it('does not use daemon createDocumentChange for brand-new home documents', () => {
    expect(
      shouldUseDaemonCreateDocumentChange({
        signerAccountUid: 'alice',
        account: 'alice',
        path: '',
        changes: [],
      }),
    ).toBe(false)
  })

  it('keeps documents without a known genesis on the seed client path', () => {
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

  it('keeps explicit-generation publishes on the seed client path', () => {
    expect(
      shouldUseDaemonCreateDocumentChange({
        signerAccountUid: 'alice',
        account: 'alice',
        path: '/foo',
        baseVersion: 'bafy-base',
        genesis: 'bafy-genesis',
        generation: 123,
        changes: [],
      }),
    ).toBe(false)
  })

  it('does not use daemon createDocumentChange for brand-new home documents with explicit generation', () => {
    expect(
      shouldUseDaemonCreateDocumentChange({
        signerAccountUid: 'alice',
        account: 'alice',
        path: '',
        generation: 123,
        changes: [],
      }),
    ).toBe(false)
  })
})

describe('publishDesktopDocument', () => {
  it('uses the seed client PrepareDocumentChange path for existing home documents', async () => {
    const publishDocument = vi.fn().mockResolvedValue(undefined)
    const getSigner = vi.fn()

    await publishDesktopDocument(
      {
        publishDocument,
        getSigner,
      },
      {
        signerAccountUid: 'alice',
        account: 'alice',
        path: '',
        baseVersion: 'bafy-base',
        genesis: 'bafy-genesis',
        changes: [{op: {case: 'setMetadata', value: {key: 'name', value: 'Home'}}}],
      },
    )

    expect(getSigner).toHaveBeenCalledWith('alice')
    expect(publishDocument).toHaveBeenCalled()
  })

  it('uses the seed client PrepareDocumentChange path for existing non-home documents', async () => {
    const publishDocument = vi.fn().mockResolvedValue(undefined)
    const getSigner = vi.fn()

    await publishDesktopDocument(
      {
        publishDocument,
        getSigner,
      },
      {
        signerAccountUid: 'alice',
        account: 'alice',
        path: '/foo',
        baseVersion: 'bafy-base',
        genesis: 'bafy-genesis',
        changes: [{op: {case: 'setMetadata', value: {key: 'name', value: 'Foo'}}}],
      },
    )

    expect(getSigner).toHaveBeenCalledWith('alice')
    expect(publishDocument).toHaveBeenCalled()
  })

  it('uses the seed client path for documents without a known genesis', async () => {
    const publishDocument = vi.fn().mockResolvedValue(undefined)
    const signer = {
      getPublicKey: vi.fn(async () => new Uint8Array([1])),
      sign: vi.fn(async () => new Uint8Array([2])),
    }
    const getSigner = vi.fn(() => signer)

    await publishDesktopDocument(
      {
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

  it('passes explicit generation through the seed client path', async () => {
    const publishDocument = vi.fn().mockResolvedValue(undefined)
    const signer = {
      getPublicKey: vi.fn(async () => new Uint8Array([1])),
      sign: vi.fn(async () => new Uint8Array([2])),
    }
    const getSigner = vi.fn(() => signer)

    await publishDesktopDocument(
      {
        publishDocument,
        getSigner,
      },
      {
        signerAccountUid: 'alice',
        account: 'alice',
        path: '/foo',
        baseVersion: 'bafy-base',
        genesis: 'bafy-genesis',
        generation: 123,
        changes: [{op: {case: 'setMetadata', value: {key: 'name', value: 'Foo'}}}],
      },
    )

    expect(getSigner).toHaveBeenCalledWith('alice')
    expect(publishDocument).toHaveBeenCalledWith(
      {
        account: 'alice',
        path: '/foo',
        baseVersion: 'bafy-base',
        genesis: 'bafy-genesis',
        generation: 123,
        changes: [{op: {case: 'setMetadata', value: {key: 'name', value: 'Foo'}}}],
      },
      signer,
    )
  })
})
