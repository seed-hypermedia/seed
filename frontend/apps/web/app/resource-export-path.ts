/**
 * URL path parsing for hypermedia requests, including the `.md` / `.json`
 * export syntax. The export extension attaches to the document path segment,
 * and view-term suffixes come after it:
 *
 *   /guides/publishing.md
 *   /guides/publishing.md/:attributes
 *   /guides/publishing.json/:activity/citations
 *   /guides/publishing.md/:comments/z6Mk.../abc123
 *
 * These helpers are pure (no server imports) so they can be unit tested.
 */
import {hmId, VIEW_TERMS, viewTermToRouteKey, ViewRouteKey} from '@shm/shared'

export const COMMENT_VIEW_TERMS = [':comments', ':comment', ':discussions']

export function extractCommentId(pathParts: string[]): string | null {
  if (pathParts.length >= 3) {
    const thirdToLast = pathParts[pathParts.length - 3]!
    if (COMMENT_VIEW_TERMS.includes(thirdToLast)) {
      return `${pathParts[pathParts.length - 2]}/${pathParts[pathParts.length - 1]}`
    }
  }
  if (pathParts.length >= 2) {
    const secondToLast = pathParts[pathParts.length - 2]!
    if (COMMENT_VIEW_TERMS.includes(secondToLast)) {
      return pathParts[pathParts.length - 1]!
    }
  }
  return null
}

export function stripInspectPrefix(pathParts: string[]): string[] {
  if (pathParts[0] === 'hm' && pathParts[1] === 'inspect') {
    return ['hm', ...pathParts.slice(2)]
  }
  if (pathParts[0] === 'inspect') {
    return pathParts.slice(1)
  }
  return pathParts
}

export function getHmIdOfRequest(
  {pathParts, url}: {pathParts: string[]; url: URL},
  originAccountId: string | undefined,
) {
  const effectivePathParts = stripInspectPrefix(pathParts)
  const version = url.searchParams.get('v')
  const latest = url.searchParams.get('l') === '' || !version
  if (effectivePathParts.length === 0) {
    if (!originAccountId) return null
    return hmId(originAccountId, {path: [], version, latest})
  }
  if (effectivePathParts[0] === 'hm') {
    return hmId(effectivePathParts[1]!, {path: effectivePathParts.slice(2), version, latest})
  }
  if (!originAccountId) return null
  return hmId(originAccountId, {path: effectivePathParts, version, latest})
}

export type ResourceExportFormat = 'markdown' | 'json'

export type ResourceExportPath = {
  format: ResourceExportFormat
  /** The request path parts with the export extension stripped (view terms intact). */
  pathParts: string[]
}

const FORMAT_EXTENSIONS: [string, ResourceExportFormat][] = [
  ['.md', 'markdown'],
  ['.json', 'json'],
]

/** App routes under /hm/ that must never be intercepted by export handling. */
const RESERVED_HM_SUBROUTES = new Set([
  'api',
  'agents',
  'auth',
  'connect',
  'create-site',
  'download',
  'embed',
  'notifications',
  'register',
])

/**
 * Detect a `.md` / `.json` export extension in a URL path.
 *
 * The extension is recognized on the last path segment, or on an earlier
 * segment when everything after it is a `:view-term` suffix (so both
 * `publishing.md` and `publishing.md/:attributes` work, as well as
 * `publishing/:comments/z6Mk.../abc.md`).
 *
 * Returns null when the path carries no export extension, or when it belongs
 * to a reserved app route (e.g. /hm/api/... file downloads).
 */
export function parseResourceExportPath(pathParts: string[]): ResourceExportPath | null {
  if (pathParts[0] === 'hm' && pathParts[1] && RESERVED_HM_SUBROUTES.has(pathParts[1])) {
    return null
  }
  for (let i = 0; i < pathParts.length; i++) {
    const part = pathParts[i]!
    const isLast = i === pathParts.length - 1
    if (!isLast && !pathParts[i + 1]!.startsWith(':')) continue
    for (const [extension, format] of FORMAT_EXTENSIONS) {
      if (!part.endsWith(extension)) continue
      const stripped = part.slice(0, -extension.length)
      return {
        format,
        pathParts: [...pathParts.slice(0, i), ...(stripped ? [stripped] : []), ...pathParts.slice(i + 1)],
      }
    }
  }
  return null
}

export type ResourceExportView =
  | {key: 'document'}
  | {key: 'comments'; commentId?: string}
  | {key: 'activity'; filterSlug?: string}
  | {key: Exclude<ViewRouteKey, 'comments' | 'activity'>}

/**
 * Split an export path into the document path and the requested view,
 * mirroring the web page routing in routes/$.tsx.
 */
export function extractExportView(pathParts: string[]): {
  docPathParts: string[]
  view: ResourceExportView
} {
  if (pathParts.length >= 3 && COMMENT_VIEW_TERMS.includes(pathParts[pathParts.length - 3]!)) {
    return {
      docPathParts: pathParts.slice(0, -3),
      view: {
        key: 'comments',
        commentId: `${pathParts[pathParts.length - 2]}/${pathParts[pathParts.length - 1]}`,
      },
    }
  }
  if (pathParts.length >= 2 && COMMENT_VIEW_TERMS.includes(pathParts[pathParts.length - 2]!)) {
    return {
      docPathParts: pathParts.slice(0, -2),
      view: {key: 'comments', commentId: pathParts[pathParts.length - 1]!},
    }
  }
  if (pathParts.length >= 2 && pathParts[pathParts.length - 2] === ':activity') {
    return {
      docPathParts: pathParts.slice(0, -2),
      view: {key: 'activity', filterSlug: pathParts[pathParts.length - 1]!},
    }
  }
  const lastPart = pathParts[pathParts.length - 1]
  const viewTerm = VIEW_TERMS.find((term) => term === lastPart)
  const viewKey = viewTerm ? viewTermToRouteKey(viewTerm) : null
  if (viewKey) {
    return {docPathParts: pathParts.slice(0, -1), view: {key: viewKey} as ResourceExportView}
  }
  return {docPathParts: pathParts, view: {key: 'document'}}
}
