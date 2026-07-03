import type * as api from '@/api'

/** Activity event shape returned by the HM ActivityFeed API. */
export type ActivityFeedEvent = Record<string, unknown>

/** Returns a stable idempotency key for an HM activity event, when one can be derived safely. */
export function activityEventKey(event: ActivityFeedEvent): string | null {
  const feedEventId = stringField(event, 'feedEventId')
  if (feedEventId) return feedEventId
  const id = stringField(event, 'id')
  const type = stringField(event, 'type')
  if (id && type) return `${type}-${id}`
  const blob = activityEventBlob(event)
  if (blob) {
    const cid = stringField(blob, 'cid')
    if (cid && cid !== 'undefined') return `blob-${cid}`
    const blobId = stringField(blob, 'blobId') || stringField(blob, 'blob_id')
    if (blobId) return `blob-id-${blobId}`
  }

  const mention = activityEventMention(event)
  if (mention) {
    const sourceBlob = recordField(mention, 'sourceBlob') || recordField(mention, 'source_blob')
    const cid = sourceBlob ? stringField(sourceBlob, 'cid') : undefined
    const target = stringField(mention, 'target')
    const citationType = stringField(mention, 'citationType') || stringField(mention, 'citation_type')
    if (cid && cid !== 'undefined' && target) return `mention-${cid}-${citationType || ''}-${target}`
  }

  return null
}

/**
 * Returns the idempotency key used to deduplicate `trigger_firings` for an activity event.
 *
 * A single comment that @mentions an account produces TWO sibling events from `/api/ListEvents`: a
 * `comment` event (`feedEventId: blob-<cid>`) and a `citation` event (`feedEventId: mention-<cid>--<target>`).
 * Both carry the *same* origin CID — the comment version. They are indexed a few seconds apart, so the
 * monitor can see them in different polls and the staleness watermark can drop whichever arrives second.
 * To make the mention fire exactly once regardless of which sibling is processed first (and survive the
 * other being dropped), we collapse the citation onto its comment sibling's `blob-<cid>` identity here.
 *
 * Comment events keep their natural `blob-<cid>` key, so non-mention activity (document comments, site
 * updates) and existing firing keys are unchanged. Falls back to {@link activityEventKey} for shapes
 * with no recognizable comment CID.
 */
export function activityFiringKey(event: ActivityFeedEvent): string | null {
  const key = activityEventKey(event)
  if (!key) return null
  if (key.startsWith('mention-')) {
    const rest = key.slice('mention-'.length)
    const separatorIndex = rest.indexOf('--')
    // The CID precedes the first `--` in both the resolved citation form (`mention-<cid>--<target>`)
    // and the raw `newCitation` fallback (`mention-<cid>-<type>-<target>`). Collapsing onto `blob-<cid>`
    // unifies the citation with the comment event that shares the same comment-version CID.
    if (separatorIndex > 0) return `blob-${rest.slice(0, separatorIndex)}`
  }
  return key
}

/** Canonicalizes a user-entered HM document/resource URL for exact trigger matching. */
export function canonicalizeResourceId(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return trimmed
  try {
    const url = new URL(trimmed)
    if (url.protocol === 'hm:') {
      const path = canonicalPath(url.pathname)
      return `hm://${url.hostname}${path}`
    }
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      const parts = url.pathname.split('/').filter(Boolean)
      const hmIndex = parts.indexOf('hm')
      if (hmIndex >= 0 && parts[hmIndex + 1]) {
        const uid = decodeURIComponent(parts[hmIndex + 1]!)
        const pathParts = parts.slice(hmIndex + 2).filter((part) => !part.startsWith(':'))
        return `hm://${uid}${canonicalPath(pathParts.map(decodeURIComponent).join('/'))}`
      }
    }
  } catch {
    // Fall through and apply lightweight query/hash stripping below.
  }
  const [withoutHash] = trimmed.split('#', 1)
  const [withoutQuery] = (withoutHash || trimmed).split('?', 1)
  return withoutQuery?.replace(/\/+$/u, '') || trimmed
}

/** Returns true when an HM activity event matches a saved agent trigger source. */
export function activityMatchesTriggerSource(source: api.AgentTriggerSource, event: ActivityFeedEvent): boolean {
  if (source.type === 'document-comment') return matchesDocumentComment(source, event)
  if (source.type === 'user-mention') return matchesUserMention(source, event)
  if (source.type === 'site-update') return matchesSiteUpdate(source, event)
  return false
}

/** Returns the best event timestamp in milliseconds, or null if the feed did not provide one. */
export function activityEventTimeMs(event: ActivityFeedEvent): number | null {
  const eventAtMs = numberField(event, 'eventAtMs')
  if (eventAtMs !== undefined) return eventAtMs
  const loadedTime = timestampMs(event.time)
  if (loadedTime !== null) return loadedTime
  const eventTime = timestampMs(event.eventTime)
  const observeTime = timestampMs(event.observeTime)
  if (eventTime !== null && observeTime !== null) return Math.max(eventTime, observeTime)
  return eventTime ?? observeTime
}

/** Returns compact non-content metadata useful for observing trigger matching. */
export function activityDebugInfo(event: ActivityFeedEvent): Record<string, unknown> {
  const blob = activityEventBlob(event)
  const mention = activityEventMention(event)
  return {
    key: activityEventKey(event),
    type: stringField(event, 'type') || eventDataCase(event),
    timeMs: activityEventTimeMs(event),
    blobType: blob ? stringField(blob, 'blobType') || stringField(blob, 'blob_type') : undefined,
    resource: blob ? stringField(blob, 'resource') : undefined,
    mentionTarget: mention ? stringField(mention, 'target') : undefined,
    mentionSource: mention
      ? stringField(mention, 'source') ||
        stringField(mention, 'sourceDocument') ||
        stringField(mention, 'source_document')
      : undefined,
  }
}

/** Creates a compact human-readable activity summary for trigger-created session titles and UI. */
export function activitySummary(event: ActivityFeedEvent): string {
  const blob = activityEventBlob(event)
  if (blob) {
    const blobType = stringField(blob, 'blobType') || stringField(blob, 'blob_type') || 'activity'
    const resource = stringField(blob, 'resource')
    return resource ? `${blobType} on ${resource}` : blobType
  }
  const mention = activityEventMention(event)
  if (mention) {
    const target = stringField(mention, 'target') || 'unknown target'
    const source = stringField(mention, 'source')
    return source ? `Mention of ${target} from ${source}` : `Mention of ${target}`
  }
  const type = stringField(event, 'type')
  if (type === 'schedule') {
    const scheduledAt = numberField(event, 'scheduledAt')
    const kind = stringField(event, 'scheduleKind') || 'schedule'
    return scheduledAt ? `Scheduled ${kind} at ${new Date(scheduledAt).toISOString()}` : 'Scheduled run'
  }
  const title = stringField(recordField(recordField(event, 'target') || {}, 'metadata') || {}, 'name')
  return title ? `${type || 'activity'} on ${title}` : type || 'Seed activity'
}

function matchesDocumentComment(
  source: Extract<api.AgentTriggerSource, {type: 'document-comment'}>,
  event: ActivityFeedEvent,
): boolean {
  const sourceResource = canonicalizeResourceId(source.resource)
  if (stringField(event, 'type') === 'comment') {
    if (source.author && !jsonContainsString(recordField(event, 'author') || event, source.author)) return false
    const target = activityCommentTarget(event)
    return target
      ? target === sourceResource || target.startsWith(`${sourceResource}/`)
      : jsonContainsString(event, sourceResource)
  }
  const blob = activityEventBlob(event)
  if (!blob) return false
  const blobType = stringField(blob, 'blobType') || stringField(blob, 'blob_type')
  if (blobType?.toLowerCase() !== 'comment') return false
  if (source.author) {
    const author = stringField(blob, 'author') || stringField(event, 'account')
    if (author !== source.author) return false
  }
  const resource = stringField(blob, 'resource')
  const canonicalResource = resource ? canonicalizeResourceId(resource) : undefined
  return (
    canonicalResource === sourceResource || (!!canonicalResource && canonicalResource.startsWith(`${sourceResource}/`))
  )
}

function activityCommentTarget(event: ActivityFeedEvent): string | null {
  const target = recordField(event, 'target')
  const targetId = target ? recordField(target, 'id') : null
  const targetIdString = targetId ? stringField(targetId, 'id') : undefined
  if (targetIdString) return canonicalizeResourceId(targetIdString)
  const comment = recordField(event, 'comment')
  const account = comment ? stringField(comment, 'targetAccount') : undefined
  if (!account) return null
  const targetPath = comment ? stringField(comment, 'targetPath') || '' : ''
  return canonicalizeResourceId(`hm://${account}${targetPath ? `/${targetPath.replace(/^\/+/, '')}` : ''}`)
}

/** Reads the mentioned account list, tolerating legacy triggers that stored a single `mentionedAccount`. */
export function mentionedAccountsOf(source: Extract<api.AgentTriggerSource, {type: 'user-mention'}>): string[] {
  const legacy = (source as {mentionedAccount?: string}).mentionedAccount
  const accounts = source.mentionedAccounts ?? (legacy ? [legacy] : [])
  return accounts.filter((account) => !!account)
}

function matchesUserMention(
  source: Extract<api.AgentTriggerSource, {type: 'user-mention'}>,
  event: ActivityFeedEvent,
): boolean {
  return mentionedAccountsOf(source).some((mentionedAccount) => matchesSingleMention(mentionedAccount, source, event))
}

/**
 * Decides whether a single activity event is a genuine @mention of `mentionedAccount`.
 *
 * Two event shapes are supported:
 *  - Raw ActivityFeed events (`newCitation`), used by tests and any caller that bypasses the
 *    resolving `/api/ListEvents` endpoint.
 *  - Resolved `LoadedEvent`s (the shape `/api/ListEvents` actually returns), where mentions live in
 *    comment-block `Embed` annotations (`type: 'comment'`) or in citation targets (`type: 'citation'`).
 *
 * Detection is structural (mirroring the notification classifier) rather than a substring scan, so a
 * trigger fires only when the account is actually mentioned — not merely because its UID appears as an
 * author, reply parent, or cited document. Both the comment event and its comment-sourced citation twin
 * are allowed to match; duplicate firings are prevented downstream by {@link activityFiringKey}, which
 * collapses the two siblings onto one shared comment-CID idempotency key.
 */
function matchesSingleMention(
  mentionedAccount: string,
  source: Extract<api.AgentTriggerSource, {type: 'user-mention'}>,
  event: ActivityFeedEvent,
): boolean {
  // Raw ActivityFeed `newCitation` events.
  const mention = activityEventMention(event)
  if (mention) {
    const accountTarget = `hm://${mentionedAccount}`
    const target = stringField(mention, 'target')
    if (target !== mentionedAccount && target !== accountTarget && !target?.startsWith(`${accountTarget}/`)) {
      return false
    }
    if (!source.resourcePrefix) return true
    return [
      stringField(mention, 'source'),
      stringField(mention, 'sourceDocument') || stringField(mention, 'source_document'),
      target,
    ].some((value) => !!value && value.startsWith(source.resourcePrefix!))
  }

  // Resolved LoadedEvents.
  const type = stringField(event, 'type')
  if (type === 'comment') {
    if (!commentMentionsAccount(recordField(event, 'comment'), mentionedAccount)) return false
    return mentionMatchesResourcePrefix(event, source.resourcePrefix)
  }
  if (type === 'citation') {
    // A comment-sourced citation (`citationType: 'c'`) mirrors its comment event. We deliberately do
    // NOT suppress it here: the two are emitted as separate feed events that can arrive in different
    // polls, and the comment event is sometimes dropped by the staleness watermark. Letting either
    // sibling match — deduplicated to one firing by {@link activityFiringKey} (shared comment CID) —
    // makes the mention fire exactly once instead of being silently missed.
    const target = recordField(event, 'target')
    const targetId = target ? recordField(target, 'id') : null
    if (mentionedAccountFromIdRecord(targetId) !== mentionedAccount) return false
    return mentionMatchesResourcePrefix(event, source.resourcePrefix)
  }

  return false
}

/** Resolves the account UID a mention link points at, when it targets an account root or `:profile`. */
function mentionedAccountFromLink(link: unknown): string | null {
  if (typeof link !== 'string') return null
  const trimmed = link.trim()
  if (!trimmed.startsWith('hm://')) return null
  const withoutScheme = trimmed.slice('hm://'.length)
  const pathOnly = withoutScheme.split('?')[0]?.split('#')[0] || ''
  const segments = pathOnly.split('/').filter(Boolean)
  const uid = segments[0]
  if (!uid) return null
  if (segments.length === 1) return uid // account root
  if (segments[1] === ':profile') return uid // profile mention
  return null // points at a document, not the account itself
}

/** Resolves the account UID from a resolved `UnpackedHypermediaId` record, when it names an account. */
function mentionedAccountFromIdRecord(idRecord: Record<string, unknown> | null): string | null {
  if (!idRecord) return null
  const uid = stringField(idRecord, 'uid')
  if (!uid) return null
  const path = idRecord['path']
  if (!Array.isArray(path) || path.length === 0) return uid // account root
  if (path[0] === ':profile') return uid // profile mention
  return null // points at a document, not the account itself
}

/** Returns true when a resolved comment's content embeds a mention of `mentionedAccount`. */
function commentMentionsAccount(comment: Record<string, unknown> | null, mentionedAccount: string): boolean {
  if (!comment) return false
  return blockNodesMentionAccount(comment['content'], mentionedAccount)
}

function blockNodesMentionAccount(nodes: unknown, mentionedAccount: string): boolean {
  if (!Array.isArray(nodes)) return false
  return nodes.some((node) => {
    if (!node || typeof node !== 'object') return false
    const block = recordField(node as Record<string, unknown>, 'block')
    const annotations = block ? block['annotations'] : undefined
    if (Array.isArray(annotations)) {
      for (const annotation of annotations) {
        if (!annotation || typeof annotation !== 'object') continue
        if ((annotation as Record<string, unknown>).type !== 'Embed') continue
        if (mentionedAccountFromLink((annotation as Record<string, unknown>).link) === mentionedAccount) return true
      }
    }
    return blockNodesMentionAccount((node as Record<string, unknown>).children, mentionedAccount)
  })
}

/** Applies the optional resource/site prefix filter against the resources a mention event references. */
function mentionMatchesResourcePrefix(event: ActivityFeedEvent, resourcePrefix: string | undefined): boolean {
  if (!resourcePrefix) return true
  const candidates: Array<string | undefined> = []
  for (const field of ['source', 'target', 'commentId'] as const) {
    const record = recordField(event, field)
    const id = record ? recordField(record, 'id') : null
    candidates.push(id ? stringField(id, 'id') : stringField(record || {}, 'id'))
  }
  if (candidates.some((value) => !!value && value.startsWith(resourcePrefix))) return true
  // Fall back to a broad scan so unusual event shapes still honour an explicit prefix filter.
  return jsonContainsString(event, resourcePrefix)
}

function matchesSiteUpdate(
  source: Extract<api.AgentTriggerSource, {type: 'site-update'}>,
  event: ActivityFeedEvent,
): boolean {
  const resource = siteUpdateResource(event)
  if (resource) {
    if (!resource.startsWith(source.resourcePrefix)) return false
  } else if (!jsonContainsString(event, source.resourcePrefix)) {
    return false
  }

  if (!source.eventTypes?.length) return true
  const eventTypes = siteUpdateEventTypes(event)
  return source.eventTypes.some((eventType) => eventTypes.some((actual) => activityTypeMatches(eventType, actual)))
}

function siteUpdateResource(event: ActivityFeedEvent): string | null {
  const blob = activityEventBlob(event)
  const blobResource = blob ? stringField(blob, 'resource') : undefined
  if (blobResource) return canonicalizeResourceId(blobResource)

  const docId = recordField(event, 'docId')
  const docIdString = docId ? stringField(docId, 'id') : undefined
  if (docIdString) return canonicalizeResourceId(docIdString)

  const target = recordField(event, 'target')
  const targetId = target ? recordField(target, 'id') : null
  const targetIdString = targetId ? stringField(targetId, 'id') : undefined
  if (targetIdString) return canonicalizeResourceId(targetIdString)

  const commentTarget = activityCommentTarget(event)
  if (commentTarget) return commentTarget

  const document = recordField(event, 'document')
  const account = document ? stringField(document, 'account') : undefined
  if (account) {
    const path = document ? stringField(document, 'path') || '' : ''
    return canonicalizeResourceId(`hm://${account}${path ? `/${path.replace(/^\/+/, '')}` : ''}`)
  }

  return null
}

function siteUpdateEventTypes(event: ActivityFeedEvent): string[] {
  const types: string[] = []
  const type = stringField(event, 'type')
  if (type) types.push(type)

  const dataCase = eventDataCase(event)
  if (dataCase) types.push(dataCase)

  const blob = activityEventBlob(event)
  const blobType = blob ? stringField(blob, 'blobType') || stringField(blob, 'blob_type') : undefined
  if (blobType) types.push(blobType)

  return types
}

function activityTypeMatches(configured: string, actual: string): boolean {
  const configuredType = configured.trim().toLowerCase()
  const actualType = actual.trim().toLowerCase()
  if (!configuredType || !actualType) return false
  if (configuredType === actualType) return true

  const aliases: Record<string, string[]> = {
    change: ['doc-update', 'document-update', 'ref'],
    ref: ['doc-update', 'document-update', 'change'],
    comment: ['comment'],
    'doc-update': ['change', 'ref', 'document-update'],
    'document-update': ['change', 'ref', 'doc-update'],
  }
  return aliases[configuredType]?.includes(actualType) || false
}

function canonicalPath(path: string): string {
  const withoutQuerySyntax = path.split('?')[0]?.split('#')[0] || ''
  const clean = withoutQuerySyntax.replace(/^\/+|\/+$/gu, '')
  return clean ? `/${clean}` : ''
}

function activityEventBlob(event: ActivityFeedEvent): Record<string, unknown> | null {
  return recordField(event, 'newBlob') || recordField(event, 'new_blob') || activityEventDataValue(event, 'newBlob')
}

function activityEventMention(event: ActivityFeedEvent): Record<string, unknown> | null {
  return (
    recordField(event, 'newCitation') ||
    recordField(event, 'new_citation') ||
    activityEventDataValue(event, 'newCitation')
  )
}

function eventDataCase(event: ActivityFeedEvent): string | undefined {
  const data = recordField(event, 'data')
  return data ? stringField(data, 'case') : undefined
}

function activityEventDataValue(
  event: ActivityFeedEvent,
  expectedCase: 'newBlob' | 'newCitation',
): Record<string, unknown> | null {
  const data = recordField(event, 'data')
  if (!data || stringField(data, 'case') !== expectedCase) return null
  return recordField(data, 'value')
}

function recordField(record: Record<string, unknown>, field: string): Record<string, unknown> | null {
  const value = record[field]
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function stringField(record: Record<string, unknown>, field: string): string | undefined {
  const value = record[field]
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  return undefined
}

function numberField(record: Record<string, unknown>, field: string): number | undefined {
  const value = record[field]
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

function jsonContainsString(value: unknown, needle: string): boolean {
  if (!needle) return false
  if (typeof value === 'string') return value === needle || value.includes(needle)
  if (typeof value === 'number' || typeof value === 'boolean' || value === null || value === undefined) return false
  if (Array.isArray(value)) return value.some((item) => jsonContainsString(item, needle))
  if (typeof value === 'object')
    return Object.values(value as Record<string, unknown>).some((item) => jsonContainsString(item, needle))
  return false
}

function timestampMs(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>
    const seconds = record.seconds
    const nanos = record.nanos ?? record.nanosSinceSecond
    const secondsNumber = typeof seconds === 'number' ? seconds : typeof seconds === 'string' ? Number(seconds) : NaN
    const nanosNumber = typeof nanos === 'number' ? nanos : typeof nanos === 'string' ? Number(nanos) : 0
    if (Number.isFinite(secondsNumber))
      return secondsNumber * 1000 + (Number.isFinite(nanosNumber) ? nanosNumber / 1e6 : 0)
  }
  return null
}
