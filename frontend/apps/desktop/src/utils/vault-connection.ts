/** Normalize a vault origin URL for consistent comparison and API calls. */
export function normalizeVaultOriginURL(rawUrl: string, fieldName: string): string {
  let parsedURL: URL
  try {
    parsedURL = new URL(rawUrl.trim())
  } catch {
    throw new Error(`Invalid ${fieldName}`)
  }

  if (parsedURL.protocol !== 'https:' && parsedURL.protocol !== 'http:') {
    throw new Error(`Invalid ${fieldName}`)
  }
  if (!parsedURL.host || parsedURL.username || parsedURL.password) {
    throw new Error(`Invalid ${fieldName}`)
  }
  if (parsedURL.search || parsedURL.hash) {
    throw new Error(`Invalid ${fieldName}`)
  }

  const normalizedPath = parsedURL.pathname === '/' ? '' : parsedURL.pathname.replace(/\/+$/, '')
  return `${parsedURL.protocol}//${parsedURL.host}${normalizedPath}`
}

/** Build the browser handoff URL for remote-vault connection. */
export function buildVaultConnectionURL(vaultUrl: string, handoffToken: string, callbackBase: string): string {
  const vaultOrigin = normalizeVaultOriginURL(vaultUrl, 'vault URL')
  const callbackOrigin = normalizeVaultOriginURL(callbackBase, 'callback URL')
  const callbackURL = new URL('/vault-handoff', `${callbackOrigin}/`)
  const connectionURL = new URL(vaultOrigin)
  connectionURL.pathname = connectionURL.pathname ? `${connectionURL.pathname}/connect` : '/connect'
  connectionURL.hash = new URLSearchParams({
    token: handoffToken,
    callback: callbackURL.toString(),
  }).toString()
  return connectionURL.toString()
}
