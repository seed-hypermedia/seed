/**
 * Small pure helpers shared by the extension host. No React, no platform APIs.
 */

import {
  ExtensionError,
  type ExtensionInstallRecord,
  type ExtensionReadQueryKey,
} from '@seed-hypermedia/client/extensions'
import {
  HMListEventsInputSchema,
  HMQuerySchema,
  HMSearchInputSchema,
  packHmId,
  unpackHmId,
  type UnpackedHypermediaId,
} from '@seed-hypermedia/client/hm-types'
import type {ZodTypeAny} from 'zod'

// ── Extension identity ───────────────────────────────────────────────────────

/**
 * Canonical id of an installed extension: the extension document's `hm://`
 * URL without version. Used for the bridge context, storage namespaces and
 * dev overrides, so it must be computed the same way everywhere.
 */
export function extensionIdString(record: Pick<ExtensionInstallRecord, 'ext'>): string | null {
  const unpacked = unpackHmId(record.ext)
  if (!unpacked) return null
  return packHmId({...unpacked, version: null, latest: null, blockRef: null, blockRange: null})
}

/** Storage key namespace for one extension on one site. */
export function extensionStorageKey(extensionId: string, siteUid: string, key: string): string {
  return `${extensionStoragePrefix(extensionId, siteUid)}${key}`
}

export function extensionStoragePrefix(extensionId: string, siteUid: string): string {
  return `seed.ext.${extensionId}.${siteUid}.`
}

// ── Hypermedia id inputs ─────────────────────────────────────────────────────

/**
 * Accept an id the way the SDK sends it — an `hm://` string or `{id: 'hm://…'}`
 * — as well as an already-unpacked id object, and return the unpacked form.
 * Version-less ids resolve to the latest known version.
 */
export function normalizeHmIdInput(value: unknown, label = 'id'): UnpackedHypermediaId {
  if (typeof value === 'string') {
    const unpacked = unpackHmId(value)
    if (!unpacked) throw new ExtensionError('invalid_params', `${label} is not a valid hm:// URL: ${value}`)
    return unpacked
  }
  if (value && typeof value === 'object') {
    const v = value as Record<string, unknown>
    if (typeof v.uid === 'string' && v.uid) {
      // Already unpacked. Rebuild through hmId-like normalisation so optional
      // fields the SDK may omit are present.
      const path = Array.isArray(v.path)
        ? (v.path as unknown[]).filter((s): s is string => typeof s === 'string')
        : null
      const version = typeof v.version === 'string' && v.version ? v.version : null
      const packed = packHmId({
        id: '',
        uid: v.uid,
        path,
        version,
        blockRef: typeof v.blockRef === 'string' ? v.blockRef : null,
        blockRange: null,
        hostname: null,
        scheme: null,
        latest: typeof v.latest === 'boolean' ? v.latest : !version,
      })
      const unpacked = unpackHmId(packed)
      if (!unpacked) throw new ExtensionError('invalid_params', `${label} is not a valid hypermedia id`)
      return unpacked
    }
    if (typeof v.id === 'string') return normalizeHmIdInput(v.id, label)
  }
  throw new ExtensionError('invalid_params', `${label} must be an hm:// URL string or {id: 'hm://…'}`)
}

/**
 * Input fields (per read key) that hold hypermedia ids. `'.'` means the whole
 * input is the id (Resource / ResourceMetadata).
 */
const ID_FIELDS: Partial<Record<ExtensionReadQueryKey, string[]>> = {
  Resource: ['.'],
  ResourceMetadata: ['.'],
  ListComments: ['targetId'],
  ListDiscussions: ['targetId'],
  ListCommentsByReference: ['targetId'],
  ListCommentsByAuthor: ['authorId'],
  ListCitations: ['targetId'],
  ListChanges: ['targetId'],
  ListCapabilities: ['targetId'],
  ListDocumentCollaborators: ['targetId'],
  InteractionSummary: ['id'],
}

/** Id-free inputs validated up front so a bad shape is reported as invalid_params, not internal. */
const PASSTHROUGH_SCHEMAS: Partial<Record<ExtensionReadQueryKey, ZodTypeAny>> = {
  Query: HMQuerySchema,
  Search: HMSearchInputSchema,
  ListEvents: HMListEventsInputSchema,
}

/**
 * Rewrite hm:// string ids inside a read-query input into unpacked ids, per the
 * table above. Other keys are passed through untouched (the universal client's
 * own validation reports shape errors).
 */
export function normalizeQueryInput(key: ExtensionReadQueryKey, input: unknown): unknown {
  const schema = PASSTHROUGH_SCHEMAS[key]
  if (schema) {
    const parsed = schema.safeParse(input)
    if (!parsed.success) {
      const issues = parsed.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('; ')
      throw new ExtensionError('invalid_params', `Invalid ${key} input: ${issues}`)
    }
    return parsed.data
  }
  const fields = ID_FIELDS[key]
  if (!fields) return input
  if (fields.includes('.')) return normalizeHmIdInput(input, 'input')
  if (!input || typeof input !== 'object') {
    throw new ExtensionError('invalid_params', `${key} input must be an object`)
  }
  const out: Record<string, unknown> = {...(input as Record<string, unknown>)}
  for (const field of fields) {
    if (out[field] !== undefined) out[field] = normalizeHmIdInput(out[field], field)
  }
  return out
}

// ── postMessage-safe results ─────────────────────────────────────────────────

/**
 * Make a query result structured-cloneable: BigInt → number (or string when it
 * does not fit), class instances → plain objects, functions/undefined dropped
 * from objects. Typed arrays and Dates are kept (structured clone handles them).
 */
export function toCloneable(value: unknown): unknown {
  return toCloneableInner(value, 0)
}

function toCloneableInner(value: unknown, depth: number): unknown {
  if (depth > 64) return null
  if (value === null || value === undefined) return value ?? null
  switch (typeof value) {
    case 'bigint':
      return value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= BigInt(Number.MIN_SAFE_INTEGER)
        ? Number(value)
        : value.toString()
    case 'function':
    case 'symbol':
      return null
    case 'object':
      break
    default:
      return value
  }
  if (Array.isArray(value)) return value.map((v) => toCloneableInner(v, depth + 1))
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer || value instanceof Date) return value
  if (value instanceof Map) {
    return Object.fromEntries(Array.from(value.entries()).map(([k, v]) => [String(k), toCloneableInner(v, depth + 1)]))
  }
  if (value instanceof Set) return Array.from(value).map((v) => toCloneableInner(v, depth + 1))
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (v === undefined || typeof v === 'function' || typeof v === 'symbol') continue
    out[k] = toCloneableInner(v, depth + 1)
  }
  return out
}

// ── Base64 ───────────────────────────────────────────────────────────────────

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)))
  }
  return btoa(binary)
}

export function base64ToBytes(base64: string): Uint8Array {
  let binary: string
  try {
    binary = atob(base64.replace(/-/g, '+').replace(/_/g, '/'))
  } catch {
    throw new ExtensionError('invalid_params', 'base64 is not valid base64')
  }
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

export function bytesToHexPreview(bytes: Uint8Array, max = 32): string {
  const shown = bytes.subarray(0, max)
  let hex = ''
  for (let i = 0; i < shown.length; i++) hex += shown[i]!.toString(16).padStart(2, '0')
  return bytes.length > max ? `${hex}…` : hex
}

// ── URL validation ───────────────────────────────────────────────────────────

export function validateNavigateUrl(url: string): string {
  if (url.startsWith('hm://')) {
    if (!unpackHmId(url)) throw new ExtensionError('invalid_params', `navigate: invalid hm:// URL: ${url}`)
    return url
  }
  if (url.startsWith('/') && !url.startsWith('//') && !url.includes('\\')) {
    // WHATWG URL parsing treats `\` like `/` for http(s), so `/\evil.com`
    // resolves to another origin. Parse against a placeholder origin and
    // require that the origin is unchanged.
    const base = 'https://placeholder.invalid'
    let parsed: URL | null = null
    try {
      parsed = new URL(url, base)
    } catch {}
    if (parsed && parsed.origin === base) return url
  }
  throw new ExtensionError(
    'invalid_params',
    'navigate: url must be an hm:// URL or a site-relative path starting with /',
  )
}

export function validateExternalUrl(url: string): string {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new ExtensionError('invalid_params', `openExternal: invalid URL: ${url}`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ExtensionError('invalid_params', 'openExternal: only http(s) URLs may be opened')
  }
  return parsed.toString()
}

/**
 * A dev-override URL taken from the page URL (`?extdev=`) is only honoured
 * when it points at a loopback host. Anyone can craft a link with the param,
 * and the override persists in localStorage for the whole origin, so a remote
 * URL here would let a link silently replace an installed extension's code.
 * Overrides typed into the desktop settings editor are not subject to this
 * (that path is explicit) and may be any http(s) URL.
 *
 * Returns the URL unchanged when it is an http(s) loopback URL, else null.
 */
export function loopbackDevUrl(raw: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return null
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
  const host = parsed.hostname
  const loopback = host === 'localhost' || host.endsWith('.localhost') || host === '127.0.0.1' || host === '[::1]'
  return loopback ? raw : null
}

/** Short principal for display: `z6MkabcD…wxyz`. */
export function shortId(id: string, head = 8, tail = 4): string {
  if (id.length <= head + tail + 1) return id
  return `${id.slice(0, head)}…${id.slice(-tail)}`
}

/** Generate a random 8-char block id (same alphabet as the editor). */
export function randomBlockId(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  const bytes = new Uint8Array(8)
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(bytes)
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256)
  let out = ''
  for (let i = 0; i < bytes.length; i++) out += alphabet[bytes[i]! % alphabet.length]
  return out
}
