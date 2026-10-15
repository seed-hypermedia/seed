import * as base64 from '@seed-hypermedia/client/base64'
import * as blobs from '@shm/shared/blobs'
import * as cbor from '@shm/shared/cbor'
import {PARAM_EMAIL_PREVALIDATION, type CallbackData} from '@shm/shared/hmauth'
import {indexedDB} from 'fake-indexeddb'
import 'fake-indexeddb/auto'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {handleCallback, startAuth} from './auth-session'
import {getAuthSession, putAuthSession, resetDB} from './local-db'

const DB_NAME = 'keyStore-04'

async function collectStream(readable: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  const reader = readable.getReader()
  for (;;) {
    const {done, value} = await reader.read()
    if (done) break
    chunks.push(value)
  }
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const merged = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.length
  }
  return merged
}

async function compress(data: Uint8Array): Promise<Uint8Array> {
  const stream = new CompressionStream('gzip')
  const writer = stream.writable.getWriter()
  writer.write(data as Uint8Array<ArrayBuffer>)
  writer.close()
  return collectStream(stream.readable)
}

describe('auth session callback', () => {
  let db: IDBDatabase

  beforeEach(async () => {
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase(DB_NAME)
      req.onsuccess = () => resolve()
      req.onerror = () => resolve()
    })
    ;(globalThis as any).window = {
      indexedDB,
      history: {
        state: {navigation: 'callback'},
        replaceState: vi.fn((_state, _title, url) => {
          window.location.href = String(url)
        }),
      },
      location: {
        href: 'https://example.com/',
        origin: 'https://example.com',
      },
    }
    db = await resetDB(indexedDB)
  })

  afterEach(async () => {
    db.close()
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase(DB_NAME)
      req.onsuccess = () => resolve()
      req.onerror = () => resolve()
    })
  })

  async function prepareCallback(options: {proof?: unknown; state?: string; wrongDelegate?: boolean} = {}) {
    const vaultUrl = 'https://example.com/vault/delegate'
    const authState = 'state-1'
    const session = await blobs.generateWebCryptoKeyPair()
    const issuer = blobs.generateNobleKeyPair()
    const capability = await blobs.createCapability(
      issuer,
      options.wrongDelegate ? blobs.generateNobleKeyPair().principal : session.principal,
      'AGENT',
      Date.now(),
    )
    const callbackData: CallbackData = {
      account: issuer.principal,
      capability: capability.decoded,
      capabilityCid: capability.cid,
    }
    const data = base64.encode(await compress(new Uint8Array(cbor.encode(callbackData))))

    await putAuthSession(vaultUrl, {
      keyPair: session.keyPair,
      publicKeyRaw: session.publicKey,
      principal: blobs.principalToString(session.principal),
      vaultUrl,
      createTime: Date.now(),
      authState,
      authStartTime: Date.now(),
    })

    window.location.href = `https://example.com/callback?data=${encodeURIComponent(data)}&state=${
      options.state ?? authState
    }`
    if (options.proof !== undefined) {
      window.location.href += `#keep=anchor&${PARAM_EMAIL_PREVALIDATION}=${base64.encode(
        new Uint8Array(cbor.encode(options.proof)),
      )}`
    }
    return {vaultUrl, issuer, capability}
  }

  function emailProof() {
    return {
      email: 'person@example.com',
      host: 'https://example.com',
      signer: base64.encode(blobs.generateNobleKeyPair().principal),
      sig: base64.encode(new Uint8Array(64).fill(7)),
    }
  }

  it('accepts old vault callback data without profile fields', async () => {
    const {vaultUrl, issuer, capability} = await prepareCallback()
    const result = await handleCallback({vaultUrl})

    expect(result?.accountPrincipal).toBe(blobs.principalToString(issuer.principal))
    expect(result?.capability.cid.toString()).toBe(capability.cid.toString())
    expect(result?.profile).toBeUndefined()
    expect(result?.emailPrevalidation).toBeUndefined()
  })
  it('requests optional email prevalidation as part of the signed auth request', async () => {
    const vaultUrl = 'https://example.com/vault/delegate'
    const url = new URL(await startAuth({vaultUrl, redirectUri: 'https://example.com/callback'}))
    expect(url.searchParams.get(PARAM_EMAIL_PREVALIDATION)).toBe('1')
    const signature = base64.decode(url.searchParams.get('proof')!)
    url.searchParams.delete('proof')
    const session = await getAuthSession(vaultUrl)
    expect(
      await crypto.subtle.verify(
        'Ed25519',
        session!.keyPair.publicKey,
        signature,
        new TextEncoder().encode(url.toString()),
      ),
    ).toBe(true)
  })

  it('returns optional proof only after valid delegation and immediately removes it from the URL', async () => {
    const proof = emailProof()
    const {vaultUrl} = await prepareCallback({proof})
    const pending = handleCallback({vaultUrl})
    expect(new URL(window.location.href).hash).toBe('#keep=anchor')
    expect(window.history.replaceState).toHaveBeenCalledWith(window.history.state, '', window.location.href)
    expect((await pending)?.emailPrevalidation).toEqual(proof)
  })

  it.each([
    ['wrong Vault origin', () => ({...emailProof(), host: 'https://other-vault.example.com'})],
    ['invalid signature encoding', () => ({...emailProof(), sig: 'invalid'})],
    ['raw email', () => ({email: 'person@example.com'})],
  ])('ignores %s proof without breaking valid delegation', async (_label, makeProof) => {
    const {vaultUrl} = await prepareCallback({proof: makeProof()})
    expect((await handleCallback({vaultUrl}))?.emailPrevalidation).toBeUndefined()
    expect(new URL(window.location.href).hash).toBe('#keep=anchor')
  })

  it('ignores malformed encoded proof without breaking valid delegation', async () => {
    const {vaultUrl} = await prepareCallback()
    window.location.href += `#${PARAM_EMAIL_PREVALIDATION}=not-cbor`
    expect((await handleCallback({vaultUrl}))?.emailPrevalidation).toBeUndefined()
    expect(new URL(window.location.href).hash).toBe('')
  })

  it('strips proof even when callback state is rejected', async () => {
    const {vaultUrl} = await prepareCallback({proof: emailProof(), state: 'wrong-state'})
    await expect(handleCallback({vaultUrl})).rejects.toThrow('Invalid callback state')
    expect(new URL(window.location.href).hash).toBe('#keep=anchor')
    expect((await getAuthSession(vaultUrl))?.authState).toBe('state-1')
  })

  it('does not accept email proof as a substitute for a session-bound capability', async () => {
    const {vaultUrl} = await prepareCallback({proof: emailProof(), wrongDelegate: true})
    await expect(handleCallback({vaultUrl})).rejects.toThrow('Capability delegate does not match local session key')
    expect(new URL(window.location.href).hash).toBe('#keep=anchor')
  })
})
