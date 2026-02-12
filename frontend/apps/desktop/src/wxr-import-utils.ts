import {createHash} from 'crypto'

const AUTHOR_EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function normalizeAuthorLogin(login: string | null | undefined): string {
  const trimmed = (login || '').trim()
  if (!trimmed) return ''

  const cdataMatch = trimmed.match(/^<!\[CDATA\[(.*)\]\]>$/i)
  const withoutCdata = cdataMatch ? cdataMatch[1] : trimmed

  return withoutCdata
    .replace(/^[<>]+|[<>]+$/g, '')
    .trim()
    .toLowerCase()
}

export function fallbackAuthorLogin(postId: number): string {
  return `unknown-author-${postId}`
}

export function getAuthorDisplayName(
  login: string,
  displayName?: string,
): string {
  const normalizedDisplayName = (displayName || '').trim()
  return normalizedDisplayName || login
}

export function isEmailUsableForAuthored(
  email: string | null | undefined,
): boolean {
  const normalizedEmail = (email || '').trim()
  return AUTHOR_EMAIL_REGEX.test(normalizedEmail)
}

export function createAuthorKeyName(scope: string, login: string): string {
  const normalized = normalizeAuthorLogin(login)
  const normalizedScope = scope.trim().toLowerCase()
  const slug = normalized
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)

  const base = slug || 'author'
  const digest = createHash('sha1')
    .update(`${normalizedScope}:${normalized}`)
    .digest('hex')
    .slice(0, 8)
  return `wxr-author-${base}-${digest}`
}

/**
 * Extract the last path segment (slug) from a WordPress post <link> URL.
 * E.g. "https://example.com/2018/10/20/my-post/" -> "my-post"
 * Returns null if the URL is empty or unparseable.
 */
export function extractSlugFromLink(
  link: string | null | undefined,
): string | null {
  const trimmed = (link || '').trim()
  if (!trimmed) return null

  try {
    const url = new URL(trimmed)
    const segments = url.pathname
      .replace(/\/+$/, '') // strip trailing slashes
      .split('/')
      .filter(Boolean) // remove empty segments

    const lastSegment = segments[segments.length - 1]
    return lastSegment || null
  } catch {
    // Not a valid URL, try treating it as a path.
    const segments = trimmed.replace(/\/+$/, '').split('/').filter(Boolean)

    const lastSegment = segments[segments.length - 1]
    return lastSegment || null
  }
}

export function normalizeWXRSlug(
  slug: string | null | undefined,
  postId: number,
): string {
  const raw = (slug || '').trim()

  let decoded = raw
  if (raw.includes('%')) {
    try {
      decoded = decodeURIComponent(raw)
    } catch {
      decoded = raw
    }
  }

  const cleaned = decoded
    .trim()
    .replace(/^\/+|\/+$/g, '')
    .replace(/\//g, '-')
    .replace(/[?#]/g, '-')
    .replace(/[\u0000-\u001f]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')

  return cleaned || `post-${postId}`
}
