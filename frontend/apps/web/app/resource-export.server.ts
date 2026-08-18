/**
 * Raw markdown / JSON export for web URLs, for agents, bots, and CLI tools.
 *
 * Any resource URL requested with a `.md` or `.json` extension on the document
 * path segment is served as raw data instead of the React app:
 *
 *   GET /guides/publishing.md                    → document as markdown
 *   GET /guides/publishing.json                  → document as JSON
 *   GET /guides/publishing.md/:attributes        → document metadata (frontmatter only)
 *   GET /guides/publishing.md/:comments          → all comments on the document
 *   GET /guides/publishing.md/:comments/UID/TSID → one comment
 *   GET /guides/publishing.json/:activity        → activity feed for the document
 *   GET /guides/publishing.json/:activity/citations → citation events only
 *   GET /guides/publishing.json/:collaborators   → collaborators
 *   GET /guides/publishing.json/:directory       → child documents
 *   GET /hm/UID/some-path.md                     → cross-account access
 *
 * Markdown rendering uses the shared resolved-markdown workflow from
 * @seed-hypermedia/client (the same one used by the CLI and Agents service):
 * YAML frontmatter with the document metadata, resolved mention names, inline
 * embed content, and executed query blocks.
 */
import {
  commentToResolvedMarkdown,
  documentToResolvedMarkdown,
  emitFrontmatter,
  type ResolvedMarkdownOptions,
} from '@seed-hypermedia/client'
import type {HMComment, HMDocument, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {
  activitySlugToFilter,
  commentIdToHmId,
  getCommentTargetId,
  getDocumentTitle,
  hmId,
  hmIdPathToEntityQueryPath,
  normalizeDate,
} from '@shm/shared'
import {HMNotFoundError} from '@shm/shared/models/entity'
import {createResourceMetadata, metadataToHeaders} from './hypermedia-metadata'
import {getComment, resolveResource} from './loaders'
import type {ParsedRequest} from './request'
import {
  extractExportView,
  getHmIdOfRequest,
  ResourceExportFormat,
  ResourceExportPath,
} from './resource-export-path'
import {serverUniversalClient} from './server-universal-client'
import {getConfig} from './site-config.server'

export {parseResourceExportPath} from './resource-export-path'

export const EXPOSED_HYPERMEDIA_HEADERS =
  'X-Hypermedia-Id, X-Hypermedia-Version, X-Hypermedia-Title, X-Hypermedia-Target, X-Hypermedia-Authors, X-Hypermedia-Type'

// UniversalClient['request'] and SeedClient['request'] share the same HMRequest
// signature, but the compiler sees two module instances of hm-types through the
// @shm/shared and @seed-hypermedia/client resolution paths, so a cast bridges them.
const RESOLVE_OPTIONS: ResolvedMarkdownOptions = {
  client: {
    request: serverUniversalClient.request as unknown as ResolvedMarkdownOptions['client']['request'],
  },
}

function exportResponse(
  format: ResourceExportFormat,
  body: string,
  opts?: {status?: number; headers?: Record<string, string>},
): Response {
  return new Response(body.endsWith('\n') ? body : body + '\n', {
    status: opts?.status || 200,
    headers: {
      'Content-Type': format === 'json' ? 'application/json; charset=utf-8' : 'text/markdown; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Expose-Headers': EXPOSED_HYPERMEDIA_HEADERS,
      'Cache-Control': 'public, max-age=60',
      ...opts?.headers,
    },
  })
}

/** Plain JSON (not superjson-wrapped like the hm/api routes), so any HTTP client can consume it. */
function exportJSON(value: unknown, opts?: {status?: number; headers?: Record<string, string>}): Response {
  const body = JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2)
  return exportResponse('json', body + '\n', opts)
}

function exportError(format: ResourceExportFormat, status: number, message: string): Response {
  const headers = {'Cache-Control': 'no-store'}
  if (format === 'json') {
    return exportResponse('json', JSON.stringify({error: message}, null, 2) + '\n', {status, headers})
  }
  return exportResponse('markdown', message + '\n', {status, headers})
}

function formatTime(time: unknown): string {
  const date = normalizeDate(time as Parameters<typeof normalizeDate>[0])
  return date ? date.toISOString() : ''
}

export async function handleResourceExportRequest(
  parsedRequest: ParsedRequest,
  exportPath: ResourceExportPath,
): Promise<Response> {
  const {format} = exportPath
  try {
    const serviceConfig = await getConfig(parsedRequest.hostname)
    const originAccountId = serviceConfig?.registeredAccountUid
    const {docPathParts, view} = extractExportView(exportPath.pathParts)

    if (view.key === 'comments' && view.commentId) {
      const comment = await getComment(view.commentId)
      if (!comment) return exportError(format, 404, 'Comment not found')
      return await commentExportResponse(format, commentIdToHmId(view.commentId), comment)
    }

    const resourceId = getHmIdOfRequest({...parsedRequest, pathParts: docPathParts}, originAccountId)
    if (!resourceId) {
      return exportError(format, 404, 'Could not resolve this URL to a hypermedia resource')
    }

    switch (view.key) {
      case 'document':
        return await documentExportResponse(format, resourceId)
      case 'metadata':
        return await metadataExportResponse(format, resourceId)
      case 'comments':
        return await commentsExportResponse(format, resourceId)
      case 'activity':
        return await activityExportResponse(format, parsedRequest, resourceId, view.filterSlug)
      case 'feed':
        return await activityExportResponse(format, parsedRequest, null, undefined)
      case 'collaborators':
        return await collaboratorsExportResponse(format, resourceId)
      case 'directory':
        return await directoryExportResponse(format, resourceId, 'Children')
      case 'all-documents':
        return await directoryExportResponse(format, resourceId, 'AllDescendants')
      default:
        return exportError(format, 404, `The ${view.key} view does not support ${format} export`)
    }
  } catch (e) {
    if (e instanceof HMNotFoundError) {
      return exportError(format, 404, 'Not found')
    }
    console.error('Error handling resource export request:', e)
    const message = e instanceof Error ? e.message : String(e)
    return exportError(format, 500, `Failed to load resource: ${message}`)
  }
}

async function documentExportResponse(format: ResourceExportFormat, resourceId: UnpackedHypermediaId) {
  const resource = await resolveResource(resourceId)
  if (resource.type === 'comment') {
    return await commentExportResponse(format, resourceId, resource.comment)
  }
  if (resource.type !== 'document') {
    return exportError(format, 404, `Resource type ${resource.type} cannot be exported`)
  }
  const headers = metadataToHeaders(createResourceMetadata({id: resourceId, document: resource.document}))
  if (format === 'json') return exportJSON(resource, {headers})
  const markdown = await documentToResolvedMarkdown(resource.document, RESOLVE_OPTIONS)
  return exportResponse(format, markdown, {headers})
}

async function metadataExportResponse(format: ResourceExportFormat, resourceId: UnpackedHypermediaId) {
  const resource = await resolveResource(resourceId)
  if (resource.type !== 'document') {
    return exportError(format, 404, `Resource type ${resource.type} has no attributes view`)
  }
  const document = resource.document
  const headers = metadataToHeaders(createResourceMetadata({id: resourceId, document}))
  if (format === 'json') {
    return exportJSON(
      {id: resourceId.id, version: document.version, authors: document.authors, metadata: document.metadata},
      {headers},
    )
  }
  return exportResponse(format, emitFrontmatter(document.metadata || {}), {headers})
}

async function commentExportResponse(
  format: ResourceExportFormat,
  commentId: UnpackedHypermediaId,
  comment: HMComment,
) {
  const targetId = getCommentTargetId(comment)
  let targetDocument: HMDocument | undefined
  if (targetId) {
    try {
      const target = await resolveResource(targetId)
      if (target.type === 'document') targetDocument = target.document
    } catch (e) {}
  }
  let commentAuthorTitle: string | undefined
  if (comment.author) {
    try {
      const author = await resolveResource(hmId(comment.author))
      if (author.type === 'document' && author.document.metadata.name) {
        commentAuthorTitle = author.document.metadata.name
      }
    } catch (e) {}
  }
  const metadata = createResourceMetadata({id: commentId, document: targetDocument, comment, commentAuthorTitle})
  const headers = metadataToHeaders(metadata)
  if (format === 'json') return exportJSON({type: 'comment', id: commentId, comment}, {headers})
  const frontmatterLines = [
    '---',
    `title: ${JSON.stringify(metadata.title)}`,
    `author: ${JSON.stringify(`hm://${comment.author}`)}`,
    ...(metadata.target ? [`target: ${JSON.stringify(metadata.target)}`] : []),
    `createTime: ${JSON.stringify(formatTime(comment.createTime))}`,
    '---',
    '',
  ]
  const markdown = await commentToResolvedMarkdown(comment, RESOLVE_OPTIONS)
  return exportResponse(format, frontmatterLines.join('\n') + markdown, {headers})
}

async function commentsExportResponse(format: ResourceExportFormat, resourceId: UnpackedHypermediaId) {
  const result = await serverUniversalClient.request('ListComments', {targetId: resourceId})
  if (format === 'json') return exportJSON(result)
  let title = resourceId.id
  try {
    const resource = await resolveResource(resourceId)
    if (resource.type === 'document') title = getDocumentTitle(resource.document)
  } catch (e) {}
  const sections = [`# Comments on ${title}`]
  for (const comment of result.comments) {
    const authorName = result.authors[comment.author]?.metadata?.name || comment.author
    const time = formatTime(comment.createTime)
    const commentMarkdown = await commentToResolvedMarkdown(comment, RESOLVE_OPTIONS)
    sections.push(`## ${authorName} — ${time} <!-- comment:${comment.id} -->\n\n${commentMarkdown}`)
  }
  return exportResponse(format, sections.join('\n\n') + '\n')
}

const ACTIVITY_FILTER_SLUGS = ['comments', 'versions', 'citations']
const ACTIVITY_DEFAULT_PAGE_SIZE = 30

async function activityExportResponse(
  format: ResourceExportFormat,
  parsedRequest: ParsedRequest,
  resourceId: UnpackedHypermediaId | null,
  filterSlug: string | undefined,
) {
  const filterEventType = filterSlug ? activitySlugToFilter(filterSlug) : undefined
  if (filterSlug && !filterEventType) {
    return exportError(
      format,
      404,
      `Unknown activity filter "${filterSlug}" (expected one of: ${ACTIVITY_FILTER_SLUGS.join(', ')})`,
    )
  }
  const pageSizeParam = Number(parsedRequest.url.searchParams.get('pageSize'))
  const result = await serverUniversalClient.request('ListEvents', {
    filterResource: resourceId ? resourceId.id : undefined,
    filterEventType,
    pageSize: Number.isFinite(pageSizeParam) && pageSizeParam > 0 ? pageSizeParam : ACTIVITY_DEFAULT_PAGE_SIZE,
    pageToken: parsedRequest.url.searchParams.get('pageToken') || undefined,
  })
  if (format === 'json') return exportJSON(result)
  const heading = filterSlug ? `# Activity (${filterSlug})` : resourceId ? '# Activity' : '# Feed'
  const lines = [heading, '']
  for (const event of result.events) {
    lines.push(`- ${eventToMarkdown(event)}`)
  }
  if (result.nextPageToken) {
    lines.push('', `<!-- nextPageToken: ${result.nextPageToken} -->`)
  }
  return exportResponse(format, lines.join('\n') + '\n')
}

/** Render one loaded activity event (see @shm/shared activity-service) as a markdown line. */
function eventToMarkdown(event: Record<string, unknown>): string {
  const author = event.author as {id?: UnpackedHypermediaId; metadata?: {name?: string}} | undefined
  const authorName = author?.metadata?.name || author?.id?.uid || 'Unknown'
  const time = formatTime(event.time)
  const type = event.type as string
  switch (type) {
    case 'comment': {
      const commentId = event.commentId as UnpackedHypermediaId | undefined
      const target = event.target as {metadata?: {name?: string}} | undefined
      const targetName = target?.metadata?.name
      return `${time} — Comment by ${authorName}${targetName ? ` on ${targetName}` : ''}${
        commentId ? ` (${commentId.id})` : ''
      }`
    }
    case 'doc-update': {
      const docId = event.docId as UnpackedHypermediaId | undefined
      const docName = (event.document as {metadata?: {name?: string}} | undefined)?.metadata?.name
      return `${time} — ${authorName} updated ${docName || docId?.id || 'a document'}${docId ? ` (${docId.id})` : ''}`
    }
    case 'capability':
      return `${time} — ${authorName} granted a collaborator role`
    case 'contact':
      return `${time} — ${authorName} updated a contact`
    case 'citation':
      return `${time} — ${authorName} cited this document`
    default:
      return `${time} — ${type} event by ${authorName}`
  }
}

async function collaboratorsExportResponse(format: ResourceExportFormat, resourceId: UnpackedHypermediaId) {
  const result = await serverUniversalClient.request('ListDocumentCollaborators', {targetId: resourceId})
  if (format === 'json') return exportJSON(result)
  const lines = ['# Collaborators', '']
  const seen = new Set<string>()
  const addLine = (uid: string, role: string) => {
    if (seen.has(uid)) return
    seen.add(uid)
    const name = result.accounts[uid]?.metadata?.name || uid
    lines.push(`- ${name} (${role}) — hm://${uid}`)
  }
  if (result.publisherUid) addLine(result.publisherUid, 'owner')
  for (const member of [...result.members, ...result.grantedMembers]) {
    addLine(member.account.uid, member.role)
  }
  return exportResponse(format, lines.join('\n') + '\n')
}

async function directoryExportResponse(
  format: ResourceExportFormat,
  resourceId: UnpackedHypermediaId,
  mode: 'Children' | 'AllDescendants',
) {
  const result = await serverUniversalClient.request('Query', {
    includes: [{space: resourceId.uid, path: hmIdPathToEntityQueryPath(resourceId.path), mode}],
  })
  if (format === 'json') return exportJSON(result)
  const lines = [mode === 'Children' ? '# Directory' : '# All Documents', '']
  for (const doc of result?.results || []) {
    const name = doc.metadata?.name || doc.id.path?.join('/') || doc.id.uid
    lines.push(`- [${name}](${doc.id.id})`)
  }
  return exportResponse(format, lines.join('\n') + '\n')
}
