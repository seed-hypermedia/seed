/**
 * Minimal base64 helpers for the browser (and Node ≥ 16, which also has
 * `btoa`/`atob`). The bridge carries binary data as standard base64 strings
 * because postMessage payloads must stay JSON-serialisable on every host.
 */

export function base64Encode(bytes: Uint8Array): string {
  let binary = ''
  // Chunked so very large files do not blow the argument limit of String.fromCharCode.
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

export function base64Decode(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

/** Accepts either raw bytes or a string (encoded as UTF-8). */
export function toBytes(data: Uint8Array | string): Uint8Array {
  return typeof data === 'string' ? new TextEncoder().encode(data) : data
}
