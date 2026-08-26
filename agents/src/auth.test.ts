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
      const verified = await auth.verifyEnvelope(db, envelope)
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
      expect((await auth.verifyEnvelope(db, envelope)).signerId).toBe(delegateId)
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
      await expect(auth.verifyEnvelope(db, envelope)).rejects.toThrow('Signer is not authorized')

      const signedByAccount = await apisvc.createSignedEnvelope(account, {action: {_: 'ListAgents'}})
      signedByAccount.action = {
        _: 'CreateAgent',
        definition: {name: 'bad', systemPrompt: 'tampered', modelProvider: 'openai', model: 'gpt'},
        ts: Date.now(),
      }
      await expect(auth.verifyEnvelope(db, signedByAccount)).rejects.toThrow('Invalid signature')
    } finally {
      db.close()
    }
  })

  test('rejects malformed envelopes', async () => {
    const db = createInitializedMemoryDatabase()
    try {
      const account = blobs.generateNobleKeyPair()
      const envelope = await apisvc.createSignedEnvelope(account, {action: {_: 'ListAgents'}})

      await expect(auth.verifyEnvelope(db, {...envelope, type: 'Wrong'} as never)).rejects.toThrow(
        'Invalid envelope type',
      )
      await expect(auth.verifyEnvelope(db, {...envelope, signer: new Uint8Array([1, 2])})).rejects.toThrow(
        'Invalid signer',
      )
      await expect(
        auth.verifyEnvelope(db, {
          ...envelope,
          account: new Uint8Array([0xed, 0x02, ...account.publicKey]),
        }),
      ).rejects.toThrow('Invalid account')
      await expect(auth.verifyEnvelope(db, {...envelope, sig: new Uint8Array(12)})).rejects.toThrow(
        'Invalid signature bytes',
      )
      await expect(auth.verifyEnvelope(db, {...envelope, action: {} as never})).rejects.toThrow('Invalid action')
    } finally {
      db.close()
    }
  })

  describe('delegation carried in the envelope', () => {
    test('verifies a delegated envelope from inline capability bytes and remembers the delegation', async () => {
      const db = createInitializedMemoryDatabase()
      try {
        const {account, device, capability} = await makeDelegation()
        const envelope = await apisvc.createSignedEnvelope(device, {
          account: account.principal,
          capability: capability.cid.toString(),
          capabilityBlob: capability.data,
          action: {_: 'ListAgents'},
        })

        const verified = await auth.verifyEnvelope(db, envelope)
        expect(verified.accountId).toBe(blobs.principalToString(account.principal))
        expect(verified.signerId).toBe(blobs.principalToString(device.principal))

        // Remembered by CID, so the next envelope needs neither the bytes nor the network.
        const row = db
          .query<{capability_cid: string}, [string, string]>(
            `SELECT capability_cid FROM account_authorizations WHERE account_id = ? AND signer = ?`,
          )
          .get(verified.accountId, verified.signerId)
        expect(row?.capability_cid).toBe(capability.cid.toString())
        const bare = await apisvc.createSignedEnvelope(device, {
          account: account.principal,
          capability: capability.cid.toString(),
          action: {_: 'ListAgents'},
        })
        expect((await auth.verifyEnvelope(db, bare)).accountId).toBe(verified.accountId)
      } finally {
        db.close()
      }
    })

    test('fetches the capability from the HM network when the envelope carries only the CID', async () => {
      const db = createInitializedMemoryDatabase()
      try {
        const {account, device, capability} = await makeDelegation()
        const envelope = await apisvc.createSignedEnvelope(device, {
          account: account.principal,
          capability: capability.cid.toString(),
          action: {_: 'ListAgents'},
        })

        const requested: string[] = []
        const fetchCapability = async (cid: string) => {
          requested.push(cid)
          return cid === capability.cid.toString() ? capability.data : null
        }
        const verified = await auth.verifyEnvelope(db, envelope, {fetchCapability})
        expect(verified.accountId).toBe(blobs.principalToString(account.principal))
        expect(requested).toEqual([capability.cid.toString()])

        // The second envelope is served from the remembered delegation: no fetch.
        const again = await apisvc.createSignedEnvelope(device, {
          account: account.principal,
          capability: capability.cid.toString(),
          action: {_: 'ListAgents'},
        })
        await auth.verifyEnvelope(db, again, {fetchCapability})
        expect(requested).toHaveLength(1)
      } finally {
        db.close()
      }
    })

    test('reports a capability the network does not have, or that this server cannot fetch', async () => {
      const db = createInitializedMemoryDatabase()
      try {
        const {account, device, capability} = await makeDelegation()
        const envelope = await apisvc.createSignedEnvelope(device, {
          account: account.principal,
          capability: capability.cid.toString(),
          action: {_: 'ListAgents'},
        })
        await expect(auth.verifyEnvelope(db, envelope, {fetchCapability: async () => null})).rejects.toThrow(
          'is not available on the HM network',
        )
        await expect(
          auth.verifyEnvelope(db, envelope, {
            fetchCapability: async () => {
              throw new Error('gateway down')
            },
          }),
        ).rejects.toThrow('Failed to fetch capability')
        await expect(auth.verifyEnvelope(db, envelope)).rejects.toThrow('not available to this server')
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

    test('rejects inline bytes that are not the blob the envelope names', async () => {
      const db = createInitializedMemoryDatabase()
      try {
        const {account, device, capability} = await makeDelegation()
        const other = await blobs.createCapability(account, device.principal, 'AGENT', Date.now() - 1)
        expect(other.cid.toString()).not.toBe(capability.cid.toString())

        const envelope = await apisvc.createSignedEnvelope(device, {
          account: account.principal,
          capability: capability.cid.toString(),
          capabilityBlob: other.data,
          action: {_: 'ListAgents'},
        })
        await expect(auth.verifyEnvelope(db, envelope)).rejects.toThrow('do not match the envelope capability CID')
      } finally {
        db.close()
      }
    })

    test('rejects a capability issued by an account other than the one the envelope acts as', async () => {
      const db = createInitializedMemoryDatabase()
      try {
        const {device, capability} = await makeDelegation()
        const victim = blobs.generateNobleKeyPair()
        const envelope = await apisvc.createSignedEnvelope(device, {
          account: victim.principal,
          capability: capability.cid.toString(),
          capabilityBlob: capability.data,
          action: {_: 'ListAgents'},
        })
        await expect(auth.verifyEnvelope(db, envelope)).rejects.toThrow('not issued by the envelope account')
        expect(
          auth.isAuthorizedSigner(
            db,
            blobs.principalToString(victim.principal),
            blobs.principalToString(device.principal),
          ),
        ).toBe(false)
      } finally {
        db.close()
      }
    })

    test('rejects a published capability replayed by a key it does not delegate to', async () => {
      const db = createInitializedMemoryDatabase()
      try {
        const {account, capability} = await makeDelegation()
        const attacker = blobs.generateNobleKeyPair()
        const envelope = await apisvc.createSignedEnvelope(attacker, {
          account: account.principal,
          capability: capability.cid.toString(),
          capabilityBlob: capability.data,
          action: {_: 'ListAgents'},
        })
        await expect(auth.verifyEnvelope(db, envelope)).rejects.toThrow(
          'Capability delegate does not match envelope signer',
        )
      } finally {
        db.close()
      }
    })

    test('the capability reference is covered by the envelope signature', async () => {
      const db = createInitializedMemoryDatabase()
      try {
        const {account, device, capability} = await makeDelegation()
        const envelope = await apisvc.createSignedEnvelope(device, {
          account: account.principal,
          action: {_: 'ListAgents'},
        })
        const spliced = {...envelope, capability: capability.cid.toString(), capabilityBlob: capability.data}
        await expect(auth.verifyEnvelope(db, spliced)).rejects.toThrow('Invalid signature')
      } finally {
        db.close()
      }
    })

    test('rejects a malformed capability CID', async () => {
      const db = createInitializedMemoryDatabase()
      try {
        const {account, device, capability} = await makeDelegation()
        const envelope = await apisvc.createSignedEnvelope(device, {
          account: account.principal,
          capability: '../not-a-cid',
          capabilityBlob: capability.data,
          action: {_: 'ListAgents'},
        })
        await expect(auth.verifyEnvelope(db, envelope)).rejects.toThrow('Invalid capability CID')
      } finally {
        db.close()
      }
    })
  })

  describe('legacy RegisterSigner', () => {
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
        expect((await auth.verifyEnvelope(db, envelope)).accountId).toBe(registered.accountId)
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
})

/** An account that delegated AGENT to a device key, as the vault does for a web session. */
async function makeDelegation() {
  const account = blobs.generateNobleKeyPair()
  const device = blobs.generateNobleKeyPair()
  const capability = await blobs.createCapability(account, device.principal, 'AGENT', Date.now(), {
    label: 'Session key for web',
  })
  return {account, device, capability}
}

function createInitializedMemoryDatabase(): Database {
  const db = new Database(':memory:', {create: true, strict: true})
  const result = sqlite.openWithDatabase(db)
  if (!result.ok) throw new Error('unexpected schema mismatch')
  return db
}
