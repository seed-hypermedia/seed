// Set up test environment mocks
const TEST_ORIGIN = 'http://localhost:3000'

// Mock the window object
global.window = {
  ...global.window,
  location: {
    origin: TEST_ORIGIN,
  },
} as any

// Mock the origin variable that local-db.ts uses
;(global as any).origin = TEST_ORIGIN

import {indexedDB} from 'fake-indexeddb'
import 'fake-indexeddb/auto'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
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

describe('local-db integration', () => {
  beforeEach(async () => {
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
      expect(db.version).toBe(7)
      const storeNames = Array.from(db.objectStoreNames)
      expect(storeNames).toContain('keys-01')
      expect(storeNames).toContain('email-notifications-01')
      expect(storeNames).toContain('auth-sessions-01')
      expect(storeNames).toContain('auth-state-01')
      expect(storeNames).toContain('pending-intent-01')
    } finally {
      db.close()
    }
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
        const keyPair = await crypto.subtle.generateKey({name: 'ECDSA', namedCurve: 'P-256'}, false, ['sign', 'verify'])
        await writeLocalKeys(keyPair)
        const stored = await getStoredLocalKeys()
        expect(stored).not.toBeNull()
        expect(stored!.privateKey.type).toBe('private')
        expect(stored!.publicKey.type).toBe('public')
        expect(stored!.privateKey.algorithm).toEqual(keyPair.privateKey.algorithm)
        expect(stored!.publicKey.algorithm).toEqual(keyPair.publicKey.algorithm)
      } finally {
        db.close()
      }
    })

    it('should delete local keys', async () => {
      const db = await resetDB(indexedDB)
      try {
        const keyPair = await crypto.subtle.generateKey({name: 'ECDSA', namedCurve: 'P-256'}, false, ['sign', 'verify'])
        await writeLocalKeys(keyPair)
        expect(await getStoredLocalKeys()).not.toBeNull()
        await deleteLocalKeys()
        expect(await getStoredLocalKeys()).toBeNull()
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
        const session = await getAuthSession('https://vault.example.com')
        expect(session).toBeUndefined()
      } finally {
        db.close()
      }
    })

    it('should store and retrieve an auth session', async () => {
      const db = await resetDB(indexedDB)
      try {
        const keyPair = await crypto.subtle.generateKey({name: 'ECDSA', namedCurve: 'P-256'}, false, ['sign', 'verify'])
        const record: DBSessionRecord = {
          keyPair,
          publicKeyRaw: new Uint8Array([1, 2, 3]),
          principal: 'test-principal',
          vaultUrl: 'https://vault.example.com',
          createTime: Date.now(),
          authState: 'some-state',
          authStartTime: Date.now(),
        }
        await putAuthSession('https://vault.example.com', record)
        const stored = await getAuthSession('https://vault.example.com')
        expect(stored).toBeDefined()
        expect(stored!.principal).toBe('test-principal')
        expect(stored!.vaultUrl).toBe('https://vault.example.com')
        expect(stored!.authState).toBe('some-state')
      } finally {
        db.close()
      }
    })

    it('should delete an auth session', async () => {
      const db = await resetDB(indexedDB)
      try {
        const keyPair = await crypto.subtle.generateKey({name: 'ECDSA', namedCurve: 'P-256'}, false, ['sign', 'verify'])
        const record: DBSessionRecord = {
          keyPair,
          publicKeyRaw: new Uint8Array([1, 2, 3]),
          principal: 'test-principal',
          vaultUrl: 'https://vault.example.com',
          createTime: Date.now(),
          authState: null,
          authStartTime: null,
        }
        await putAuthSession('https://vault.example.com', record)
        expect(await getAuthSession('https://vault.example.com')).toBeDefined()
        await deleteAuthSession('https://vault.example.com')
        expect(await getAuthSession('https://vault.example.com')).toBeUndefined()
      } finally {
        db.close()
      }
    })

    it('should store sessions keyed by vault URL independently', async () => {
      const db = await resetDB(indexedDB)
      try {
        const keyPair = await crypto.subtle.generateKey({name: 'ECDSA', namedCurve: 'P-256'}, false, ['sign', 'verify'])
        const record1: DBSessionRecord = {
          keyPair,
          publicKeyRaw: new Uint8Array([1]),
          principal: 'principal-1',
          vaultUrl: 'https://vault1.example.com',
          createTime: Date.now(),
          authState: null,
          authStartTime: null,
        }
        const record2: DBSessionRecord = {
          keyPair,
          publicKeyRaw: new Uint8Array([2]),
          principal: 'principal-2',
          vaultUrl: 'https://vault2.example.com',
          createTime: Date.now(),
          authState: null,
          authStartTime: null,
        }
        await putAuthSession('https://vault1.example.com', record1)
        await putAuthSession('https://vault2.example.com', record2)

        const stored1 = await getAuthSession('https://vault1.example.com')
        const stored2 = await getAuthSession('https://vault2.example.com')
        expect(stored1!.principal).toBe('principal-1')
        expect(stored2!.principal).toBe('principal-2')

        await deleteAuthSession('https://vault1.example.com')
        expect(await getAuthSession('https://vault1.example.com')).toBeUndefined()
        expect(await getAuthSession('https://vault2.example.com')).toBeDefined()
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
        await setAuthState(AUTH_STATE_ACTIVE_VAULT_URL, 'https://vault.example.com')
        const value = await getAuthState(AUTH_STATE_ACTIVE_VAULT_URL)
        expect(value).toBe('https://vault.example.com')
      } finally {
        db.close()
      }
    })

    it('should delete auth state', async () => {
      const db = await resetDB(indexedDB)
      try {
        await setAuthState(AUTH_STATE_ACTIVE_VAULT_URL, 'https://vault.example.com')
        await deleteAuthState(AUTH_STATE_ACTIVE_VAULT_URL)
        expect(await getAuthState(AUTH_STATE_ACTIVE_VAULT_URL)).toBeNull()
      } finally {
        db.close()
      }
    })

    it('should clear all auth state', async () => {
      const db = await resetDB(indexedDB)
      try {
        await setAuthState(AUTH_STATE_ACTIVE_VAULT_URL, 'https://vault.example.com')
        await setAuthState(AUTH_STATE_DELEGATION_RETURN_URL, '/some/path')
        await setAuthState(AUTH_STATE_DELEGATION_VAULT_URL, 'https://vault.example.com/delegate')
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
        const intent: PendingIntent = {type: 'join'}
        await setPendingIntent(intent)
        const stored = await getPendingIntent()
        expect(stored).toEqual({type: 'join'})
      } finally {
        db.close()
      }
    })

    it('should store and retrieve a comment intent', async () => {
      const db = await resetDB(indexedDB)
      try {
        const intent: PendingCommentIntent = {
          type: 'comment',
          docId: '{"uid":"abc","path":"/doc"}',
          docVersion: 'v1.v2',
          content: '[{"block":{"id":"b1","type":"Paragraph","text":"hello"}}]',
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
        await setPendingIntent({type: 'join'})
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
        await setPendingIntent({type: 'join'})
        const commentIntent: PendingCommentIntent = {
          type: 'comment',
          docId: '{"uid":"abc"}',
          docVersion: 'v1',
          content: '[]',
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
