import {afterAll, afterEach, beforeAll, describe, expect, test} from 'vitest'
import * as blobs from './blobs'
import * as base64 from './base64'
import * as SDK from './hmauth'

const hasWebCryptoEd25519 = await (async () => {
  try {
    await crypto.subtle.generateKey('Ed25519' as unknown as AlgorithmIdentifier, false, ['sign', 'verify'])
    return true
  } catch {
    return false
  }
})()

const cryptoTest = hasWebCryptoEd25519 ? test : test.skip

type IDBStoreMap = Map<string, Map<string, unknown>>

type GlobalWithWindow = {
  window?: {
    location: URL
  }
  indexedDB?: unknown
}

const globalWithWindow = globalThis as unknown as GlobalWithWindow
const originalWindow = globalWithWindow.window
const originalIndexedDB = globalWithWindow.indexedDB

function setUrl(url: string) {
  globalWithWindow.window = {
    location: new URL(url),
  }
}

function expectString(value: string | null) {
  expect(value).not.toBeNull()
  expect(typeof value).toBe('string')
}

function createIndexedDBMock() {
  const databases = new Map<string, IDBStoreMap>()

  const makeRequest = <T>(executor: (resolve: (value: T) => void, reject: (error: Error) => void) => void) => {
    const req: {
      result?: T
      error?: Error
      onsuccess: null | (() => void)
      onerror: null | (() => void)
    } = {
      onsuccess: null,
      onerror: null,
    }
    queueMicrotask(() => {
      executor(
        (value) => {
          req.result = value
          req.onsuccess?.()
        },
        (error) => {
          req.error = error
          req.onerror?.()
        },
      )
    })
    return req
  }

  const indexedDBMock = {
    open(dbName: string) {
      let stores = databases.get(dbName)
      const req: {
        result?: unknown
        error?: Error
        onupgradeneeded: null | (() => void)
        onsuccess: null | (() => void)
        onerror: null | (() => void)
      } = {
        onupgradeneeded: null,
        onsuccess: null,
        onerror: null,
      }

      queueMicrotask(() => {
        const isNew = !stores
        if (!stores) {
          stores = new Map()
          databases.set(dbName, stores)
        }
        const db = {
          objectStoreNames: {
            contains(name: string) {
              return stores!.has(name)
            },
          },
          createObjectStore(name: string) {
            if (!stores!.has(name)) {
              stores!.set(name, new Map())
            }
          },
          transaction(name: string) {
            const store = stores!.get(name)
            if (!store) {
              throw new Error(`Object store does not exist: ${name}`)
            }
            return {
              objectStore() {
                return {
                  get(key: string) {
                    return makeRequest((resolve) => resolve(store.get(key)))
                  },
                  put(value: unknown, key: string) {
                    return makeRequest<void>((resolve) => {
                      store.set(key, value)
                      resolve()
                    })
                  },
                  delete(key: string) {
                    return makeRequest<void>((resolve) => {
                      store.delete(key)
                      resolve()
                    })
                  },
                }
              },
            }
          },
        }
        req.result = db
        if (isNew) {
          req.onupgradeneeded?.()
        }
        req.onsuccess?.()
      })

      return req
    },
  }

  return indexedDBMock
}

async function createSignedDelegationUrl(
  clientId = 'https://example.com',
  redirectUri = 'https://example.com/callback',
  vaultOrigin = 'https://vault.example.com',
) {
  const keyPair = (await crypto.subtle.generateKey('Ed25519' as unknown as AlgorithmIdentifier, false, [
    'sign',
    'verify',
  ])) as CryptoKeyPair
  const publicKeyRaw = new Uint8Array(await crypto.subtle.exportKey('raw', keyPair.publicKey))
  const sessionKeyPrincipal = blobs.principalToString(blobs.principalFromEd25519(publicKeyRaw))
  const state = 'AAAAAAAAAAAAAAAAAAAAAA'
  const requestTs = Date.now()
  const unsignedUrl = new URL(`${vaultOrigin}${SDK.DELEGATION_PATH}`)
  unsignedUrl.searchParams.set(SDK.PARAM_CLIENT_ID, clientId)
  unsignedUrl.searchParams.set(SDK.PARAM_REDIRECT_URI, redirectUri)
  unsignedUrl.searchParams.set(SDK.PARAM_SESSION_KEY, sessionKeyPrincipal)
  unsignedUrl.searchParams.set(SDK.PARAM_STATE, state)
  unsignedUrl.searchParams.set(SDK.PARAM_TS, String(requestTs))
  const payload = new TextEncoder().encode(unsignedUrl.toString())
  const proof = new Uint8Array(
    await crypto.subtle.sign(
      'Ed25519' as unknown as AlgorithmIdentifier,
      keyPair.privateKey,
      payload as ArrayBufferView<ArrayBuffer>,
    ),
  )
  const proofBase64 = base64.encode(proof)
  const delimiter = unsignedUrl.search ? '&' : '?'
  const url = new URL(`${unsignedUrl.toString()}${delimiter}${SDK.PARAM_PROOF}=${encodeURIComponent(proofBase64)}`)
  return {url}
}

beforeAll(() => {
  if (!globalWithWindow.window) {
    setUrl('http://localhost/')
  }
})

afterEach(() => {
  globalWithWindow.indexedDB = originalIndexedDB
  if (originalWindow) {
    globalWithWindow.window = originalWindow
    return
  }
  setUrl('http://localhost/')
})

afterAll(() => {
  if (originalWindow) {
    globalWithWindow.window = originalWindow
    return
  }
  delete globalWithWindow.window
})

describe('hypermedia auth protocol', () => {
  cryptoTest('startAuth produces a signed delegation request URL and stores session', async () => {
    globalWithWindow.indexedDB = createIndexedDBMock()
    setUrl('http://localhost:8081/callback')
    const vaultUrl = 'http://localhost:3000/vault/delegate'
    const authUrl = await SDK.startAuth({vaultUrl})
    const parsed = new URL(authUrl)

    expect(parsed.searchParams.get(SDK.PARAM_CLIENT_ID)).toBe('http://localhost:8081')
    expect(parsed.searchParams.get(SDK.PARAM_REDIRECT_URI)).toBe('http://localhost:8081/callback')
    expectString(parsed.searchParams.get(SDK.PARAM_SESSION_KEY))
    expectString(parsed.searchParams.get(SDK.PARAM_STATE))
    expectString(parsed.searchParams.get(SDK.PARAM_TS))
    expectString(parsed.searchParams.get(SDK.PARAM_PROOF))

    const session = await SDK.getSession(vaultUrl)
    expect(session).not.toBeNull()
    const sessionKey = parsed.searchParams.get(SDK.PARAM_SESSION_KEY)
    if (!sessionKey) {
      throw new Error('missing session_key')
    }
    expect(session!.principal).toBe(sessionKey)
  })

  test('handleCallback returns null when callback params are absent', async () => {
    setUrl('http://localhost:8081/')
    const result = await SDK.handleCallback({
      vaultUrl: 'http://localhost:3000/vault/delegate',
    })
    expect(result).toBeNull()
  })

  cryptoTest('handleCallback rejects callbacks with mismatched state', async () => {
    globalWithWindow.indexedDB = createIndexedDBMock()
    setUrl('http://localhost:8081/callback')
    const vaultUrl = 'http://localhost:3000/vault/delegate'
    await SDK.startAuth({vaultUrl})
    setUrl(`http://localhost:8081/callback?${SDK.PARAM_ERROR}=access_denied&${SDK.PARAM_STATE}=WRONGSTATE`)
    await expect(SDK.handleCallback({vaultUrl})).rejects.toThrow('Invalid callback state')
  })

  cryptoTest('demo redirect URL should be accepted by vault delegation parser', async () => {
    globalWithWindow.indexedDB = createIndexedDBMock()
    setUrl('http://localhost:8081/callback')
    const vaultUrl = 'http://localhost:3000/vault/delegate'
    const authUrl = await SDK.startAuth({vaultUrl})
    const parsedAuthUrl = new URL(authUrl)

    const request = SDK.parseDelegationRequest(parsedAuthUrl)
    expect(request).not.toBeNull()
    await expect(SDK.verifyDelegationRequestProof(request!, parsedAuthUrl.origin)).resolves.toBeUndefined()
  })

  test('handleCallback requires state when callback has error', async () => {
    setUrl(`http://localhost:8081/callback?${SDK.PARAM_ERROR}=access_denied`)
    await expect(SDK.handleCallback({vaultUrl: 'http://localhost:3000/vault/delegate'})).rejects.toThrow(
      'Missing callback state',
    )
  })
})

describe('sdk key operations', () => {
  cryptoTest('generateSessionKey and principalDecode round-trip', async () => {
    const result = await SDK.generateSessionKey()
    expect(result.publicKeyRaw.length).toBe(32)
    const decodedPubKey = SDK.principalDecode(result.principal)
    expect(decodedPubKey).toEqual(result.publicKeyRaw)
  })

  cryptoTest('signWithSession signs data with stored key', async () => {
    const {keyPair, publicKeyRaw, principal} = await SDK.generateSessionKey()
    const session: SDK.StoredSession = {
      keyPair,
      publicKeyRaw,
      principal,
      vaultUrl: 'http://localhost:3000/vault/delegate',
      createdAt: Date.now(),
    }
    const data = new TextEncoder().encode('test message')
    const signature = await SDK.signWithSession(session, data)
    const valid = await crypto.subtle.verify(
      'Ed25519' as unknown as AlgorithmIdentifier,
      keyPair.publicKey,
      signature as ArrayBufferView<ArrayBuffer>,
      data as ArrayBufferView<ArrayBuffer>,
    )
    expect(valid).toBe(true)
  })
})

describe('delegation request protocol', () => {
  cryptoTest('parses and verifies a valid signed request', async () => {
    const {url} = await createSignedDelegationUrl()
    const request = SDK.parseDelegationRequest(url)
    expect(request).not.toBeNull()
    await expect(SDK.verifyDelegationRequestProof(request!, 'https://vault.example.com')).resolves.toBeUndefined()
  })

  cryptoTest('rejects request when signed fields are tampered', async () => {
    const {url} = await createSignedDelegationUrl()
    url.searchParams.set(SDK.PARAM_STATE, 'BBBBBBBBBBBBBBBBBBBBBB')
    const request = SDK.parseDelegationRequest(url)
    await expect(SDK.verifyDelegationRequestProof(request!, 'https://vault.example.com')).rejects.toThrow(
      'does not match session key',
    )
  })

  cryptoTest('rejects request with malformed proof encoding', async () => {
    const {url} = await createSignedDelegationUrl()
    url.searchParams.set(SDK.PARAM_PROOF, 'not-base64url')
    const request = SDK.parseDelegationRequest(url)
    await expect(SDK.verifyDelegationRequestProof(request!, 'https://vault.example.com')).rejects.toThrow(
      'Invalid proof signature encoding',
    )
  })

  cryptoTest('rejects expired request proof', async () => {
    const {url} = await createSignedDelegationUrl()
    const request = SDK.parseDelegationRequest(url)
    const now = Date.now() + 6 * 60 * 1000
    await expect(SDK.verifyDelegationRequestProof(request!, 'https://vault.example.com', now)).rejects.toThrow(
      'expired',
    )
  })

  cryptoTest('rejects request when proof is not the final query parameter', async () => {
    const {url} = await createSignedDelegationUrl()
    url.searchParams.set('extra', '1')
    expect(() => SDK.parseDelegationRequest(url)).toThrow('proof must be the final query parameter')
  })
})

describe('delegation callback protocol', () => {
  test('echoes state in callback URL', async () => {
    const issuer = blobs.generateKeyPair()
    const delegate = blobs.generateKeyPair()
    const capability = blobs.createCapability(issuer, delegate.principal, 'AGENT', Date.now()).decoded
    const profile = blobs.createProfile(issuer, {name: 'Alice'}, Date.now()).decoded
    const url = await SDK.buildCallbackUrl(
      'https://example.com/callback',
      'AAAAAAAAAAAAAAAAAAAAAA',
      issuer.principal,
      capability,
      profile,
    )
    const parsed = new URL(url)
    expect(parsed.searchParams.get(SDK.PARAM_STATE)).toBe('AAAAAAAAAAAAAAAAAAAAAA')
    expectString(parsed.searchParams.get(SDK.PARAM_DATA))
  })
})
