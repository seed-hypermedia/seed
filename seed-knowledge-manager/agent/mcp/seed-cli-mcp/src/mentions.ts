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
      const m = ann.link.match(/^hm:\/\/([^/?#]+)/)
      if (!m) continue
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
  }
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
