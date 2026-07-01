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
