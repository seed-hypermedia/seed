/** TODO: enable after both release channels publish signatures and ship their public keys. */
export const UPDATE_SIGNATURE_REQUIRED = false

/** Development bootstrap key. Replace alongside the dev signing secret before publishing signed dev updates. */
export const DEV_UPDATE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA8xn8MFnLUa9K3RPQDkqG++T7zLrUITKwzrLe10jCusQ=
-----END PUBLIC KEY-----`

/** PLACEHOLDER: populate with the production Ed25519 public key before enforcing signatures. */
export const PROD_UPDATE_PUBLIC_KEY = ''

/** Canonical JSON: recursively sorted UTF-16 keys, original array order, JSON number/string encoding. */
export function canonicalManifest(manifest: Record<string, unknown>): string {
  const {signature: _signature, ...unsigned} = manifest
  function encode(value: unknown): string {
    if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value)
    if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value)
    if (Array.isArray(value)) return `[${value.map(encode).join(',')}]`
    if (typeof value === 'object' && value !== null) {
      return `{${Object.keys(value)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${encode((value as Record<string, unknown>)[key])}`)
        .join(',')}}`
    }
    throw new Error('Manifest must contain only JSON values')
  }
  return encode(unsigned)
}
