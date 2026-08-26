// Signed blobs end to end (no network): recognizing a signed-blob schema,
// stripping the envelope for the form, and signing a value with a real
// Ed25519 key so the daemon's verification rule (decode, zero sig, re-encode,
// verify) holds for the published bytes.
import * as ed from '@noble/ed25519'
import {sha512} from '@noble/hashes/sha2.js'
import * as cbor from '@shm/shared/cbor'
import {describe, expect, it, vi} from 'vitest'
import {kindUrl, nameToUrl, ONYX_SCHEMAS, validate} from '../onyx-engine'
import {
  isSignedBlobSchema,
  publishSignedBlob,
  signBlob,
  signedBlobTypeTag,
  stripSignedBlobEnvelope,
} from '../signed-blob'
;(ed as any).etc.sha512Sync = (...m: Uint8Array[]) => sha512((ed as any).etc.concatBytes(...m))

const ENVELOPE = nameToUrl('hypermedia-blob')!
/** A user-defined signed type: a Vote on a document. */
const VOTE = {
  name: 'Vote',
  ref: ENVELOPE,
  required: ['type', 'target', 'choice'],
  properties: {
    type: {type: kindUrl('string'), enum: ['Vote']},
    target: {ref: nameToUrl('hypermedia-hm-url')!},
    choice: {type: kindUrl('string'), enum: ['yes', 'no']},
  },
}

function testSigner() {
  const priv = ed.utils.randomPrivateKey()
  const pub = ed.getPublicKey(priv)
  // A Seed principal is the multicodec-prefixed Ed25519 public key (0xed 0x01).
  const principal = new Uint8Array([0xed, 0x01, ...pub])
  return {
    pub,
    signer: {getPublicKey: async () => principal, sign: async (data: Uint8Array) => ed.sign(data, priv)},
  }
}

describe('signed-blob schemas', () => {
  it('recognizes the built-in blob types and a user-defined extension', () => {
    expect(isSignedBlobSchema(ONYX_SCHEMAS['hypermedia-change'])).toBe(true)
    expect(isSignedBlobSchema(ONYX_SCHEMAS['hypermedia-capability'])).toBe(true)
    expect(isSignedBlobSchema(VOTE)).toBe(true)
    expect(isSignedBlobSchema(ONYX_SCHEMAS['example-person'])).toBe(false)
    expect(isSignedBlobSchema(ONYX_SCHEMAS['example-character-doc'])).toBe(false)
  })
  it('reads the pinned type tag', () => {
    expect(signedBlobTypeTag(VOTE)).toBe('Vote')
    expect(signedBlobTypeTag(ONYX_SCHEMAS['hypermedia-comment'])).toBe('Comment')
    expect(signedBlobTypeTag(ONYX_SCHEMAS['hypermedia-blob'])).toBeUndefined()
  })
  it('strips the envelope and the pinned type from the form schema', () => {
    const body = stripSignedBlobEnvelope(VOTE)
    expect(Object.keys(body.properties)).toEqual(['target', 'choice'])
    expect(body.required).toEqual(['target', 'choice'])
    expect(validate(body, {target: 'hm://x/y', choice: 'yes'})).toEqual([])
  })
})

describe('signBlob', () => {
  it('produces a blob whose signature verifies over the canonical CBOR with sig zeroed', async () => {
    const {pub, signer} = testSigner()
    const result = await signBlob(signer, {target: 'hm://x/y', choice: 'yes'}, {typeTag: 'Vote', ts: 1_700_000_000_000})
    expect(result.cid).toMatch(/^bafyrei/)
    const blob = cbor.decode(result.data) as Record<string, unknown>
    expect(blob.type).toBe('Vote')
    expect(blob.ts).toBe(1_700_000_000_000)
    expect(blob.choice).toBe('yes')
    expect((blob.signer as Uint8Array).length).toBe(34)
    expect((blob.sig as Uint8Array).length).toBe(64)
    // The daemon's rule: decode, zero the signature, re-encode, verify.
    const sig = blob.sig as Uint8Array
    const unsigned = {...blob, sig: new Uint8Array(64)}
    expect(ed.verify(sig, new Uint8Array(cbor.encode(unsigned)), pub)).toBe(true)
    // …and the full value conforms to the Vote schema (dag-json view of bytes is irrelevant to validate's kinds).
    expect(validate(VOTE, {...blob, signer: {'/': {bytes: 'x'}}, sig: {'/': {bytes: 'x'}}})).toEqual([])
  })
  it('key order does not matter — canonical CBOR sorts it', async () => {
    const {signer} = testSigner()
    const a = await signBlob(signer, {choice: 'yes', target: 'hm://x/y'}, {typeTag: 'Vote', ts: 1})
    const b = await signBlob(signer, {target: 'hm://x/y', choice: 'yes'}, {typeTag: 'Vote', ts: 1})
    // Ed25519 is deterministic, so identical bodies give identical blobs.
    expect(a.cid).toBe(b.cid)
  })
})

describe('publishSignedBlob', () => {
  it('publishes the signed bytes through the client', async () => {
    const {signer} = testSigner()
    const request = vi.fn(async () => ({}))
    const result = await publishSignedBlob(
      {request} as any,
      signer,
      {choice: 'no', target: 'hm://x/y'},
      {typeTag: 'Vote'},
    )
    expect(request).toHaveBeenCalledWith('PublishBlobs', {blobs: [{cid: result.cid, data: result.data}]})
  })
  it('refuses a type tag that collides with a built-in blob type it does not match', async () => {
    const {signer} = testSigner()
    const request = vi.fn(async () => ({}))
    await expect(publishSignedBlob({request} as any, signer, {choice: 'no'}, {typeTag: 'Change'})).rejects.toThrow(
      /collides/,
    )
    expect(request).not.toHaveBeenCalled()
  })
})
