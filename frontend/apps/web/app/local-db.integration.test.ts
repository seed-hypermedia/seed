// Set up test environment mocks
const TEST_ORIGIN = 'http://localhost:3000'

// Mock the window object
global.window = {
  ...global.window,
  location: {
    origin: TEST_ORIGIN,
    reload: vi.fn(),
  },
} as any

// Mock the origin variable that local-db.ts uses
;(global as any).origin = TEST_ORIGIN

import {indexedDB} from 'fake-indexeddb'
import 'fake-indexeddb/auto'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {
  AUTH_STATE_ACTIVE_VAULT_URL,
  AUTH_STATE_DELEGATION_RETURN_URL,
  AUTH_STATE_DELEGATION_VAULT_URL,
  type DBSessionRecord,
  type PendingCommentIntent,
  type PendingIntent,
  clearAllAuthState,
  clearPendingIntent,
  deleteAuthSession,
  deleteAuthState,
  deleteLocalKeys,
  getAuthSession,
  getAuthState,
  getPendingIntent,
  getStoredLocalKeys,
  hasPromptedEmailNotifications,
  putAuthSession,
  resetDB,
  setAuthState,
  setHasPromptedEmailNotifications,
  setPendingIntent,
  writeLocalKeys,
} from './local-db'

const DB_NAME = 'keyStore-04'

async function generateEd25519KeyPair(): Promise<CryptoKeyPair> {
  return (await crypto.subtle.generateKey('Ed25519' as unknown as AlgorithmIdentifier, false, [
    'sign',
    'verify',
  ])) as CryptoKeyPair
}

async function generateEcdsaKeyPair(): Promise<CryptoKeyPair> {
  return await crypto.subtle.generateKey({name: 'ECDSA', namedCurve: 'P-256'}, false, ['sign', 'verify'])
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function createLegacyV8Db(keyPair?: CryptoKeyPair): Promise<void> {
  const request = indexedDB.open(DB_NAME, 8)
  request.onupgradeneeded = () => {
    const db = request.result
    const keys = db.createObjectStore('keys-01')
    db.createObjectStore('email-notifications-01')
    db.createObjectStore('auth-sessions-01')
    db.createObjectStore('auth-state-01')
    db.createObjectStore('pending-intent-01')

    // This store mirrors the app-level migration experiment that existed
    // locally before v9 switched back to IndexedDB-versioned migrations.
    const migrations = db.createObjectStore('migrations-01')
    migrations.put(1, 'local_db_migration_version')

    if (keyPair) {
      keys.put(keyPair.privateKey, 'privateKey')
      keys.put(keyPair.publicKey, 'publicKey')
      keys.put('acc1', 'delegatedAccountUid')
      keys.put('https://vault.example.com', 'vaultUrl')
    }
  }
  const db = await requestToPromise(request)
  db.close()
}

describe('local-db integration', () => {
  beforeEach(async () => {
    vi.mocked(window.location.reload).mockClear()
    await new Promise<void>((resolve) => {
      const deleteRequest = indexedDB.deleteDatabase(DB_NAME)
      deleteRequest.onsuccess = () => resolve()
      deleteRequest.onerror = () => resolve()
    })
  })

  afterEach(async () => {
    await new Promise<void>((resolve) => {
      const deleteRequest = indexedDB.deleteDatabase(DB_NAME)
      deleteRequest.onsuccess = () => resolve()
      deleteRequest.onerror = () => resolve()
    })
  })

  it('should initialize the database with correct version and stores', async () => {
    const db = await resetDB(indexedDB)
    try {
      expect(db.version).toBe(9)
      const storeNames = Array.from(db.objectStoreNames)
      expect(storeNames).toContain('keys-01')
      expect(storeNames).toContain('email-notifications-01')
      expect(storeNames).toContain('auth-sessions-01')
      expect(storeNames).toContain('auth-state-01')
      expect(storeNames).toContain('pending-intent-01')
      expect(storeNames).not.toContain('migrations-01')
    } finally {
      db.close()
    }
  })

  describe('database upgrades', () => {
    it('deletes the development migration store when upgrading from v8', async () => {
      await createLegacyV8Db()

      const db = await resetDB(indexedDB)
      try {
        expect(db.version).toBe(9)
        expect(Array.from(db.objectStoreNames)).not.toContain('migrations-01')
      } finally {
        db.close()
      }
    })

    it('clears legacy ECDSA local keys during the v9 upgrade and requests a reload', async () => {
      await createLegacyV8Db(await generateEcdsaKeyPair())

      const db = await resetDB(indexedDB)
      try {
        expect(await getStoredLocalKeys()).toBeNull()
        expect(window.location.reload).toHaveBeenCalledTimes(1)
      } finally {
        db.close()
      }
    })

    it('keeps Ed25519 local keys during the v9 upgrade', async () => {
      await createLegacyV8Db(await generateEd25519KeyPair())

      const db = await resetDB(indexedDB)
      try {
        const stored = await getStoredLocalKeys()
        expect(stored).not.toBeNull()
        expect(stored!.keyPair.privateKey.algorithm.name).toBe('Ed25519')
        expect(window.location.reload).not.toHaveBeenCalled()
      } finally {
        db.close()
      }
    })
  })

  describe('local keys', () => {
    it('should return null when no keys are stored', async () => {
      const db = await resetDB(indexedDB)
      try {
        const keys = await getStoredLocalKeys()
        expect(keys).toBeNull()
      } finally {
        db.close()
      }
    })

    it('should write and read local keys', async () => {
      const db = await resetDB(indexedDB)
      try {
        const keyPair = await generateEd25519KeyPair()
        await writeLocalKeys(keyPair, {
          delegatedAccountUid: 'acc1',
          vaultUrl: 'https://vault.example.com',
          notifyServerUrl: 'https://notify.example.com',
        })
        const stored = await getStoredLocalKeys()
        expect(stored).not.toBeNull()
        expect(stored!.keyPair.privateKey.type).toBe('private')
        expect(stored!.keyPair.publicKey.type).toBe('public')
        expect(stored!.keyPair.privateKey.algorithm).toEqual(keyPair.privateKey.algorithm)
        expect(stored!.keyPair.publicKey.algorithm).toEqual(keyPair.publicKey.algorithm)
        expect(stored!.delegatedAccountUid).toBe('acc1')
        expect(stored!.vaultUrl).toBe('https://vault.example.com')
        expect(stored!.notifyServerUrl).toBe('https://notify.example.com')
      } finally {
        db.close()
      }
    })

    it('should read older local keys without a notify server URL', async () => {
      const db = await resetDB(indexedDB)
      try {
        const keyPair = await generateEd25519KeyPair()
        await writeLocalKeys(keyPair, {
          delegatedAccountUid: 'acc1',
          vaultUrl: 'https://vault.example.com',
        })

        const stored = await getStoredLocalKeys()
        expect(stored).not.toBeNull()
        expect(stored!.delegatedAccountUid).toBe('acc1')
        expect(stored!.vaultUrl).toBe('https://vault.example.com')
        expect(stored!.notifyServerUrl).toBeUndefined()
      } finally {
        db.close()
      }
    })

    it('should delete local keys', async () => {
      const db = await resetDB(indexedDB)
      try {
        const keyPair = await generateEd25519KeyPair()
        await writeLocalKeys(keyPair)
        expect(await getStoredLocalKeys()).not.toBeNull()
        await deleteLocalKeys()
        expect(await getStoredLocalKeys()).toBeNull()
      } finally {
        db.close()
      }
    })

    it('clears delegated metadata when replacing the local key pair', async () => {
      const db = await resetDB(indexedDB)
      try {
        const delegatedKeyPair = await generateEd25519KeyPair()
        await writeLocalKeys(delegatedKeyPair, {
          delegatedAccountUid: 'acc1',
          vaultUrl: 'https://vault.example.com',
          notifyServerUrl: 'https://notify.example.com',
        })

        const localKeyPair = await generateEd25519KeyPair()
        await writeLocalKeys(localKeyPair)

        const stored = await getStoredLocalKeys()
        expect(stored).not.toBeNull()
        expect(stored!.delegatedAccountUid).toBeUndefined()
        expect(stored!.vaultUrl).toBeUndefined()
        expect(stored!.notifyServerUrl).toBeUndefined()
      } finally {
        db.close()
      }
    })
  })

  describe('email notifications', () => {
    it('should default to false when not set', async () => {
      const db = await resetDB(indexedDB)
      try {
        expect(await hasPromptedEmailNotifications()).toBe(false)
      } finally {
        db.close()
      }
    })

    it('should set and read email notification prompt status', async () => {
      const db = await resetDB(indexedDB)
      try {
        await setHasPromptedEmailNotifications(true)
        expect(await hasPromptedEmailNotifications()).toBe(true)
        await setHasPromptedEmailNotifications(false)
        expect(await hasPromptedEmailNotifications()).toBe(false)
      } finally {
        db.close()
      }
    })
  })

  describe('auth sessions', () => {
    it('should return undefined when no session exists', async () => {
      const db = await resetDB(indexedDB)
      try {
        const session = await getAuthSession('https://example.com/vault')
        expect(session).toBeUndefined()
      } finally {
        db.close()
      }
    })

    it('should store and retrieve an auth session', async () => {
      const db = await resetDB(indexedDB)
      try {
        const keyPair = await generateEd25519KeyPair()
        const record: DBSessionRecord = {
          keyPair,
          publicKeyRaw: new Uint8Array([1, 2, 3]),
          principal: 'test-principal',
          vaultUrl: 'https://example.com/vault',
          createTime: Date.now(),
          authState: 'some-state',
          authStartTime: Date.now(),
        }
        await putAuthSession('https://example.com/vault', record)
        const stored = await getAuthSession('https://example.com/vault')
        expect(stored).toBeDefined()
        expect(stored!.principal).toBe('test-principal')
        expect(stored!.vaultUrl).toBe('https://example.com/vault')
        expect(stored!.authState).toBe('some-state')
      } finally {
        db.close()
      }
    })

    it('should delete an auth session', async () => {
      const db = await resetDB(indexedDB)
      try {
        const keyPair = await generateEd25519KeyPair()
        const record: DBSessionRecord = {
          keyPair,
          publicKeyRaw: new Uint8Array([1, 2, 3]),
          principal: 'test-principal',
          vaultUrl: 'https://example.com/vault',
          createTime: Date.now(),
          authState: null,
          authStartTime: null,
        }
        await putAuthSession('https://example.com/vault', record)
        expect(await getAuthSession('https://example.com/vault')).toBeDefined()
        await deleteAuthSession('https://example.com/vault')
        expect(await getAuthSession('https://example.com/vault')).toBeUndefined()
      } finally {
        db.close()
      }
    })

    it('should store sessions keyed by vault URL independently', async () => {
      const db = await resetDB(indexedDB)
      try {
        const keyPair = await generateEd25519KeyPair()
        const record1: DBSessionRecord = {
          keyPair,
          publicKeyRaw: new Uint8Array([1]),
          principal: 'principal-1',
          vaultUrl: 'https://example.com/vault-1',
          createTime: Date.now(),
          authState: null,
          authStartTime: null,
        }
        const record2: DBSessionRecord = {
          keyPair,
          publicKeyRaw: new Uint8Array([2]),
          principal: 'principal-2',
          vaultUrl: 'https://example.com/vault-2',
          createTime: Date.now(),
          authState: null,
          authStartTime: null,
        }
        await putAuthSession('https://example.com/vault-1', record1)
        await putAuthSession('https://example.com/vault-2', record2)

        const stored1 = await getAuthSession('https://example.com/vault-1')
        const stored2 = await getAuthSession('https://example.com/vault-2')
        expect(stored1!.principal).toBe('principal-1')
        expect(stored2!.principal).toBe('principal-2')

        await deleteAuthSession('https://example.com/vault-1')
        expect(await getAuthSession('https://example.com/vault-1')).toBeUndefined()
        expect(await getAuthSession('https://example.com/vault-2')).toBeDefined()
      } finally {
        db.close()
      }
    })
  })

  describe('auth state', () => {
    it('should return null when no state exists', async () => {
      const db = await resetDB(indexedDB)
      try {
        const value = await getAuthState(AUTH_STATE_ACTIVE_VAULT_URL)
        expect(value).toBeNull()
      } finally {
        db.close()
      }
    })

    it('should set and get auth state', async () => {
      const db = await resetDB(indexedDB)
      try {
        await setAuthState(AUTH_STATE_ACTIVE_VAULT_URL, 'https://example.com/vault')
        const value = await getAuthState(AUTH_STATE_ACTIVE_VAULT_URL)
        expect(value).toBe('https://example.com/vault')
      } finally {
        db.close()
      }
    })

    it('should delete auth state', async () => {
      const db = await resetDB(indexedDB)
      try {
        await setAuthState(AUTH_STATE_ACTIVE_VAULT_URL, 'https://example.com/vault')
        await deleteAuthState(AUTH_STATE_ACTIVE_VAULT_URL)
        expect(await getAuthState(AUTH_STATE_ACTIVE_VAULT_URL)).toBeNull()
      } finally {
        db.close()
      }
    })

    it('should clear all auth state', async () => {
      const db = await resetDB(indexedDB)
      try {
        await setAuthState(AUTH_STATE_ACTIVE_VAULT_URL, 'https://example.com/vault')
        await setAuthState(AUTH_STATE_DELEGATION_RETURN_URL, '/some/path')
        await setAuthState(AUTH_STATE_DELEGATION_VAULT_URL, 'https://example.com/vault/delegate')
        await clearAllAuthState()
        expect(await getAuthState(AUTH_STATE_ACTIVE_VAULT_URL)).toBeNull()
        expect(await getAuthState(AUTH_STATE_DELEGATION_RETURN_URL)).toBeNull()
        expect(await getAuthState(AUTH_STATE_DELEGATION_VAULT_URL)).toBeNull()
      } finally {
        db.close()
      }
    })

    it('should store multiple state keys independently', async () => {
      const db = await resetDB(indexedDB)
      try {
        await setAuthState(AUTH_STATE_ACTIVE_VAULT_URL, 'vault-url')
        await setAuthState(AUTH_STATE_DELEGATION_RETURN_URL, '/return')
        expect(await getAuthState(AUTH_STATE_ACTIVE_VAULT_URL)).toBe('vault-url')
        expect(await getAuthState(AUTH_STATE_DELEGATION_RETURN_URL)).toBe('/return')

        await deleteAuthState(AUTH_STATE_ACTIVE_VAULT_URL)
        expect(await getAuthState(AUTH_STATE_ACTIVE_VAULT_URL)).toBeNull()
        expect(await getAuthState(AUTH_STATE_DELEGATION_RETURN_URL)).toBe('/return')
      } finally {
        db.close()
      }
    })
  })

  describe('pending intent', () => {
    it('should return null when no intent is stored', async () => {
      const db = await resetDB(indexedDB)
      try {
        expect(await getPendingIntent()).toBeNull()
      } finally {
        db.close()
      }
    })

    it('should store and retrieve a join intent', async () => {
      const db = await resetDB(indexedDB)
      try {
        const intent: PendingIntent = {type: 'join', subjectUid: 'test-uid'}
        await setPendingIntent(intent)
        const stored = await getPendingIntent()
        expect(stored).toEqual({type: 'join', subjectUid: 'test-uid'})
      } finally {
        db.close()
      }
    })

    it('should store and retrieve a comment intent', async () => {
      const db = await resetDB(indexedDB)
      try {
        const intent: PendingCommentIntent = {
          type: 'comment',
          docId: {
            id: 'hm://abc',
            uid: 'abc',
            path: [],
            version: null,
            blockRef: null,
            blockRange: null,
            hostname: null,
            scheme: null,
          },
          docVersion: 'v1.v2',
          content: [{block: {id: 'b1', type: 'Paragraph', text: 'hello', attributes: {}}}],
          replyCommentVersion: 'rv1',
          rootReplyCommentVersion: 'rrv1',
          quotingBlockId: 'qb1',
        }
        await setPendingIntent(intent)
        const stored = await getPendingIntent()
        expect(stored).toEqual(intent)
      } finally {
        db.close()
      }
    })

    it('should clear pending intent', async () => {
      const db = await resetDB(indexedDB)
      try {
        await setPendingIntent({type: 'join', subjectUid: 'test-uid'})
        expect(await getPendingIntent()).not.toBeNull()
        await clearPendingIntent()
        expect(await getPendingIntent()).toBeNull()
      } finally {
        db.close()
      }
    })

    it('should overwrite existing intent', async () => {
      const db = await resetDB(indexedDB)
      try {
        await setPendingIntent({type: 'join', subjectUid: 'test-uid'})
        const commentIntent: PendingCommentIntent = {
          type: 'comment',
          docId: {
            id: 'hm://abc',
            uid: 'abc',
            path: [],
            version: null,
            blockRef: null,
            blockRange: null,
            hostname: null,
            scheme: null,
          },
          docVersion: 'v1',
          content: [],
        }
        await setPendingIntent(commentIntent)
        const stored = await getPendingIntent()
        expect(stored).toEqual(commentIntent)
      } finally {
        db.close()
      }
    })
  })
})
