// Polyfill for Uint8Array.prototype.toBase64 and Uint8Array.fromBase64.
// This is required for environments that don't support these methods yet.
import 'core-js/modules/es.uint8-array.from-base64.js'
import 'core-js/modules/es.uint8-array.to-base64.js'

declare global {
  interface Uint8Array {
    toBase64(options?: {alphabet?: 'base64' | 'base64url'; omitPadding?: boolean}): string
  }
  interface Uint8ArrayConstructor {
    fromBase64(string: string, options?: {alphabet?: 'base64' | 'base64url'}): Uint8Array
  }
}

/**
 * Encode Uint8Array to base64url string.
 */
export function encode(data: Uint8Array): string {
  return data.toBase64({alphabet: 'base64url', omitPadding: true})
}

/**
 * Decode base64url string to Uint8Array.
 */
export function decode(data: string): Uint8Array {
  return Uint8Array.fromBase64(data, {alphabet: 'base64url'})
}
