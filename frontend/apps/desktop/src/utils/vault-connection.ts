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

/** Build the Vault Connect URL for remote-vault connection. */
export function buildVaultConnectionURL(vaultUrl: string, connectToken: string, callbackBase: string): string {
  const vaultOrigin = normalizeVaultOriginURL(vaultUrl, 'vault URL')
  normalizeVaultOriginURL(callbackBase, 'callback URL')
  const connectionURL = new URL(vaultOrigin)
  connectionURL.pathname = connectionURL.pathname ? `${connectionURL.pathname}/connect` : '/connect'
  connectionURL.hash = new URLSearchParams({
    token: connectToken,
  }).toString()
  return connectionURL.toString()
}
