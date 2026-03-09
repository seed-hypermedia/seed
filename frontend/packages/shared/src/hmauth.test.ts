import {describe, expect, test} from 'vitest'
import * as base64 from './base64'
import * as blobs from './blobs'
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

function expectString(value: string | null) {
  expect(value).not.toBeNull()
  expect(typeof value).toBe('string')
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
  return {url, keyPair, publicKeyRaw, sessionKeyPrincipal}
}

describe('principal encoding', () => {
  cryptoTest('principalEncode and principalDecode round-trip', async () => {
    const keyPair = (await crypto.subtle.generateKey('Ed25519' as unknown as AlgorithmIdentifier, false, [
      'sign',
      'verify',
    ])) as CryptoKeyPair
    const publicKeyRaw = new Uint8Array(await crypto.subtle.exportKey('raw', keyPair.publicKey))
    const encoded = SDK.principalEncode(publicKeyRaw)
    const decoded = SDK.principalDecode(encoded)
    expect(decoded).toEqual(publicKeyRaw)
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
    const issuer = await blobs.generateKeyPair()
    const delegate = await blobs.generateKeyPair()
    const capability = await blobs.createCapability(issuer, delegate.principal, 'AGENT', Date.now())
    const profile = await blobs.createProfile(issuer, {name: 'Alice'}, Date.now())
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
