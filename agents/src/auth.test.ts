import {Database} from 'bun:sqlite'
import {describe, expect, test} from 'bun:test'
import * as apisvc from '@/api-service'
import * as auth from '@/auth'
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
})

function createInitializedMemoryDatabase(): Database {
  const db = new Database(':memory:', {create: true, strict: true})
  const result = sqlite.openWithDatabase(db)
  if (!result.ok) throw new Error('unexpected schema mismatch')
  return db
}
