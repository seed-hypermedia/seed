/**
 * Client-side IPFS blockstore.
 *
 * Provides a two-layer blockstore:
 *   1. RemoteBlockstore  — GET/POST /ipfs/{cid} on the backing server.
 *   2. IndexedDBBlockstore — IndexedDB read-through cache in front of the remote.
 *
 * The server validates CIDs on PUT, so we trust the data we receive back.
 */

const IDB_DB_NAME = 'seed-blockstore'
const IDB_STORE_NAME = 'blocks'
const IDB_VERSION = 1

import type {CID} from 'multiformats/cid'

/** Minimal blockstore interface for raw IPFS block bytes. */
export interface Blockstore {
  /** Retrieve raw block bytes for the given CID. Throws if not found. */
  get(cid: CID): Promise<Uint8Array>
  /** Store raw block bytes. The server validates that the bytes hash to the CID. */
  put(cid: CID, data: Uint8Array): Promise<void>
}

// ---- Remote blockstore ----

/** Fetches and posts raw block bytes to a remote HTTP blockstore at /ipfs/{cid}. */
export class RemoteBlockstore implements Blockstore {
  constructor(private readonly baseUrl: string) {}

  async get(cid: CID): Promise<Uint8Array> {
    const cidStr = cid.toString()
    const url = `${this.baseUrl}/ipfs/${cidStr}`
    const resp = await fetch(url)
    if (!resp.ok) {
      throw new Error(`Blockstore GET failed for CID ${cidStr}: HTTP ${resp.status}`)
    }
    return new Uint8Array(await resp.arrayBuffer())
  }

  async put(cid: CID, data: Uint8Array): Promise<void> {
    const cidStr = cid.toString()
    const url = `${this.baseUrl}/ipfs/${cidStr}`
    const resp = await fetch(url, {
      method: 'POST',
      headers: {'Content-Type': 'application/octet-stream'},
      body: data as unknown as BodyInit,
    })
    if (!resp.ok) {
      const text = await resp.text().catch(() => '')
      throw new Error(`Blockstore PUT failed for CID ${cid}: HTTP ${resp.status}${text ? ` — ${text}` : ''}`)
    }
  }
}

// ---- IndexedDB helpers ----

function openIDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_DB_NAME, IDB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(IDB_STORE_NAME)) {
        db.createObjectStore(IDB_STORE_NAME)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function idbGet(cid: CID): Promise<Uint8Array | undefined> {
  const db = await openIDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE_NAME, 'readonly')
    const req = tx.objectStore(IDB_STORE_NAME).get(cid.toString())
    req.onsuccess = () => resolve(req.result as Uint8Array | undefined)
    req.onerror = () => reject(req.error)
  })
}

async function idbPut(cid: CID, data: Uint8Array): Promise<void> {
  const db = await openIDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE_NAME, 'readwrite')
    const req = tx.objectStore(IDB_STORE_NAME).put(data, cid.toString())
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

// ---- Caching blockstore ----

/**
 * IndexedDB-backed read-through cache in front of a remote blockstore.
 * Writes go to the remote first, then populate the local cache.
 */
export class IndexedDBBlockstore implements Blockstore {
  constructor(private readonly remote: RemoteBlockstore) {}

  async get(cid: CID): Promise<Uint8Array> {
    const cached = await idbGet(cid)
    if (cached !== undefined) return cached

    const data = await this.remote.get(cid)
    // Populate cache on miss — best effort.
    await idbPut(cid, data).catch(() => {})
    return data
  }

  async put(cid: CID, data: Uint8Array): Promise<void> {
    await this.remote.put(cid, data)
    await idbPut(cid, data).catch(() => {})
  }
}
