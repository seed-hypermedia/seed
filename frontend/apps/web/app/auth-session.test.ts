import * as base64 from '@seed-hypermedia/client/base64'
import * as blobs from '@shm/shared/blobs'
import * as cbor from '@shm/shared/cbor'
import type {CallbackData} from '@shm/shared/hmauth'
import {indexedDB} from 'fake-indexeddb'
import 'fake-indexeddb/auto'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {handleCallback} from './auth-session'
import {putAuthSession, resetDB} from './local-db'

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

  it('accepts old vault callback data without profile fields', async () => {
    const vaultUrl = 'https://example.com/vault/delegate'
    const authState = 'state-1'
    const session = await blobs.generateWebCryptoKeyPair()
    const issuer = blobs.generateNobleKeyPair()
    const capability = await blobs.createCapability(issuer, session.principal, 'AGENT', Date.now())
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

    window.location.href = `https://example.com/callback?data=${encodeURIComponent(data)}&state=${authState}`

    const result = await handleCallback({vaultUrl})

    expect(result?.accountPrincipal).toBe(blobs.principalToString(issuer.principal))
    expect(result?.capability.cid.toString()).toBe(capability.cid.toString())
    expect(result?.profile).toBeUndefined()
  })
})
