import type {HMCapability, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {describe, expect, it} from 'vitest'

import {resolveWebCanEdit} from './use-web-can-edit'

const OWNER_UID = 'z6OWNER'
const ALICE_UID = 'z6ALICE'
const BOB_UID = 'z6BOB'
const SITE_UID = 'z6SITE'

function makeDocId(uid: string, path: string[] = []): UnpackedHypermediaId {
  return {
    uid,
    path,
    id: `hm://${uid}${path.length ? '/' + path.join('/') : ''}`,
    version: null,
    blockRef: null,
    blockRange: null,
    hostname: null,
    scheme: 'hm',
    latest: false,
  } as UnpackedHypermediaId
}

function ownerCap(uid: string): HMCapability {
  return {
    id: '_owner',
    accountUid: uid,
    role: 'owner',
    grantId: makeDocId(uid),
    createTime: {seconds: 0, nanos: 0},
  } as HMCapability
}

function writerCap(uid: string): HMCapability {
  return {
    id: 'cap-writer',
    accountUid: uid,
    role: 'writer',
    grantId: makeDocId(uid),
    createTime: {seconds: 0, nanos: 0},
  } as HMCapability
}

describe('resolveWebCanEdit', () => {
  it('SSR-safe: returns false when not in browser', () => {
    const result = resolveWebCanEdit({
      docId: makeDocId(OWNER_UID),
      delegatedAccountUid: OWNER_UID,
      origin: null,
      originHomeId: null,
      capabilities: [ownerCap(OWNER_UID)],
      isBrowser: false,
    })
    expect(result).toEqual({canEdit: false, signingAccountId: null, capability: null})
  })

  it('no logged-in user → cannot edit', () => {
    const result = resolveWebCanEdit({
      docId: makeDocId(OWNER_UID),
      delegatedAccountUid: null,
      origin: null,
      originHomeId: null,
      capabilities: [],
      isBrowser: true,
    })
    expect(result.canEdit).toBe(false)
    expect(result.signingAccountId).toBe(null)
  })

  it('local-only key (undefined delegated) → cannot edit', () => {
    const result = resolveWebCanEdit({
      docId: makeDocId(OWNER_UID),
      delegatedAccountUid: undefined,
      origin: null,
      originHomeId: null,
      capabilities: [ownerCap(OWNER_UID)],
      isBrowser: true,
    })
    expect(result.canEdit).toBe(false)
    expect(result.signingAccountId).toBe(null)
  })

  it('owner can edit before capabilities finish loading', () => {
    const result = resolveWebCanEdit({
      docId: makeDocId(OWNER_UID),
      delegatedAccountUid: OWNER_UID,
      origin: null,
      originHomeId: null,
      capabilities: undefined,
      isBrowser: true,
    })
    expect(result.canEdit).toBe(true)
    expect(result.signingAccountId).toBe(OWNER_UID)
    expect(result.capability?.id).toBe('_owner')
  })

  it('owner on gateway can edit', () => {
    const result = resolveWebCanEdit({
      docId: makeDocId(OWNER_UID),
      delegatedAccountUid: OWNER_UID,
      origin: null,
      originHomeId: null,
      capabilities: [ownerCap(OWNER_UID)],
      isBrowser: true,
    })
    expect(result.canEdit).toBe(true)
    expect(result.signingAccountId).toBe(OWNER_UID)
    expect(result.capability?.role).toBe('owner')
  })

  it('writer-cap on gateway can edit', () => {
    const result = resolveWebCanEdit({
      docId: makeDocId(OWNER_UID),
      delegatedAccountUid: ALICE_UID,
      origin: null,
      originHomeId: null,
      capabilities: [ownerCap(OWNER_UID), writerCap(ALICE_UID)],
      isBrowser: true,
    })
    expect(result.canEdit).toBe(true)
    expect(result.capability?.role).toBe('writer')
  })

  it('non-cap user on gateway cannot edit', () => {
    const result = resolveWebCanEdit({
      docId: makeDocId(OWNER_UID),
      delegatedAccountUid: BOB_UID,
      origin: null,
      originHomeId: null,
      capabilities: [ownerCap(OWNER_UID), writerCap(ALICE_UID)],
      isBrowser: true,
    })
    expect(result.canEdit).toBe(false)
    expect(result.signingAccountId).toBe(BOB_UID)
    expect(result.capability).toBe(null)
  })

  it('owner on custom-domain (own home) can edit', () => {
    const result = resolveWebCanEdit({
      docId: makeDocId(SITE_UID),
      delegatedAccountUid: SITE_UID,
      origin: 'https://my-site.example',
      originHomeId: makeDocId(SITE_UID),
      capabilities: [ownerCap(SITE_UID)],
      isBrowser: true,
    })
    expect(result.canEdit).toBe(true)
  })

  it('writer-cap on custom-domain site doc can edit', () => {
    const result = resolveWebCanEdit({
      docId: makeDocId(SITE_UID),
      delegatedAccountUid: ALICE_UID,
      origin: 'https://my-site.example',
      originHomeId: makeDocId(SITE_UID),
      capabilities: [ownerCap(SITE_UID), writerCap(ALICE_UID)],
      isBrowser: true,
    })
    expect(result.canEdit).toBe(true)
  })

  it('off-site doc on custom-domain blocked even with capability', () => {
    const result = resolveWebCanEdit({
      docId: makeDocId(OWNER_UID),
      delegatedAccountUid: ALICE_UID,
      origin: 'https://my-site.example',
      originHomeId: makeDocId(SITE_UID),
      capabilities: [ownerCap(OWNER_UID), writerCap(ALICE_UID)],
      isBrowser: true,
    })
    expect(result.canEdit).toBe(false)
    expect(result.capability?.role).toBe('writer')
  })
})
