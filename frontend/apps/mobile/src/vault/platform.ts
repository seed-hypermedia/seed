/**
 * Conditional global polyfills for the Hermes runtime (iOS/Android).
 *
 * react-native-web (and jsdom in tests) already provides all of these, so on
 * web every branch below is a no-op. Each polyfill installs only when the
 * global is absent — never replacing a native implementation.
 *
 * Imported for side effects as the FIRST import of the app entry (index.ts) so
 * every later module sees the filled-in globals.
 */

import {deflate, deflateRaw, gzip, inflate, inflateRaw, ungzip} from 'pako'

type AnyGlobal = typeof globalThis & {
  crypto?: Crypto
  TextEncoder?: typeof TextEncoder
  TextDecoder?: typeof TextDecoder
  CompressionStream?: unknown
  DecompressionStream?: unknown
}

const g = globalThis as AnyGlobal

// ─── crypto.getRandomValues (expo-crypto) ────────────────────────────────────

if (!g.crypto) {
  ;(g as {crypto: unknown}).crypto = {}
}

if (typeof g.crypto!.getRandomValues !== 'function') {
  const {getRandomBytes} = require('expo-crypto') as typeof import('expo-crypto')
  ;(g.crypto as {getRandomValues: unknown}).getRandomValues = <T extends ArrayBufferView | null>(array: T): T => {
    if (!array) return array
    const bytes = getRandomBytes(array.byteLength)
    new Uint8Array(array.buffer, array.byteOffset, array.byteLength).set(bytes)
    return array
  }
}

// ─── crypto.randomUUID ───────────────────────────────────────────────────────
// Hermes has none. The shared agents models use it for client request ids and for the optimistic
// message ids that let a durable echo replace its pending row, so it has to exist before any agents
// code runs. Built on getRandomValues above, so it inherits expo-crypto's CSPRNG.

if (typeof g.crypto!.randomUUID !== 'function') {
  ;(g.crypto as {randomUUID: unknown}).randomUUID = (): string => {
    const bytes = new Uint8Array(16)
    g.crypto!.getRandomValues(bytes)
    // RFC 4122 §4.4: version 4, variant 10xx.
    bytes[6] = (bytes[6] & 0x0f) | 0x40
    bytes[8] = (bytes[8] & 0x3f) | 0x80
    const hex: string[] = []
    for (let i = 0; i < 16; i++) hex.push(bytes[i].toString(16).padStart(2, '0'))
    return (
      `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-` +
      `${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`
    )
  }
}

// ─── crypto.subtle.digest (noble hashes) ─────────────────────────────────────
// Hermes has no WebCrypto. The publish path needs digest only (multiformats'
// sha2-browser hasher, redirected to by metro.config.js). HKDF is deliberately
// NOT polyfilled — mobile vault code uses noble HKDF directly (src/vault/crypto.ts).

if (!g.crypto!.subtle) {
  const {sha256} = require('@noble/hashes/sha256') as typeof import('@noble/hashes/sha256')
  const {sha384, sha512} = require('@noble/hashes/sha512') as typeof import('@noble/hashes/sha512')

  const digest = (algorithm: string | {name: string}, data: ArrayBufferView | ArrayBuffer): Promise<ArrayBuffer> => {
    const name = (typeof algorithm === 'string' ? algorithm : algorithm.name).toUpperCase()
    const bytes =
      data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
    let hashed: Uint8Array
    switch (name) {
      case 'SHA-256':
        hashed = sha256(bytes)
        break
      case 'SHA-384':
        hashed = sha384(bytes)
        break
      case 'SHA-512':
        hashed = sha512(bytes)
        break
      default:
        return Promise.reject(new Error(`Unsupported digest algorithm: ${name}`))
    }
    // Copy so the returned ArrayBuffer is exactly the hash length.
    return Promise.resolve(hashed.slice().buffer as ArrayBuffer)
  }

  Object.defineProperty(g.crypto, 'subtle', {
    value: {digest},
    configurable: true,
  })
}

// ─── TextEncoder / TextDecoder (pure JS UTF-8) ───────────────────────────────
// Shipping Hermes has TextEncoder but no TextDecoder; the Vault Connect
// payload decrypt → JSON.parse path needs decode.

function utf8Encode(input: string): Uint8Array {
  const out: number[] = []
  for (let i = 0; i < input.length; i++) {
    let code = input.charCodeAt(i)
    // Combine surrogate pairs.
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < input.length) {
      const next = input.charCodeAt(i + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00)
        i++
      }
    }
    if (code < 0x80) {
      out.push(code)
    } else if (code < 0x800) {
      out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f))
    } else if (code < 0x10000) {
      out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f))
    } else {
      out.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f))
    }
  }
  return Uint8Array.from(out)
}

function utf8Decode(bytes: Uint8Array): string {
  let result = ''
  let i = 0
  while (i < bytes.length) {
    const byte = bytes[i]
    let codePoint: number
    if (byte < 0x80) {
      codePoint = byte
      i += 1
    } else if ((byte & 0xe0) === 0xc0) {
      codePoint = ((byte & 0x1f) << 6) | (bytes[i + 1] & 0x3f)
      i += 2
    } else if ((byte & 0xf0) === 0xe0) {
      codePoint = ((byte & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f)
      i += 3
    } else if ((byte & 0xf8) === 0xf0) {
      codePoint =
        ((byte & 0x07) << 18) | ((bytes[i + 1] & 0x3f) << 12) | ((bytes[i + 2] & 0x3f) << 6) | (bytes[i + 3] & 0x3f)
      i += 4
    } else {
      codePoint = 0xfffd // Replacement character for invalid sequences.
      i += 1
    }
    if (Number.isNaN(codePoint)) codePoint = 0xfffd
    result += String.fromCodePoint(codePoint)
  }
  return result
}

if (typeof g.TextEncoder === 'undefined') {
  class TextEncoderPolyfill {
    readonly encoding = 'utf-8'
    encode(input = ''): Uint8Array {
      return utf8Encode(input)
    }
  }
  g.TextEncoder = TextEncoderPolyfill as unknown as typeof TextEncoder
}

if (typeof g.TextDecoder === 'undefined') {
  class TextDecoderPolyfill {
    readonly encoding: string
    constructor(label = 'utf-8') {
      const normalized = label.toLowerCase()
      if (normalized !== 'utf-8' && normalized !== 'utf8' && normalized !== 'unicode-1-1-utf-8') {
        throw new RangeError(`Unsupported encoding: ${label}`)
      }
      this.encoding = 'utf-8'
    }
    decode(input?: ArrayBufferView | ArrayBuffer): string {
      if (input == null) return ''
      const bytes =
        input instanceof ArrayBuffer
          ? new Uint8Array(input)
          : new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
      return utf8Decode(bytes)
    }
  }
  g.TextDecoder = TextDecoderPolyfill as unknown as typeof TextDecoder
}

// ─── CompressionStream / DecompressionStream (pako) ──────────────────────────
// Minimal duck-typed streams: buffer chunks in the writer, transform once on
// close, emit a single chunk from the reader. Sufficient for the vault codec,
// which writes exactly one chunk and collects the whole output.

type StreamFormat = 'gzip' | 'deflate' | 'deflate-raw'

function concatChunks(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, c) => sum + c.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

class PakoUnaryStream {
  readonly writable: {getWriter(): {write(chunk: Uint8Array): Promise<void>; close(): Promise<void>}}
  readonly readable: {getReader(): {read(): Promise<{done: boolean; value?: Uint8Array}>}}

  constructor(transform: (data: Uint8Array) => Uint8Array) {
    const chunks: Uint8Array[] = []
    let resolveResult!: (value: Uint8Array) => void
    let rejectResult!: (error: unknown) => void
    const result = new Promise<Uint8Array>((resolve, reject) => {
      resolveResult = resolve
      rejectResult = reject
    })

    this.writable = {
      getWriter: () => ({
        write: (chunk: Uint8Array) => {
          chunks.push(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk as ArrayBufferLike as ArrayBuffer))
          return Promise.resolve()
        },
        close: () => {
          try {
            resolveResult(transform(concatChunks(chunks)))
            return Promise.resolve()
          } catch (error) {
            rejectResult(error)
            return Promise.reject(error)
          }
        },
      }),
    }

    this.readable = {
      getReader: () => {
        let emitted = false
        return {
          read: async () => {
            const value = await result
            if (emitted) return {done: true}
            emitted = true
            return {done: false, value}
          },
        }
      },
    }
  }
}

function compressTransform(format: StreamFormat): (data: Uint8Array) => Uint8Array {
  switch (format) {
    case 'gzip':
      return (data) => gzip(data)
    case 'deflate':
      return (data) => deflate(data)
    case 'deflate-raw':
      return (data) => deflateRaw(data)
    default:
      throw new TypeError(`Unsupported compression format: ${format}`)
  }
}

function decompressTransform(format: StreamFormat): (data: Uint8Array) => Uint8Array {
  switch (format) {
    case 'gzip':
      return (data) => ungzip(data)
    case 'deflate':
      return (data) => inflate(data)
    case 'deflate-raw':
      return (data) => inflateRaw(data)
    default:
      throw new TypeError(`Unsupported decompression format: ${format}`)
  }
}

if (typeof g.CompressionStream === 'undefined') {
  class CompressionStreamPolyfill extends PakoUnaryStream {
    constructor(format: StreamFormat) {
      super(compressTransform(format))
    }
  }
  g.CompressionStream = CompressionStreamPolyfill as unknown as typeof CompressionStream
}

if (typeof g.DecompressionStream === 'undefined') {
  class DecompressionStreamPolyfill extends PakoUnaryStream {
    constructor(format: StreamFormat) {
      super(decompressTransform(format))
    }
  }
  g.DecompressionStream = DecompressionStreamPolyfill as unknown as typeof DecompressionStream
}

// Hermes has no DOM Event global, but progress-events (a dependency of
// ipfs-unixfs-importer, reached through @seed-hypermedia/client's file-to-ipfs)
// declares `class CustomProgressEvent extends Event` at module scope, which
// crashes the whole bundle at startup in release builds. Its instances only
// carry `type`/`detail` to onProgress callbacks, so a minimal Event suffices.
if (typeof g.Event === 'undefined') {
  class EventPolyfill {
    type: string
    bubbles: boolean
    cancelable: boolean
    composed: boolean
    defaultPrevented = false
    isTrusted = false
    timeStamp = Date.now()
    constructor(type: string, init?: {bubbles?: boolean; cancelable?: boolean; composed?: boolean}) {
      if (arguments.length === 0) {
        throw new TypeError("Failed to construct 'Event': 1 argument required, but only 0 present.")
      }
      this.type = String(type)
      this.bubbles = !!init?.bubbles
      this.cancelable = !!init?.cancelable
      this.composed = !!init?.composed
    }
    preventDefault() {
      if (this.cancelable) this.defaultPrevented = true
    }
    stopPropagation() {}
    stopImmediatePropagation() {}
  }
  g.Event = EventPolyfill as unknown as typeof Event
}

export {}
