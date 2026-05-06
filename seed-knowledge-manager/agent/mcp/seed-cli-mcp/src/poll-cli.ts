#!/usr/bin/env node
/**
 * Standalone polling driver. No nanobot. Two-pass design for
 * "typing-indicator" UX:
 *
 *   PASS A — placeholders (deterministic, fast):
 *     For each newly-detected pending mention, post a short placeholder
 *     comment ("Working on this — back in a moment.") via seed-cli. The
 *     placeholder commentId is persisted in placeholders.jsonl so a
 *     crash between passes is recoverable.
 *
 *   PASS B — finalisation (LLM, slower):
 *     For each placeholder not yet finalised, draft a reply via DeepSeek
 *     and replace the placeholder body via `seed-cli comment edit`.
 *     Mark the mention `replied`.
 *
 *   On DeepSeek failure during Pass B the placeholder is edited to a
 *   short fallback message so it is never stuck on "Working…".
 *
 * The two-pass split means the user sees the agent reply within seconds
 * (placeholder), even when the eventual answer takes longer to draft.
 */

import {GovernanceCache} from './governance.js'
import {SeedCli} from './seedcli.js'
import {AuditRun} from './audit.js'
import {buildRedactor} from './redact.js'
import {loadConfig} from './config.js'
import {State, mentionKey} from './state.js'
import {
  buildCommentMention,
  commentEventCandidate,
  findKmMentionInComment,
  buildReplyTarget,
} from './mentions.js'
import type {Mention, SeedComment} from './mentions.js'
import {bump, checkCap} from './limits.js'
import {draftReply, gatherSiteContext} from './reply-engine.js'

const MAX_COMMENT_FETCHES = 25
const PLACEHOLDER_BODY = 'Working on this — back in a moment. ⌛'
const FALLBACK_BODY =
  'I tried to draft a reply but hit a snag. Please rephrase or wait for the next cadence.'

async function main(): Promise<void> {
  const config = loadConfig()
  const redactor = buildRedactor()
  const audit = new AuditRun({
    logsDir: config.logsDir,
    trigger: process.env.KM_TRIGGER ?? 'poll-cli',
    redactor,
    seedSite: config.seedSite,
  })
  audit.trace({
    ts: nowIso(),
    level: 'info',
    event: 'agent_start',
    data: {seedServer: config.seedServer, seedSite: config.seedSite, mode: 'poll-cli'},
  })

  let status: 'ok' | 'error' | 'denied' = 'ok'
  try {
    const cli = new SeedCli(config, redactor, audit)
    const state = new State(config.stateDir)
    const governance = new GovernanceCache(config, cli)

    const keyShow = await cli.runRead(['key', 'show', config.keyName])
    if (keyShow.exitCode !== 0) throw new Error(`key show failed: ${keyShow.stderr}`)
    const kmAccountId = (keyShow.parsedJson as {accountId?: string} | undefined)?.accountId
    if (!kmAccountId) throw new Error('Could not resolve agent accountId')
    audit.meta.kmAccountId = kmAccountId

    const g = await governance.getGovernance(true)
    audit.trace({ts: nowIso(), level: 'info', event: 'governance_loaded', data: {fetchedAt: g.fetchedAt}})

    // Resolve allowed-invokers.
    const writers = new Set<string>()
    if (g.rules.mentions.invokerSource === 'allowlist-doc') {
      for (const a of g.allowlist.invokers) writers.add(a)
    } else {
      const caps = await cli.runRead(['account', 'capabilities', config.seedSite])
      const parsed = caps.parsedJson as {capabilities?: Array<{delegate?: string; role?: string}>} | undefined
      for (const c of parsed?.capabilities ?? []) {
        if (c.role === 'WRITER' && c.delegate) writers.add(c.delegate)
      }
      writers.add(config.seedSite.replace(/^hm:\/\//, '').split('/')[0]!)
    }
    audit.trace({ts: nowIso(), level: 'info', event: 'poll_collect_writers', data: {count: writers.size}})

    // ── PASS A: discover new mentions and post placeholders. ───────────────
    const lastSeenId = state.getCursor()
    const actR = await cli.runRead(['activity', '--limit', '50'])
    const events = ((actR.parsedJson as {events?: Array<{id?: string; type?: string; time?: string; author?: unknown}>})
      ?.events) ?? []
    let newestEventId: string | undefined
    let scanned = 0
    let placeholdersPosted = 0
    let skippedNotAllowed = 0
    let exhaustedBudget = false
    const blocked = new Set(g.rules.moderation.blockedAuthors)
    const siteAccount = config.seedSite.replace(/^hm:\/\//, '').split('/')[0]!

    for (const ev of events) {
      if (!newestEventId && ev.id) newestEventId = ev.id
      if (lastSeenId && ev.id === lastSeenId) break
      if (scanned >= MAX_COMMENT_FETCHES) {
        exhaustedBudget = true
        break
      }
      const candidate = commentEventCandidate(ev as Parameters<typeof commentEventCandidate>[0])
      if (!candidate) continue
      scanned++
      const cr = await cli.runRead(['comment', 'get', candidate.commentId])
      if (cr.exitCode !== 0 || !cr.parsedJson) continue
      const comment = cr.parsedJson as SeedComment
      if (comment.targetAccount !== siteAccount) continue
      if (comment.author === kmAccountId) continue
      // Agent triggers on mentions of either itself or the site root —
      // since the agent holds a WRITER capability on the site, mentions
      // of the site (e.g. "@Develop Seed Hypermedia") are also addressed
      // to it.
      const evidence = findKmMentionInComment(comment, [kmAccountId, siteAccount])
      if (!evidence) continue
      const mention = buildCommentMention(comment, evidence, candidate.ts)
      if (blocked.has(mention.author)) continue
      if (!writers.has(mention.author)) {
        state.markProcessed(mention, audit.meta.runId, 'not-allowed')
        audit.trace({
          ts: nowIso(),
          level: 'info',
          event: 'mention_skipped_not_allowed',
          data: {author: mention.author, kind: mention.kind, docId: mention.docId},
        })
        skippedNotAllowed++
        continue
      }
      const mid = mentionKey(mention)
      // Idempotency: don't double-post a placeholder.
      if (state.isProcessed(mid) || state.hasPlaceholderFor(mid)) continue

      // Per-day cap: a placeholder counts as a comment.
      const rs = state.getRateState()
      const capCheck = checkCap(rs, 'comments', g.rules)
      if (!capCheck.allowed) {
        audit.trace({
          ts: nowIso(),
          level: 'warn',
          event: 'placeholder_skipped_cap',
          data: {commentId: mention.commentId, reason: capCheck.reason},
        })
        break
      }
      const placeholderId = await postPlaceholder(cli, mention, audit)
      if (!placeholderId) continue
      state.recordPlaceholder({
        mentionId: mid,
        placeholderId,
        postedAt: nowIso(),
        mention,
        finalised: false,
      })
      state.setRateState(bump(rs, 'comments'))
      audit.trace({
        ts: nowIso(),
        level: 'info',
        event: 'placeholder_posted',
        data: {
          commentId: mention.commentId,
          placeholderId,
          docId: mention.docId,
          textPreview: mention.text.replace(/￼/g, ' ').slice(0, 200),
        },
      })
      placeholdersPosted++
    }
    if (newestEventId) state.setCursor(newestEventId)

    // ── PASS B: finalise placeholders (DeepSeek + comment edit). ───────────
    const pending = state.pendingPlaceholders()
    let finalised = 0
    let errored = 0
    for (const rec of pending) {
      // Per-run cap on comment edits is intentionally absent; we already
      // counted each placeholder as a comment in Pass A, and `edit` does
      // not produce a new top-level comment.
      const question = rec.mention.text.replace(/￼/g, ' ').trim()
      const context = await gatherSiteContext(cli, question, siteAccount, audit)
      const reply = await draftReply(question, context, audit)
      const body = reply ?? FALLBACK_BODY
      const r = await cli.runWrite(['comment', 'edit', rec.placeholderId, '--body', body])
      if (r.exitCode === 0) {
        state.finalisePlaceholder(rec.mentionId, rec.placeholderId)
        state.markProcessed(rec.mention, audit.meta.runId, reply ? 'replied' : 'error')
        audit.trace({
          ts: nowIso(),
          level: 'info',
          event: reply ? 'reply_finalised' : 'reply_finalised_with_fallback',
          data: {
            commentId: rec.mention.commentId,
            placeholderId: rec.placeholderId,
            replyPreview: body.slice(0, 200),
          },
        })
        finalised++
      } else {
        audit.trace({
          ts: nowIso(),
          level: 'error',
          event: 'reply_edit_failed',
          data: {
            commentId: rec.mention.commentId,
            placeholderId: rec.placeholderId,
            exitCode: r.exitCode,
            stderr: r.stderr.slice(0, 200),
          },
        })
        errored++
      }
    }

    audit.trace({
      ts: nowIso(),
      level: 'info',
      event: 'poll_done',
      data: {
        events: events.length,
        scanned,
        placeholdersPosted,
        skippedNotAllowed,
        finalised,
        errored,
        exhaustedBudget,
      },
    })
  } catch (err) {
    status = 'error'
    audit.trace({
      ts: nowIso(),
      level: 'error',
      event: 'poll_fatal',
      data: {message: err instanceof Error ? err.message : String(err)},
    })
  } finally {
    audit.trace({ts: nowIso(), level: 'info', event: 'agent_end', data: {status}})
    audit.close({status, logsDir: config.logsDir})
  }
}

function nowIso(): string {
  return new Date().toISOString()
}

/**
 * Posts a placeholder comment for a mention. Returns the canonical
 * comment record id (`<author>/<tsid>`) on success, or null on failure.
 *
 * seed-cli's `comment create` emits "✓ Comment published: <CID>" to
 * STDERR (not stdout) and the value is the version CID, not the record
 * id. We parse the CID, then call `comment get <CID>` to read back the
 * full comment record and return its `id` field.
 */
async function postPlaceholder(cli: SeedCli, mention: Mention, audit: AuditRun): Promise<string | null> {
  const target = buildReplyTarget(mention)
  const baseArgv = ['comment', 'create', target.targetId, '--body', PLACEHOLDER_BODY]
  // Try threaded reply first.
  let r = await cli.runWrite(target.replyTo ? [...baseArgv, '--reply', target.replyTo] : baseArgv)
  // Known seed-cli quirk: `--reply` fails with "Non-base58btc character"
  // when the parent comment chain includes an edited comment. Fall back
  // to a top-level reply on the same doc — not threaded but functional.
  if (r.exitCode !== 0 && target.replyTo && /non-base58btc/i.test(r.stderr)) {
    audit.trace({
      ts: nowIso(),
      level: 'warn',
      event: 'placeholder_reply_fallback',
      data: {commentId: mention.commentId, parentReplyTo: target.replyTo, stderr: r.stderr.slice(0, 200)},
    })
    r = await cli.runWrite(baseArgv)
  }
  if (r.exitCode !== 0) {
    audit.trace({
      ts: nowIso(),
      level: 'error',
      event: 'placeholder_post_failed',
      data: {commentId: mention.commentId, exitCode: r.exitCode, stderr: r.stderr.slice(0, 200)},
    })
    return null
  }
  const cid = extractCidFromOutput(r.stdout, r.stderr)
  if (!cid) {
    audit.trace({
      ts: nowIso(),
      level: 'error',
      event: 'placeholder_cid_parse_failed',
      data: {commentId: mention.commentId, stdoutPreview: r.stdout.slice(0, 200), stderrPreview: r.stderr.slice(0, 200)},
    })
    return null
  }
  // Resolve CID → canonical comment record id.
  const get = await cli.runRead(['comment', 'get', cid])
  if (get.exitCode !== 0) {
    audit.trace({
      ts: nowIso(),
      level: 'error',
      event: 'placeholder_resolve_failed',
      data: {commentId: mention.commentId, cid, exitCode: get.exitCode, stderr: get.stderr.slice(0, 200)},
    })
    return null
  }
  const parsed = get.parsedJson as {id?: string} | undefined
  return parsed?.id ?? null
}

function extractCidFromOutput(stdout: string, stderr: string): string | null {
  const combined = `${stdout}\n${stderr}`
  const m = combined.match(/comment\s+published:\s*(bafy[\w]+)/i)
  return m?.[1] ?? null
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('km-poll fatal:', err)
  process.exit(1)
})
