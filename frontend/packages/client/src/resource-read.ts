import {createSeedClient, type SeedClient} from './client'
import {resolveId, type DomainResolverFn} from './hm-resolver'
import {unpackHmId, type UnpackedHypermediaId} from './hm-types'

/** Options for resolving a user-supplied hypermedia ID or web URL. */
export type ResolveIdWithClientOptions = {
  client?: SeedClient
  serverUrl?: string
  domainResolver?: DomainResolverFn
}

/** Resolved hypermedia ID with the Seed client that should be used to read it. */
export type ResolvedIdWithClient = {
  id: UnpackedHypermediaId
  client: SeedClient
  serverUrl: string
}

/**
 * Resolves an hm:// ID, gateway URL, or Seed site URL and returns the matching Seed client.
 *
 * This is the shared implementation used by CLI-like document readers:
 * - hm:// IDs use the caller's configured client/server.
 * - web URLs resolve through the documented OPTIONS/header flow and then read from that URL's origin.
 */
export async function resolveIdWithClient(
  rawId: string,
  options: ResolveIdWithClientOptions = {},
): Promise<ResolvedIdWithClient> {
  const commentId = extractCommentIdFromReadableUrl(rawId)
  const parsed = commentId ? commentIdToHmId(commentId) : unpackHmId(rawId)
  if (parsed) {
    if (isWebUrl(rawId)) {
      const origin = new URL(rawId).origin
      return {id: parsed, client: createSeedClient(origin), serverUrl: origin}
    }
    const client = options.client ?? createSeedClient(normalizeServerUrl(options.serverUrl || 'https://hyper.media'))
    return {id: parsed, client, serverUrl: client.baseUrl}
  }

  const id = await resolveId(rawId, {domainResolver: options.domainResolver})
  const origin = new URL(rawId).origin
  return {id, client: createSeedClient(origin), serverUrl: origin}
}

const COMMENT_VIEW_TERMS = new Set([':comments', ':comment', ':discussions'])

function extractCommentIdFromReadableUrl(rawId: string): string | null {
  if (isWebUrl(rawId)) {
    const url = new URL(rawId)
    const panelCommentId = extractCommentIdFromPanel(url.searchParams.get('panel'))
    if (panelCommentId) return panelCommentId
    return extractCommentIdFromPath(url.pathname.split('/').filter(Boolean))
  }

  const [withoutHash] = rawId.split('#')
  const [withoutQuery] = withoutHash!.split('?')
  const parsed = unpackHmId(withoutQuery)
  return parsed?.path ? extractCommentIdFromPath(parsed.path) : null
}

function extractCommentIdFromPanel(panel: string | null): string | null {
  if (!panel) return null
  const [viewTerm, first, second] = panel.split('/')
  if (viewTerm !== 'comments' && viewTerm !== 'comment' && viewTerm !== 'discussions') return null
  if (first && second) return `${first}/${second}`
  return first || null
}

function extractCommentIdFromPath(pathParts: string[]): string | null {
  if (pathParts.length >= 3) {
    const thirdToLast = pathParts[pathParts.length - 3]
    if (thirdToLast && COMMENT_VIEW_TERMS.has(thirdToLast)) {
      return `${pathParts[pathParts.length - 2]}/${pathParts[pathParts.length - 1]}`
    }
  }

  if (pathParts.length >= 2) {
    const secondToLast = pathParts[pathParts.length - 2]
    if (secondToLast && COMMENT_VIEW_TERMS.has(secondToLast)) return pathParts[pathParts.length - 1] || null
  }

  return null
}

function commentIdToHmId(commentId: string): UnpackedHypermediaId {
  const parsed = unpackHmId(`hm://${commentId}`)
  if (!parsed) throw new Error(`Invalid comment ID: ${commentId}`)
  return parsed
}

function isWebUrl(rawId: string): boolean {
  return rawId.startsWith('http://') || rawId.startsWith('https://')
}

function normalizeServerUrl(serverUrl: string): string {
  const withScheme =
    serverUrl.startsWith('http://') || serverUrl.startsWith('https://') ? serverUrl : `https://${serverUrl}`
  return withScheme.replace(/\/+$/, '')
}
