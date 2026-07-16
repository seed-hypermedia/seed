import {CID} from 'multiformats/cid'

/**
 * Helpers for the DAG-JSON representations of IPLD's two special kinds
 * (see https://ipld.io/specs/codecs/dag-json/spec/):
 *
 * - Links (CIDs) encode as `{"/": "<cid string>"}`
 * - Bytes encode as `{"/": {"bytes": "<base64>"}}`
 *
 * The daemon's /ipfs/{cid}.dagjson endpoint returns these forms, so the value
 * editor works on them directly and converts to real CID / Uint8Array values
 * only when encoding to DAG-CBOR for publishing.
 */

export type DagJsonLink = {'/': string}
export type DagJsonBytes = {'/': {bytes: string}}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/** True for the DAG-JSON link form `{"/": "cid"}`. */
export function isDagJsonLink(value: unknown): value is DagJsonLink {
  return isRecord(value) && Object.keys(value).length === 1 && typeof value['/'] === 'string'
}

/** True for the DAG-JSON bytes form `{"/": {"bytes": "base64"}}`. */
export function isDagJsonBytes(value: unknown): value is DagJsonBytes {
  if (!isRecord(value) || Object.keys(value).length !== 1) return false
  const slash = value['/']
  return isRecord(slash) && Object.keys(slash).length === 1 && typeof slash.bytes === 'string'
}

/** Parse a CID string, returning null when invalid. */
export function parseCidString(text: string): CID | null {
  try {
    return CID.parse(text.trim())
  } catch {
    return null
  }
}

/** Decode base64 (padded or unpadded — DAG-JSON uses unpadded) to bytes. Throws on invalid input. */
export function base64ToBytes(b64: string): Uint8Array {
  const normalized = b64.replace(/\s+/g, '')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

/** Encode bytes as unpadded base64, per the DAG-JSON spec. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunkSize)))
  }
  return btoa(binary).replace(/=+$/, '')
}

/** Human-readable byte size. */
export function formatByteSize(size: number): string {
  if (size < 1024) return `${size} ${size === 1 ? 'byte' : 'bytes'}`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

// Blob type names the Seed daemon dispatches indexers on (backend/blob/
// index_registry.go makeCBORTypeMatch): the raw blob bytes are scanned for
// CBOR("type") immediately followed by CBOR(<name>), at any nesting depth.
// A match triggers a strict decode + signature verification whose failure
// aborts the entire StoreBlobs call with an opaque Internal error.
const SEED_INDEXED_TYPE_NAMES = ['Comment', 'Change', 'Ref', 'Capability', 'Contact', 'Profile']

const utf8Encoder = new TextEncoder()

// CBOR text-string header for lengths < 24: major type 3, single byte 0x60+len.
function cborShortText(text: string): Uint8Array {
  const body = utf8Encoder.encode(text)
  const bytes = new Uint8Array(body.length + 1)
  bytes[0] = 0x60 + body.length
  bytes.set(body, 1)
  return bytes
}

function bytesContain(haystack: Uint8Array, needle: Uint8Array): boolean {
  outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer
    }
    return true
  }
  return false
}

/**
 * Detect whether encoded DAG-CBOR bytes would be picked up by one of the Seed
 * daemon's blob indexers (a `"type"` entry immediately followed by a known
 * type name, at any depth). Returns the colliding type name or null. Used to
 * turn the daemon's opaque store failure into an actionable message — never
 * to block a publish attempt (a pasted genuine signed blob stores fine).
 */
export function findSeedIndexerCollision(data: Uint8Array): string | null {
  const typeKey = cborShortText('type')
  for (const name of SEED_INDEXED_TYPE_NAMES) {
    const value = cborShortText(name)
    const matcher = new Uint8Array(typeKey.length + value.length)
    matcher.set(typeKey, 0)
    matcher.set(value, typeKey.length)
    if (bytesContain(data, matcher)) return name
  }
  return null
}

/**
 * Convert a DAG-JSON-form value into real IPLD values for DAG-CBOR encoding:
 * link forms become CID instances (encoded as tag 42), bytes forms become
 * Uint8Array. Without this, republishing a blob would corrupt its links and
 * bytes into plain maps. Throws on invalid CIDs or base64.
 */
export function dagJsonToIpld(value: unknown): unknown {
  if (isDagJsonLink(value)) {
    const cid = parseCidString(value['/'])
    if (!cid) throw new Error(`Invalid CID link: ${value['/']}`)
    return cid
  }
  if (isDagJsonBytes(value)) {
    return base64ToBytes(value['/'].bytes)
  }
  if (Array.isArray(value)) return value.map(dagJsonToIpld)
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, dagJsonToIpld(child)]))
  }
  return value
}
