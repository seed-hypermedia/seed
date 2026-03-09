import {describe, it, expect, vi} from 'vitest'
import {decode as cborDecode} from '@ipld/dag-cbor'
import type {HMSigner} from '../src/hm-types'
import {createCapability} from '../src/capability'

function makeSigner(): HMSigner {
  return {
    getPublicKey: async () => new Uint8Array(34).fill(7),
    sign: vi.fn(async () => new Uint8Array(64).fill(9)),
  }
}

const TEST_DELEGATE_UID = 'z6MkrbYsRzKb1VABdvhsDSAk6JK8fAszKsyHhcaZigYeWCou'

describe('createCapability', () => {
  it('creates a publish-ready payload for a new capability', async () => {
    const signer = makeSigner()
    const result = await createCapability({delegateUid: TEST_DELEGATE_UID, role: 'WRITER'}, signer)

    expect(result.blobs).toHaveLength(1)
    expect(result.blobs[0]?.data).toBeInstanceOf(Uint8Array)

    const decoded = cborDecode(result.blobs[0]!.data) as any
    expect(decoded.type).toBe('Capability')
    expect(decoded.role).toBe('WRITER')
    expect(decoded.delegate).toBeInstanceOf(Uint8Array)
    expect(decoded.signer).toBeInstanceOf(Uint8Array)
    expect(decoded.sig).toBeInstanceOf(Uint8Array)
    expect(decoded.sig.length).toBe(64)
    expect(decoded.ts).toBeDefined()
  })

  it('supports AGENT role', async () => {
    const signer = makeSigner()
    const result = await createCapability({delegateUid: TEST_DELEGATE_UID, role: 'AGENT'}, signer)

    const decoded = cborDecode(result.blobs[0]!.data) as any
    expect(decoded.type).toBe('Capability')
    expect(decoded.role).toBe('AGENT')
  })

  it('calls signer with CBOR-encoded data', async () => {
    const signer = makeSigner()
    await createCapability({delegateUid: TEST_DELEGATE_UID, role: 'WRITER'}, signer)

    expect(signer.sign).toHaveBeenCalledOnce()
    const signedData = (signer.sign as any).mock.calls[0][0]
    expect(signedData).toBeInstanceOf(Uint8Array)
  })

  it('includes optional path when provided', async () => {
    const signer = makeSigner()
    const result = await createCapability({delegateUid: TEST_DELEGATE_UID, role: 'WRITER', path: '/docs/paper'}, signer)

    const decoded = cborDecode(result.blobs[0]!.data) as any
    expect(decoded.path).toBe('/docs/paper')
  })

  it('excludes path when not provided', async () => {
    const signer = makeSigner()
    const result = await createCapability({delegateUid: TEST_DELEGATE_UID, role: 'WRITER'}, signer)

    const decoded = cborDecode(result.blobs[0]!.data) as any
    expect(decoded.path).toBeUndefined()
  })

  it('includes optional label when provided', async () => {
    const signer = makeSigner()
    const result = await createCapability(
      {delegateUid: TEST_DELEGATE_UID, role: 'WRITER', label: 'Editor access'},
      signer,
    )

    const decoded = cborDecode(result.blobs[0]!.data) as any
    expect(decoded.label).toBe('Editor access')
  })

  it('excludes label when not provided', async () => {
    const signer = makeSigner()
    const result = await createCapability({delegateUid: TEST_DELEGATE_UID, role: 'WRITER'}, signer)

    const decoded = cborDecode(result.blobs[0]!.data) as any
    expect(decoded.label).toBeUndefined()
  })
})
