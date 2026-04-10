function getVaultAppPath(pathname: string) {
  const withoutDelegate = pathname.replace(/\/delegate\/?$/, '')
  if (withoutDelegate.length > 1 && withoutDelegate.endsWith('/')) {
    return withoutDelegate.slice(0, -1)
  }
  return withoutDelegate || pathname
}

function parseVaultUrl(vaultUrl: string) {
  try {
    return new URL(vaultUrl)
  } catch {
    if (typeof window === 'undefined') {
      return null
    }

    try {
      return new URL(vaultUrl, window.location.origin)
    } catch {
      return null
    }
  }
}

/**
 * Builds a vault account URL from the locally stored vault session details.
 */
export function getVaultAccountSettingsUrl({vaultUrl, accountUid}: {vaultUrl?: string; accountUid?: string}) {
  if (!vaultUrl || !accountUid) {
    return null
  }

  const parsedVaultUrl = parseVaultUrl(vaultUrl)
  if (!parsedVaultUrl) {
    return null
  }

  parsedVaultUrl.pathname = getVaultAppPath(parsedVaultUrl.pathname)
  parsedVaultUrl.search = ''
  parsedVaultUrl.hash = `/a/${encodeURIComponent(accountUid)}`

  return parsedVaultUrl.toString()
}
