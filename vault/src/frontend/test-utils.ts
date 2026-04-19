import type * as api from '@/api'
import {Account} from '@shm/shared/client/.generated/documents/v3alpha/documents_pb'
import type {CID} from 'multiformats/cid'
import type {Blockstore} from './blockstore'

/**
 * Creates a mock IdentityService with all methods stubbed to throw by default.
 * Override specific methods as needed for your test.
 */
export function createMockClient(overrides: Partial<api.ClientInterface> = {}): api.ClientInterface {
  const notImplemented = (method: string) => () => {
    throw new Error(`Mock not implemented: ${method}`)
  }

  return {
    preLogin: notImplemented('preLogin'),
    login: notImplemented('login'),
    logout: notImplemented('logout'),
    getSession: notImplemented('getSession'),
    getAccount: notImplemented('getAccount'),
    getConfig: notImplemented('getConfig'),
    registerStart: notImplemented('registerStart'),
    registerPoll: notImplemented('registerPoll'),
    registerVerifyLink: notImplemented('registerVerifyLink'),
    getVault: notImplemented('getVault'),
    saveVault: notImplemented('saveVault'),
    addPassword: notImplemented('addPassword'),
    changePassword: notImplemented('changePassword'),
    addSecretCredential: notImplemented('addSecretCredential'),
    addPasskeyStart: notImplemented('addPasskeyStart'),
    addPasskeyFinish: notImplemented('addPasskeyFinish'),
    loginPasskeyStart: notImplemented('loginPasskeyStart'),
    loginPasskeyFinish: notImplemented('loginPasskeyFinish'),
    changeEmailStart: notImplemented('changeEmailStart'),
    changeEmailPoll: notImplemented('changeEmailPoll'),
    changeEmailVerifyLink: notImplemented('changeEmailVerifyLink'),
    ...overrides,
  }
}

/**
 * Creates a mock client where all methods return empty success responses.
 * Useful as a base when you only care about specific method behaviors.
 */
export function createSuccessMockClient(overrides: Partial<api.ClientInterface> = {}): api.ClientInterface {
  return {
    preLogin: async () => ({exists: false}),
    login: async () => ({success: true, userId: 'user-1'}),
    logout: async () => ({success: true}),
    getSession: async () => ({
      authenticated: false,
      relyingPartyOrigin: 'https://example.com',
    }),
    getAccount: async () => new Account(),
    getConfig: async () => ({
      backendHttpBaseUrl: 'https://daemon.example.com',
      notificationServerUrl: 'https://notify.example.com',
    }),
    registerStart: async () => ({
      message: 'ok',
      challengeId: 'test-challenge',
    }),
    registerPoll: async () => ({verified: false}),
    registerVerifyLink: async () => ({
      verified: true,
      email: 'test@example.com',
    }),
    getVault: async () => ({encryptedData: '', version: 0, credentials: []}),
    saveVault: async () => ({success: true}),
    addPassword: async () => ({success: true}),
    changePassword: async () => ({success: true}),
    addSecretCredential: async () => ({success: true, credentialId: 'secret-credential'}),
    addPasskeyStart: async () => ({
      challenge: 'challenge',
      rp: {name: 'test', id: 'test'},
      user: {id: 'id', name: 'name', displayName: 'name'},
      pubKeyCredParams: [],
    }),
    addPasskeyFinish: async () => ({
      success: true,
      credentialId: 'cred-1',
      backupEligible: true,
      backupState: true,
      prfEnabled: true,
    }),
    loginPasskeyStart: async () => ({
      challenge: 'challenge',
      allowCredentials: [],
    }),
    loginPasskeyFinish: async () => ({
      success: true,
      userId: 'user-1',
    }),
    changeEmailStart: async () => ({
      message: 'ok',
      challengeId: 'change-challenge',
    }),
    changeEmailPoll: async () => ({verified: false}),
    changeEmailVerifyLink: async () => ({
      verified: true,
      newEmail: 'new@example.com',
    }),
    ...overrides,
  }
}

/**
 * Creates an in-memory stub blockstore suitable for unit tests.
 * All puts and gets are backed by a simple Map — no IndexedDB or network involved.
 */
export function createMockBlockstore(overrides: Partial<Blockstore> = {}): Blockstore {
  const store = new Map<string, Uint8Array>()
  return {
    get: async (cid: CID) => {
      const cidStr = cid.toString()
      const data = store.get(cidStr)
      if (!data) throw new Error(`Blockstore: block not found for CID ${cidStr}`)
      return data
    },
    put: async (cid: CID, data: Uint8Array) => {
      store.set(cid.toString(), data)
    },
    ...overrides,
  }
}
