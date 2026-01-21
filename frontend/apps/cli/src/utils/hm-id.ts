/**
 * Hypermedia ID utilities
 */

export type UnpackedHmId = {
  id: string
  uid: string
  path: string[] | null
  version: string | null
  blockRef: string | null
  blockRange: BlockRange | null
  hostname: string | null
  scheme: string | null
  latest?: boolean | null
}

export type BlockRange = {
  start?: number
  end?: number
  expanded?: boolean
}

/**
 * Parse a hypermedia ID string into its components
 * Supports: hm://uid/path?v=version#blockRef
 *
 * Returns object with ALL fields required by the API schema
 */
export function unpackHmId(idOrUid: string): UnpackedHmId | null {
  if (!idOrUid) return null

  let uid: string
  let path: string[] | null = null
  let version: string | null = null
  let blockRef: string | null = null

  // Handle bare UID (no scheme)
  if (!idOrUid.includes('://') && !idOrUid.includes('/')) {
    uid = idOrUid
  } else if (idOrUid.startsWith('hm://')) {
    // Parse hm:// URLs manually to preserve case (URL API lowercases hostname)
    const withoutScheme = idOrUid.slice(5) // remove 'hm://'
    const hashIndex = withoutScheme.indexOf('#')
    const queryIndex = withoutScheme.indexOf('?')

    let mainPart = withoutScheme
    if (hashIndex !== -1) {
      blockRef = withoutScheme.slice(hashIndex + 1).split(/[:\[\]]/)[0] || null
      mainPart = withoutScheme.slice(0, hashIndex)
    }
    if (queryIndex !== -1) {
      const queryPart = mainPart.slice(queryIndex + 1)
      mainPart = mainPart.slice(0, queryIndex)
      const params = new URLSearchParams(queryPart)
      version = params.get('v') || null
    }

    const pathParts = mainPart.split('/').filter(Boolean)
    uid = pathParts[0] || ''
    path = pathParts.length > 1 ? pathParts.slice(1) : null
  } else {
    // Not a valid hm:// URL
    return null
  }

  // Reconstruct the base ID
  let id = `hm://${uid}`
  if (path && path.length > 0) {
    id += `/${path.join('/')}`
  }

  // Return with ALL fields required by the schema (nullable fields as null)
  // Note: `latest` is optional, only include if explicitly false (has version)
  const result: UnpackedHmId = {
    id,
    uid,
    path,
    version,
    blockRef,
    blockRange: null,
    hostname: null,
    scheme: 'hm',
  }

  // Only include latest if it's explicitly false (has specific version)
  if (version) {
    result.latest = false
  }

  return result
}

/**
 * Create an hm:// URL from components
 */
export function packHmId(unpacked: UnpackedHmId): string {
  let url = `hm://${unpacked.uid}`

  if (unpacked.path && unpacked.path.length > 0) {
    url += `/${unpacked.path.join('/')}`
  }

  if (unpacked.version) {
    url += `?v=${unpacked.version}`
  }

  if (unpacked.blockRef) {
    url += `#${unpacked.blockRef}`
  }

  return url
}

/**
 * Create an UnpackedHmId from uid and optional path/version
 */
export function hmId(
  uid: string,
  options?: {
    path?: string[] | null
    version?: string | null
    blockRef?: string | null
  }
): UnpackedHmId {
  const path = options?.path || null
  let id = `hm://${uid}`
  if (path && path.length > 0) {
    id += `/${path.join('/')}`
  }

  return {
    id,
    uid,
    path,
    version: options?.version || null,
    blockRef: options?.blockRef || null,
    blockRange: null,
    hostname: null,
    scheme: 'hm',
    latest: !options?.version,
  }
}
