/**
 * Mention parsing and classification.
 *
 * Seed represents inline mentions as the literal text `@[Name](hm://accountId)`
 * in comment bodies and in document blocks. Block-level comments are
 * targeted by appending `#blockId` to the document URL.
 *
 * `Mention.kind` distinguishes how the agent should respond:
 *   - `comment`     — mention inside a comment body. Reply via threaded
 *                     comment (`comment create --reply <commentId>`).
 *   - `doc-block`   — mention inside a document block. Reply via a
 *                     block-anchored top-level comment
 *                     (`comment create <docId>#<blockId>`).
 */

export type MentionKind = 'comment' | 'doc-block'

/**
 * How the mention was discovered. `'mention'` = an explicit `@KM` embed
 * or inline `@[…](hm://kmAccountId)` was found in the comment/doc.
 * `'thread-reply'` = the comment has no explicit mention but is a reply
 * (direct or transitive) inside a thread where KM has already commented,
 * so the agent treats it as a continued conversation. Optional in the
 * type so legacy `placeholders.jsonl` records (written before this
 * field existed) still deserialize cleanly — readers should treat
 * `undefined` as `'mention'`.
 */
export type MentionTriggerSource = 'mention' | 'thread-reply'

export type Mention = {
  kind: MentionKind
  /** Hypermedia ID of the document the mention lives on. */
  docId: string
  /** Block ID where the mention is anchored. May be undefined for comment-body mentions on the doc level. */
  blockId?: string
  /** ID of the comment containing the mention (only when kind === 'comment'). */
  commentId?: string
  /** AccountId (z6Mk…) of the comment / doc author. */
  author: string
  /** Verbatim text containing the mention, used to classify the request. */
  text: string
  /** Activity event timestamp (ISO). */
  ts: string
  /** Discriminator: explicit mention vs implicit thread-reply trigger. */
  triggerSource?: MentionTriggerSource
}

const MENTION_RE = /@\[[^\]]*\]\(hm:\/\/([^)#]+)(?:[^)]*)?\)/g

export function findMentionTargets(text: string): string[] {
  const ids: string[] = []
  for (const m of text.matchAll(MENTION_RE)) {
    if (m[1]) ids.push(m[1])
  }
  return ids
}

export function mentionsAccount(text: string, accountId: string): boolean {
  return findMentionTargets(text).includes(accountId)
}

/**
 * Classifies an activity event into a Mention or null. The shape of
 * `event` follows the daemon's `activity` API; we only consume what we
 * need so future field additions don't break us.
 */
/**
 * Activity-feed event shape (selected fields). Real events include many
 * more keys; we read only what we need to identify a candidate comment.
 *
 *   { "id": "bafy...", "type": "comment", "time": "...",
 *     "author": {"id": {"uid": "z6Mk..."}} }
 */
export type ActivityEvent = {
  id?: string
  type?: string
  time?: string
  author?: string | {id?: {uid?: string}}
}

export function unwrapAuthor(a: ActivityEvent['author']): string | undefined {
  if (typeof a === 'string') return a
  if (a && typeof a === 'object') return a.id?.uid
  return undefined
}

/**
 * Returns the comment record id to fetch if this event is a comment with
 * an author. Activity events store the comment's record id in `event.id`.
 * We don't try to detect mentions inside doc-update events here; that
 * requires a separate doc fetch (deferred to v2).
 */
export function commentEventCandidate(event: ActivityEvent): {commentId: string; author: string; ts: string} | null {
  if (event.type !== 'comment') return null
  if (!event.id) return null
  const author = unwrapAuthor(event.author)
  if (!author) return null
  return {commentId: event.id, author, ts: event.time ?? new Date().toISOString()}
}

/**
 * Shape returned by `seed-cli comment get <id>`.
 */
export type SeedComment = {
  id: string
  author: string
  targetAccount: string
  targetPath?: string
  replyParent?: string
  threadRoot?: string
  content?: Array<{
    block?: {
      id?: string
      text?: string
      annotations?: Array<{type?: string; link?: string}>
    }
  }>
}

/**
 * Detects whether a fetched comment contains a mention of any of the
 * given accountIds. Mentions are stored as `Embed` annotations whose
 * `link` starts with `hm://<accountId>`. Seed renders them as a U+FFFC
 * object-replacement character with the link held on the annotation.
 *
 * The agent treats both itself (its own KM_AID) and the site root as
 * trigger targets — when a writer mentions the site by name in a
 * comment, the agent (which holds a WRITER capability on that site)
 * should respond as if mentioned directly.
 *
 * Returns the {blockId, text} of the first block carrying any matching
 * mention, or null otherwise.
 */
export function findKmMentionInComment(
  comment: SeedComment,
  accountIds: string | readonly string[],
): {blockId?: string; text: string} | null {
  const ids = typeof accountIds === 'string' ? [accountIds] : accountIds
  const idSet = new Set(ids)
  for (const item of comment.content ?? []) {
    const block = item.block
    if (!block) continue
    for (const ann of block.annotations ?? []) {
      if (ann.type !== 'Embed') continue
      if (typeof ann.link !== 'string') continue
      const m = ann.link.match(/^hm:\/\/([^/?#]+)(\/.*)?/)
      if (!m) continue
      // Document links (hm://account/path) are NOT mentions — skip.
      // But /:profile is an account mention, not a document.
      if (m[2] && m[2] !== '/:profile' && !m[2].startsWith('/:profile?')) continue
      if (idSet.has(m[1]!)) {
        return {blockId: block.id, text: block.text ?? ''}
      }
    }
    // Fallback: inline `@[…](hm://aid)` markdown syntax.
    if (block.text) {
      for (const id of ids) {
        if (mentionsAccount(block.text, id)) {
          return {blockId: block.id, text: block.text}
        }
      }
    }
  }
  return null
}

/**
 * Builds a Mention from a fetched comment. Caller has already determined
 * the mention-text + blockId via findKmMentionInComment.
 */
export function buildCommentMention(
  comment: SeedComment,
  evidence: {blockId?: string; text: string},
  ts: string,
): Mention {
  const docId = `hm://${comment.targetAccount}${comment.targetPath ?? ''}`
  return {
    kind: 'comment',
    docId,
    blockId: evidence.blockId,
    commentId: comment.id,
    author: comment.author,
    text: evidence.text,
    ts,
    triggerSource: 'mention',
  }
}

/**
 * Builds a Mention for a comment that fired the trigger via the
 * thread-reply path (no explicit `@KM` embed; an ancestor on the
 * replyParent chain was authored by KM). Since there's no embed
 * evidence to point at a specific block, we use the comment's full
 * body — every block's text joined by `\n`, with U+FFFC
 * object-replacement characters replaced by spaces so the LLM sees the
 * raw question rather than embed placeholders. `blockId` is omitted —
 * the reply is threaded via `--reply commentId`, no doc-block anchor
 * needed.
 */
export function buildThreadReplyMention(comment: SeedComment, ts: string): Mention {
  const docId = `hm://${comment.targetAccount}${comment.targetPath ?? ''}`
  const parts: string[] = []
  for (const item of comment.content ?? []) {
    const t = item.block?.text
    if (typeof t === 'string') parts.push(t.replace(/￼/g, ' '))
  }
  return {
    kind: 'comment',
    docId,
    commentId: comment.id,
    author: comment.author,
    text: parts.join('\n').trim(),
    ts,
    triggerSource: 'thread-reply',
  }
}

/**
 * Walks the comment's `replyParent` chain looking for an ancestor
 * authored by KM. Returns the first KM-authored ancestor's commentId
 * (the one closest to the current comment) when found, or null.
 *
 * `fetchComment` is injected so the detection stays unit-testable
 * without shelling out through `seed-cli`. `cache` is shared across
 * calls inside a single poll cycle so a deep thread fetched once is
 * not refetched when sibling replies trigger lookups. `maxHops`
 * defaults to 30 (matches `walkThread` in reply-engine.ts) and a
 * `visited` set guards against cycles or self-references in malformed
 * chains.
 */
export async function detectThreadReplyToKm(opts: {
  comment: SeedComment
  kmAccountId: string
  fetchComment: (id: string) => Promise<SeedComment | null>
  cache: Map<string, SeedComment | null>
  maxHops?: number
}): Promise<{ancestorCommentId: string} | null> {
  const {comment, kmAccountId, fetchComment, cache} = opts
  const maxHops = opts.maxHops ?? 30
  const visited = new Set<string>([comment.id])
  let parentId = comment.replyParent?.trim() || undefined
  for (let hop = 0; hop < maxHops && parentId; hop++) {
    if (visited.has(parentId)) return null
    visited.add(parentId)
    let parent: SeedComment | null | undefined = cache.get(parentId)
    if (parent === undefined) {
      parent = await fetchComment(parentId)
      cache.set(parentId, parent)
    }
    if (!parent) return null
    if (parent.author === kmAccountId) return {ancestorCommentId: parent.id}
    parentId = parent.replyParent?.trim() || undefined
  }
  return null
}

// Legacy helper kept for tests and the (disabled) inbox_enqueue_from_event tool.
export function classifyEvent(event: ActivityEvent & {comment?: any; document?: any}, kmAccountId: string): Mention | null {
  if (event.comment) {
    const c = event.comment as {id?: string; target?: string; body?: string; author?: string; time?: string; blockId?: string}
    if (!c.body || !c.target || !c.author || !c.id) return null
    if (!mentionsAccount(c.body, kmAccountId)) return null
    return {
      kind: 'comment',
      docId: stripFragment(c.target),
      blockId: extractBlockId(c.target) ?? c.blockId,
      commentId: c.id,
      author: c.author,
      text: c.body,
      ts: c.time ?? new Date().toISOString(),
    }
  }
  if (event.document) {
    const d = event.document as {id?: string; blocks?: Array<{id?: string; text?: string}>; author?: string; time?: string}
    if (!d.id || !d.author || !Array.isArray(d.blocks)) return null
    for (const block of d.blocks) {
      if (block.text && mentionsAccount(block.text, kmAccountId)) {
        return {
          kind: 'doc-block',
          docId: d.id,
          blockId: block.id,
          author: d.author,
          text: block.text,
          ts: d.time ?? new Date().toISOString(),
        }
      }
    }
  }
  return null
}

export function extractBlockId(target: string): string | undefined {
  const m = target.match(/#([^?]+)/)
  return m?.[1]
}

export function stripFragment(target: string): string {
  return target.split('#')[0]!
}

export function buildReplyTarget(m: Mention): {targetId: string; replyTo?: string} {
  if (m.kind === 'comment') {
    // Threaded reply. The blockId on the mention belongs to a block of
    // the *comment* (not the parent doc), so we MUST NOT append it to
    // the doc URL — that would render as a broken doc-block embed.
    // Threading is handled via --reply <commentId>.
    return {
      targetId: m.docId,
      replyTo: m.commentId,
    }
  }
  // doc-block: anchor a top-level comment to the doc block carrying
  // the mention.
  if (m.blockId) return {targetId: `${m.docId}#${m.blockId}`}
  return {targetId: m.docId}
}
