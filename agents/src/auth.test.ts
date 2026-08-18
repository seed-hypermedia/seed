import {Database} from 'bun:sqlite'
import {describe, expect, test} from 'bun:test'
import * as apisvc from '@/api-service'
import * as auth from '@/auth'
import * as cbor from '@/cbor'
import * as sqlite from '@/sqlite'
import * as blobs from '@shm/shared/blobs'

describe('auth', () => {
  test('allows signer equal to account', async () => {
    const db = createInitializedMemoryDatabase()
    try {
      const account = blobs.generateNobleKeyPair()
      const envelope = await apisvc.createSignedEnvelope(account, {action: {_: 'ListAgents'}})
      const verified = auth.verifyEnvelope(db, envelope)
      expect(verified.accountId).toBe(blobs.principalToString(account.principal))
      expect(verified.signerId).toBe(verified.accountId)
    } finally {
      db.close()
    }
  })

  test('allows delegated AGENT signer from local authorization table', async () => {
    const db = createInitializedMemoryDatabase()
    try {
      const account = blobs.generateNobleKeyPair()
      const delegate = blobs.generateNobleKeyPair()
      const accountId = blobs.principalToString(account.principal)
      const delegateId = blobs.principalToString(delegate.principal)
      auth.setLocalAuthorization(db, {accountId, signerId: delegateId, role: 'AGENT', now: 1000})

      const envelope = await apisvc.createSignedEnvelope(delegate, {
        account: account.principal,
        action: {_: 'ListAgents'},
      })
      expect(auth.verifyEnvelope(db, envelope).signerId).toBe(delegateId)
    } finally {
      db.close()
    }
  })

  test('rejects unauthorized signer and tampered action', async () => {
    const db = createInitializedMemoryDatabase()
    try {
      const account = blobs.generateNobleKeyPair()
      const delegate = blobs.generateNobleKeyPair()
      const envelope = await apisvc.createSignedEnvelope(delegate, {
        account: account.principal,
        action: {_: 'ListAgents'},
      })
      expect(() => auth.verifyEnvelope(db, envelope)).toThrow('Signer is not authorized')

      const signedByAccount = await apisvc.createSignedEnvelope(account, {action: {_: 'ListAgents'}})
      signedByAccount.action = {
        _: 'CreateAgent',
        definition: {name: 'bad', systemPrompt: 'tampered', modelProvider: 'openai', model: 'gpt'},
        ts: Date.now(),
      }
      expect(() => auth.verifyEnvelope(db, signedByAccount)).toThrow('Invalid signature')
    } finally {
      db.close()
    }
  })

  test('rejects malformed envelopes', async () => {
    const db = createInitializedMemoryDatabase()
    try {
      const account = blobs.generateNobleKeyPair()
      const envelope = await apisvc.createSignedEnvelope(account, {action: {_: 'ListAgents'}})

      expect(() => auth.verifyEnvelope(db, {...envelope, type: 'Wrong'} as never)).toThrow('Invalid envelope type')
      expect(() => auth.verifyEnvelope(db, {...envelope, signer: new Uint8Array([1, 2])})).toThrow('Invalid signer')
      expect(() =>
        auth.verifyEnvelope(db, {
          ...envelope,
          account: new Uint8Array([0xed, 0x02, ...account.publicKey]),
        }),
      ).toThrow('Invalid account')
      expect(() => auth.verifyEnvelope(db, {...envelope, sig: new Uint8Array(12)})).toThrow('Invalid signature bytes')
      expect(() => auth.verifyEnvelope(db, {...envelope, action: {} as never})).toThrow('Invalid action')
    } finally {
      db.close()
    }
  })

  test('registers a delegated signer from a capability, then delegated envelopes verify', async () => {
    const db = createInitializedMemoryDatabase()
    try {
      const account = blobs.generateNobleKeyPair()
      const device = blobs.generateNobleKeyPair()
      const capability = await blobs.createCapability(account, device.principal, 'AGENT', Date.now(), {
        label: 'Session key for web',
      })

      const registered = auth.registerDelegatedSigner(db, capability.data, device.principal)
      expect(registered.accountId).toBe(blobs.principalToString(account.principal))
      expect(registered.signerId).toBe(blobs.principalToString(device.principal))

      // The whole point: an envelope signed by the device key acting as the account now verifies.
      const envelope = await apisvc.createSignedEnvelope(device, {
        account: account.principal,
        action: {_: 'ListAgents'},
      })
      expect(auth.verifyEnvelope(db, envelope).accountId).toBe(registered.accountId)
    } finally {
      db.close()
    }
  })

  test('accepts a WRITER capability, which is a broader grant than AGENT', async () => {
    const db = createInitializedMemoryDatabase()
    try {
      const account = blobs.generateNobleKeyPair()
      const device = blobs.generateNobleKeyPair()
      const capability = await blobs.createCapability(account, device.principal, 'WRITER', Date.now())
      const registered = auth.registerDelegatedSigner(db, capability.data, device.principal)
      expect(auth.isAuthorizedSigner(db, registered.accountId, registered.signerId)).toBe(true)
    } finally {
      db.close()
    }
  })

  test('rejects a capability replayed by a key it does not delegate to', async () => {
    const db = createInitializedMemoryDatabase()
    try {
      const account = blobs.generateNobleKeyPair()
      const device = blobs.generateNobleKeyPair()
      const attacker = blobs.generateNobleKeyPair()
      const capability = await blobs.createCapability(account, device.principal, 'AGENT', Date.now())
      expect(() => auth.registerDelegatedSigner(db, capability.data, attacker.principal)).toThrow(
        'Capability delegate does not match envelope signer',
      )
      expect(
        auth.isAuthorizedSigner(
          db,
          blobs.principalToString(account.principal),
          blobs.principalToString(device.principal),
        ),
      ).toBe(false)
    } finally {
      db.close()
    }
  })

  test('rejects tampered capability bytes and non-capability blobs', async () => {
    const db = createInitializedMemoryDatabase()
    try {
      const account = blobs.generateNobleKeyPair()
      const device = blobs.generateNobleKeyPair()
      const capability = await blobs.createCapability(account, device.principal, 'AGENT', Date.now())

      // Flip a byte inside the delegate field so the signature no longer covers the content.
      const flippedDelegate = device.principal.map((b, i) => (i === 5 ? b ^ 1 : b)) as blobs.Principal
      const tampered = {...cbor.decode<blobs.Capability>(capability.data), delegate: flippedDelegate}
      expect(() => auth.registerDelegatedSigner(db, cbor.encode(tampered), flippedDelegate)).toThrow(
        'Invalid capability signature',
      )

      expect(() => auth.registerDelegatedSigner(db, cbor.encode({type: 'Profile'}), device.principal)).toThrow(
        'Blob is not a Capability',
      )
      expect(() => auth.registerDelegatedSigner(db, new Uint8Array(), device.principal)).toThrow(
        'Invalid capability bytes',
      )
    } finally {
      db.close()
    }
  })

  test('rejects a role that does not permit agent actions and self-delegation', async () => {
    const db = createInitializedMemoryDatabase()
    try {
      const account = blobs.generateNobleKeyPair()
      const device = blobs.generateNobleKeyPair()
      const badRole = await blobs.createCapability(account, device.principal, 'READER' as blobs.Role, Date.now())
      expect(() => auth.registerDelegatedSigner(db, badRole.data, device.principal)).toThrow(
        'Capability role does not permit agent actions',
      )

      const selfCapability = await blobs.createCapability(account, account.principal, 'AGENT', Date.now())
      expect(() => auth.registerDelegatedSigner(db, selfCapability.data, account.principal)).toThrow(
        'Capability delegates to its own issuer',
      )
    } finally {
      db.close()
    }
  })
})

function createInitializedMemoryDatabase(): Database {
  const db = new Database(':memory:', {create: true, strict: true})
  const result = sqlite.openWithDatabase(db)
  if (!result.ok) throw new Error('unexpected schema mismatch')
  return db
}
