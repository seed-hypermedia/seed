/**
 * Mentions in agent-written comments.
 *
 * A mention is an inline `Embed` annotation over a single U+FFFC placeholder whose link names an
 * account (`hm://UID` or `hm://UID/:profile`). That annotation is what the daemon indexes as a
 * `comment/Embed` link, what the activity feed turns into a mention event, and therefore what fires
 * another agent's mention trigger and a person's notification. Nothing else does: a `Link`
 * annotation on the text "@Artist", a link to one of Artist's comments, or the plain word "@Artist"
 * all look like mentions to a reader and summon nobody.
 *
 * The shared markdown parser already turns `[@](hm://UID/:profile)` (any `@…` label) and `<hm://UID/:profile>`
 * into mentions. This module closes the remaining gaps for comment bodies specifically:
 *
 *  - a plain `[Name](hm://UID/:profile)` link is promoted to a mention (a profile link inside a
 *    comment is a person, not a page);
 *  - plain-text `@Name` tokens outside code spans are reported so the write can be refused with
 *    the correct form in the message;
 *  - the accounts a comment actually mentions are collected so the write result can say so.
 */
import {hmAccountMentionUid} from '@seed-hypermedia/client'
import type {HMBlockNode} from '@seed-hypermedia/client/hm-types'

export const MENTION_PLACEHOLDER = '￼'

type Annotation = {
  type: string
  starts: number[]
  ends: number[]
  link?: string
  attributes?: Record<string, unknown>
}

export type PreparedCommentMentions = {
  blocks: HMBlockNode[]
  /** Account uids the comment mentions with inline Embeds, in order of first appearance. */
  mentionedAccounts: string[]
  /** `@word` tokens that are plain text, not mentions, in order of appearance (without the `@`). */
  plainMentions: string[]
}

/** The ready-to-paste markdown that mentions an account: `[@](hm://UID/:profile)`. */
export function mentionMarkdown(accountUid: string): string {
  return `[@](hm://${accountUid}/:profile)`
}

/** Normalizes comment blocks' mentions and reports what they mention and what only looks like it. */
export function prepareCommentMentions(blocks: HMBlockNode[]): PreparedCommentMentions {
  const mentionedAccounts: string[] = []
  const plainMentions: string[] = []
  const prepared = blocks.map((node) => prepareNode(node, mentionedAccounts, plainMentions))
  return {blocks: prepared, mentionedAccounts, plainMentions}
}

/**
 * The refusal for a comment body that still carries plain-text `@Name` tokens. One message, with
 * the exact form that works, so the model's retry is right the first time.
 */
export function plainMentionsError(plainMentions: string[]): string {
  const shown = [...new Set(plainMentions)].slice(0, 5)
  return (
    `Plain-text @mention${shown.length === 1 ? '' : 's'} (${shown.map((name) => `@${name}`).join(', ')}) ` +
    'notify nobody and activate no agent. Mention an account as [@](hm://ACCOUNT_UID/:profile): ' +
    'the account uid is the `author` of any comment you read, and each thread entry in a comment read result ' +
    "prints its author's ready-made mention. If the @ is literal text (an email handle, a CSS at-rule, a " +
    'social handle), pass options.allowPlainMentions: true.'
  )
}

function prepareNode(node: HMBlockNode, mentionedAccounts: string[], plainMentions: string[]): HMBlockNode {
  const block = node.block as unknown as Record<string, unknown>
  const children = Array.isArray(node.children)
    ? node.children.map((child) => prepareNode(child, mentionedAccounts, plainMentions))
    : node.children
  if (typeof block.text !== 'string') return {...node, children} as HMBlockNode
  const prepared = prepareText(block.text, Array.isArray(block.annotations) ? (block.annotations as Annotation[]) : [])
  for (const annotation of prepared.annotations) {
    if (annotation.type !== 'Embed' || typeof annotation.link !== 'string') continue
    const uid = hmAccountMentionUid(annotation.link)
    if (uid && !mentionedAccounts.includes(uid)) mentionedAccounts.push(uid)
  }
  plainMentions.push(...findPlainMentions(prepared.text, prepared.annotations))
  return {
    ...node,
    block: {...block, text: prepared.text, annotations: prepared.annotations} as HMBlockNode['block'],
    children,
  } as HMBlockNode
}

/**
 * Promotes `Link` annotations that point at a `/:profile` to inline mentions. Offsets are Unicode
 * code points (the HM annotation unit), so the text is handled as an array of code points.
 */
function prepareText(text: string, annotations: Annotation[]): {text: string; annotations: Annotation[]} {
  const promotable = annotations.filter(
    (annotation) =>
      annotation.type === 'Link' &&
      typeof annotation.link === 'string' &&
      /\/:profile\/?$/.test(annotation.link.trim()) &&
      hmAccountMentionUid(annotation.link) !== null &&
      annotation.starts.length === 1 &&
      annotation.ends.length === 1 &&
      annotation.ends[0]! > annotation.starts[0]!,
  )
  if (promotable.length === 0) return {text, annotations}

  let codePoints = Array.from(text)
  let current: Annotation[] = annotations.map((annotation) => ({
    ...annotation,
    starts: [...annotation.starts],
    ends: [...annotation.ends],
  }))
  // Right to left, so earlier offsets stay valid while later ranges are rewritten.
  const order = [...promotable].sort((a, b) => b.starts[0]! - a.starts[0]!)
  for (const link of order) {
    const index = current.findIndex((annotation) => sameAnnotation(annotation, link))
    if (index === -1) continue
    const start = link.starts[0]!
    const end = Math.min(link.ends[0]!, codePoints.length)
    if (end <= start) continue
    codePoints = [...codePoints.slice(0, start), MENTION_PLACEHOLDER, ...codePoints.slice(end)]
    const delta = 1 - (end - start)
    const next: Annotation[] = []
    current.forEach((annotation, i) => {
      if (i === index) {
        next.push({
          type: 'Embed',
          starts: [start],
          ends: [start + 1],
          link: link.link!.trim(),
          attributes: {mentionKind: 'account'},
        })
        return
      }
      const shifted = shiftAnnotation(annotation, start, end, delta)
      if (shifted) next.push(shifted)
    })
    current = next
  }
  return {text: codePoints.join(''), annotations: current}
}

function sameAnnotation(a: Annotation, b: Annotation): boolean {
  return a.type === b.type && a.link === b.link && a.starts[0] === b.starts[0] && a.ends[0] === b.ends[0]
}

/**
 * Re-bases one annotation after the label range [start, end) collapsed to a single placeholder at
 * `start`. Ranges inside the label (its bold, say) are dropped; ranges spanning it shrink; ranges
 * touching it keep the placeholder on their side; ranges after it shift by `delta`.
 */
function shiftAnnotation(annotation: Annotation, start: number, end: number, delta: number): Annotation | null {
  const starts: number[] = []
  const ends: number[] = []
  for (let i = 0; i < annotation.starts.length; i++) {
    let s = annotation.starts[i]!
    let e = annotation.ends[i] ?? s
    if (e <= start) {
      // entirely before the label: unchanged
    } else if (s >= end) {
      s += delta
      e += delta
    } else if (s >= start && e <= end) {
      continue // inside the label
    } else if (s < start && e >= end) {
      e += delta // spans the whole label
    } else if (s < start) {
      e = start + 1 // ends inside the label: keep through the placeholder
    } else {
      s = start + 1 // starts inside the label, ends after it
      e += delta
    }
    if (e > s) {
      starts.push(s)
      ends.push(e)
    }
  }
  if (starts.length === 0) return null
  return {...annotation, starts, ends}
}

/**
 * Plain `@Name` tokens: an `@` that starts a word (not an email's `user@host`, not `hm://` or a
 * path), followed by a handle-like name, outside `Code` annotations.
 */
export function findPlainMentions(text: string, annotations: Annotation[]): string[] {
  const found: string[] = []
  const pattern = /(?<![\p{L}\p{N}_@./:\\])@([\p{L}\p{N}_][\p{L}\p{N}_-]*(?:\.[\p{L}\p{N}_-]+)*)/gu
  const codeRanges = annotations
    .filter((annotation) => annotation.type === 'Code')
    .flatMap((annotation) => annotation.starts.map((s, i) => [s, annotation.ends[i] ?? s] as const))
  for (const match of text.matchAll(pattern)) {
    const utf16Index = match.index ?? 0
    const codePointIndex = Array.from(text.slice(0, utf16Index)).length
    if (codeRanges.some(([s, e]) => codePointIndex >= s && codePointIndex < e)) continue
    found.push(match[1]!)
  }
  return found
}
