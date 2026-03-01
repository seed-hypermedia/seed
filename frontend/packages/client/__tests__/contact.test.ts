import {describe, it, expect, vi} from 'vitest'
import {decode as cborDecode} from '@ipld/dag-cbor'
import type {HMSigner} from '@shm/shared/hm-types'
import {createContact, updateContact, deleteContact, contactRecordIdFromBlob} from '../src/contact'

function makeSigner(): HMSigner {
  return {
    getPublicKey: async () => new Uint8Array(34).fill(7),
    sign: vi.fn(async () => new Uint8Array(64).fill(9)),
  }
}

const TEST_SUBJECT_UID = 'z6MkrbYsRzKb1VABdvhsDSAk6JK8fAszKsyHhcaZigYeWCou'

describe('createContact', () => {
  it('creates a publish-ready payload for a new contact', async () => {
    const signer = makeSigner()
    const result = await createContact({subjectUid: TEST_SUBJECT_UID, name: 'Alice'}, signer)

    expect(result.blobs).toHaveLength(1)
    expect(result.blobs[0]?.data).toBeInstanceOf(Uint8Array)

    const decoded = cborDecode(result.blobs[0]!.data) as any
    expect(decoded.type).toBe('Contact')
    expect(decoded.name).toBe('Alice')
    expect(decoded.subject).toBeInstanceOf(Uint8Array)
    expect(decoded.signer).toBeInstanceOf(Uint8Array)
    // New contacts should NOT have an id field
    expect(decoded.id).toBeUndefined()
    // sig should be filled (not zeros)
    expect(decoded.sig).toBeInstanceOf(Uint8Array)
    expect(decoded.sig.length).toBe(64)
  })

  it('calls signer with CBOR-encoded data', async () => {
    const signer = makeSigner()
    await createContact({subjectUid: TEST_SUBJECT_UID, name: 'Bob'}, signer)

    expect(signer.sign).toHaveBeenCalledOnce()
    const signedData = (signer.sign as any).mock.calls[0][0]
    expect(signedData).toBeInstanceOf(Uint8Array)
  })

  it('returns a recordId in authority/tsid format', async () => {
    const signer = makeSigner()
    const result = await createContact({subjectUid: TEST_SUBJECT_UID, name: 'Carol'}, signer)

    expect(result.recordId).toBeDefined()
    expect(typeof result.recordId).toBe('string')
    // Record ID format: "authority/tsid"
    const parts = result.recordId.split('/')
    expect(parts).toHaveLength(2)
    // Authority is base58btc-encoded signer key (starts with 'z')
    expect(parts[0]).toMatch(/^z/)
    // TSID is 14-15 chars base58btc-encoded (starts with 'z')
    expect(parts[1]).toMatch(/^z/)
    expect(parts[1]!.length).toBeGreaterThanOrEqual(14)
    expect(parts[1]!.length).toBeLessThanOrEqual(15)
  })
})

describe('updateContact', () => {
  it('creates a publish-ready payload with existing TSID', async () => {
    const signer = makeSigner()
    const result = await updateContact(
      {
        contactId: `${TEST_SUBJECT_UID}/zQ3shAbcDe12345`,
        subjectUid: TEST_SUBJECT_UID,
        name: 'Alice Updated',
      },
      signer,
    )

    expect(result.blobs).toHaveLength(1)
    const decoded = cborDecode(result.blobs[0]!.data) as any
    expect(decoded.type).toBe('Contact')
    expect(decoded.name).toBe('Alice Updated')
    expect(decoded.id).toBe('zQ3shAbcDe12345')
    expect(decoded.subject).toBeInstanceOf(Uint8Array)
  })
})

describe('deleteContact', () => {
  it('creates a tombstone blob with no subject or name', async () => {
    const signer = makeSigner()
    const result = await deleteContact({contactId: `${TEST_SUBJECT_UID}/zQ3shAbcDe12345`}, signer)

    expect(result.blobs).toHaveLength(1)
    const decoded = cborDecode(result.blobs[0]!.data) as any
    expect(decoded.type).toBe('Contact')
    expect(decoded.id).toBe('zQ3shAbcDe12345')
    // Tombstone: no subject, no name
    expect(decoded.subject).toBeUndefined()
    expect(decoded.name).toBeUndefined()
  })

  it('throws on invalid contact ID format', async () => {
    const signer = makeSigner()
    await expect(deleteContact({contactId: 'invalid-no-slash'}, signer)).rejects.toThrow('Invalid contact ID format')
  })
})

describe('contactRecordIdFromBlob', () => {
  it('computes the same recordId as createContact', async () => {
    const signer = makeSigner()
    const result = await createContact({subjectUid: TEST_SUBJECT_UID, name: 'Dave'}, signer)

    const recordIdFromBlob = await contactRecordIdFromBlob(result.blobs[0]!.data)
    expect(recordIdFromBlob).toBe(result.recordId)
  })

  it('throws for non-Contact blobs', async () => {
    const {encode} = await import('@ipld/dag-cbor')
    const fakeBlob = encode({type: 'Comment', signer: new Uint8Array(34), sig: new Uint8Array(64), ts: BigInt(0)})
    await expect(contactRecordIdFromBlob(fakeBlob)).rejects.toThrow('Expected Contact blob')
  })
})
