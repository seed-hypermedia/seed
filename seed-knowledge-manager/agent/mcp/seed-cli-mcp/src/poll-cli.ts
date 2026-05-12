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
  buildThreadReplyMention,
  commentEventCandidate,
  detectThreadReplyToKm,
  findKmMentionInComment,
  buildReplyTarget,
} from './mentions.js'
import type {Mention, SeedComment} from './mentions.js'
import {bump, checkCap} from './limits.js'
import {draftReply, gatherCommentReplyContext} from './reply-engine.js'

const ACTIVITY_LIMIT = 100
const MAX_COMMENT_FETCHES = 200
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

    if (config.useLocalDaemon) {
      const writerArg = config.writerAid ? ['--writer', config.writerAid] : []
      const syncStatus = await cli.runRead(['site', 'sync-status', config.seedSite, ...writerArg])
      const parsed = syncStatus.parsedJson as {ready_for_writes?: boolean} | undefined
      const ready = !!parsed?.ready_for_writes
      audit.trace({ts: nowIso(), level: 'info', event: 'preflight_sync_status', data: {ready, output: parsed}})
      if (!ready) {
        audit.trace({ts: nowIso(), level: 'warn', event: 'preflight_skipped', data: {reason: 'local-daemon-not-ready'}})
        audit.close({status: 'denied', logsDir: config.logsDir})
        return
      }
    }

    const keyShow = await cli.runRead(['key', 'show', config.keyName])
    if (keyShow.exitCode !== 0) throw new Error(`key show failed: ${keyShow.stderr}`)
    const kmAccountId = (keyShow.parsedJson as {accountId?: string} | undefined)?.accountId
    if (!kmAccountId) throw new Error('Could not resolve agent accountId')
    audit.meta.kmAccountId = kmAccountId

    const g = await governance.getGovernance(true)
    audit.trace({ts: nowIso(), level: 'info', event: 'governance_loaded', data: {fetchedAt: g.fetchedAt}})

    // TEMP: gate disabled by default — agent answers any commenter that mentions it.
    // Set KM_ENFORCE_INVOKER_GATE=1 (or "true") to re-enable WRITER/allowlist enforcement.
    const ENFORCE_INVOKER_GATE = /^(1|true|yes)$/i.test(process.env.KM_ENFORCE_INVOKER_GATE ?? '')

    // Resolve allowed-invokers (only when gate enforced).
    const writers = new Set<string>()
    if (ENFORCE_INVOKER_GATE) {
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
    } else {
      audit.trace({
        ts: nowIso(),
        level: 'warn',
        event: 'invoker_gate_disabled',
        data: {note: 'replying to all authors; cap + blocked-list still active'},
      })
    }

    // ── PASS A: discover new mentions and post placeholders. ───────────────
    //
    // Hyper.media's activity feed is eventually-consistent: new comment
    // events frequently take minutes to surface, by which point a
    // cursor-based walker has already advanced past the slot they would
    // have occupied. We dropped the cursor and rely instead on
    // `processed.jsonl` + `placeholders.jsonl` for idempotency. Each
    // poll scans the last ACTIVITY_LIMIT events and fetches comment
    // bodies up to MAX_COMMENT_FETCHES.
    const actR = await cli.runRead(['activity', '--limit', String(ACTIVITY_LIMIT)])
    const events = ((actR.parsedJson as {events?: Array<{id?: string; type?: string; time?: string; author?: unknown}>})
      ?.events) ?? []
    let scanned = 0
    let placeholdersPosted = 0
    let skippedNotAllowed = 0
    let exhaustedBudget = false
    // Thread-reply mentions deferred to a direct-reply pass (no placeholder).
    // Workaround for seed-cli bug: `--reply` uses `parentComment.threadRoot`
    // (RecordID) instead of `parentComment.threadRootVersion` (CID), so
    // `CID.parse()` fails with "Non-base58btc character" for any parent that
    // is itself a threaded reply. The placeholder→edit flow makes this worse
    // because the edited placeholder becomes an ancestor with a threadRoot,
    // breaking all subsequent `--reply` calls in the chain. Skipping the
    // placeholder avoids introducing an edited comment into the chain.
    // Upstream fix tracked in .ai/seed-cli-reply-chain-fix.md — once seed-cli
    // is patched, thread-replies can use the placeholder→edit flow.
    const deferredThreadReplies: Array<{mention: Mention; mid: string}> = []
    const blocked = new Set(g.rules.moderation.blockedAuthors)
    const siteAccount = config.seedSite.replace(/^hm:\/\//, '').split('/')[0]!

    // Cache: commentAuthor → principal account that holds the writer cap.
    // Seed accounts can `alias_account` to another account they act on behalf
    // of (e.g. a device-key signs with its own id but is aliased to the
    // user's main account). The writer-cap list keys on principals, so we
    // resolve every comment author through this lookup before checking
    // membership.
    //
    // Local daemon returns `account-not-found` when the author's account blob
    // hasn't synced yet (common for accounts that have not posted to this
    // site before). Fall back to the public gateway for the resolution only
    // — we still read everything else from the local daemon. The gateway
    // collapses alias chains in its response: querying for an aliased uid
    // returns the principal's id directly.
    const gatewayUrl = process.env.SEED_GATEWAY_URL ?? 'https://hyper.media'
    const principalOf = new Map<string, string>()
    // Per-cycle cache for `comment get` lookups used by the thread-reply
    // trigger. Sibling replies on the same thread re-walk the same
    // ancestor chain, so caching here turns an O(depth × siblings)
    // CLI-call cost into O(depth + siblings).
    const replyChainCache = new Map<string, SeedComment | null>()
    const fetchCommentForChain = async (id: string): Promise<SeedComment | null> => {
      const r = await cli.runRead(['comment', 'get', id])
      if (r.exitCode !== 0 || !r.parsedJson) return null
      return r.parsedJson as SeedComment
    }
    const resolvePrincipal = async (author: string): Promise<string> => {
      const cached = principalOf.get(author)
      if (cached) return cached
      // Local first.
      const local = await cli.runRead(['account', 'get', author])
      const localAcct =
        (local.parsedJson as
          | {type?: string; aliasAccount?: string; alias_account?: string; id?: {uid?: string}}
          | undefined) ?? {}
      let principal: string | undefined
      if (localAcct.type !== 'account-not-found') {
        principal = localAcct.aliasAccount ?? localAcct.alias_account ?? localAcct.id?.uid
      }
      // Fall back to gateway if local has no record.
      if (!principal) {
        const gw = await cli.runRead(['-s', gatewayUrl, 'account', 'get', author])
        const gwAcct =
          (gw.parsedJson as
            | {type?: string; aliasAccount?: string; alias_account?: string; id?: {uid?: string}}
            | undefined) ?? {}
        if (gwAcct.type !== 'account-not-found') {
          principal = gwAcct.aliasAccount ?? gwAcct.alias_account ?? gwAcct.id?.uid
        }
      }
      const resolved = principal ?? author
      principalOf.set(author, resolved)
      return resolved
    }

    for (const ev of events) {
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
      let mention: Mention | null = null
      let threadReplyAncestor: string | undefined
      if (evidence) {
        mention = buildCommentMention(comment, evidence, candidate.ts)
      } else if (comment.replyParent) {
        // Second trigger path: comment is a reply (direct or transitive)
        // inside a thread where KM has already commented. Lets multi-turn
        // dialogue work without forcing the user to re-mention every time.
        const hit = await detectThreadReplyToKm({
          comment,
          kmAccountId,
          fetchComment: fetchCommentForChain,
          cache: replyChainCache,
        })
        if (hit) {
          mention = buildThreadReplyMention(comment, candidate.ts)
          threadReplyAncestor = hit.ancestorCommentId
        }
      }
      if (!mention) continue
      if (blocked.has(mention.author)) continue
      const mid = mentionKey(mention)
      // Idempotency FIRST: a mention that's already been processed (even with
      // status `not-allowed`) must not be re-classified each poll cycle. Doing
      // so wrote thousands of duplicate "not-allowed" lines into
      // processed.jsonl when an unprivileged author kept mentioning the agent.
      if (state.isProcessed(mid) || state.hasPlaceholderFor(mid)) continue

      // Audit event for thread-reply trigger (after idempotency to avoid
      // spamming the log every poll cycle for already-handled comments).
      if (threadReplyAncestor) {
        audit.trace({
          ts: nowIso(),
          level: 'info',
          event: 'mention_via_thread_reply',
          data: {
            commentId: comment.id,
            ancestorCommentId: threadReplyAncestor,
            docId: mention.docId,
            author: mention.author,
          },
        })
      }

      if (ENFORCE_INVOKER_GATE) {
        const principal = await resolvePrincipal(mention.author)
        if (!writers.has(mention.author) && !writers.has(principal)) {
          state.markProcessed(mention, audit.meta.runId, 'not-allowed')
          audit.trace({
            ts: nowIso(),
            level: 'info',
            event: 'mention_skipped_not_allowed',
            data: {author: mention.author, principal, kind: mention.kind, docId: mention.docId},
          })
          skippedNotAllowed++
          continue
        }
      }

      // Per-day cap: counts whether it's a placeholder or direct reply.
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

      // Thread-reply mentions skip the placeholder→edit flow and are
      // deferred to a direct-reply pass (see comment at deferredThreadReplies).
      if (mention.triggerSource === 'thread-reply') {
        deferredThreadReplies.push({mention, mid})
        state.setRateState(bump(rs, 'comments'))
        continue
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

    // ── PASS B: finalise placeholders (DeepSeek + comment edit). ───────────
    const pending = state.pendingPlaceholders()
    let finalised = 0
    let errored = 0
    if (config.useStateMachine) {
      audit.trace({
        ts: nowIso(),
        level: 'info',
        event: 'state_machine_enabled',
        data: {pending: pending.length},
      })
      // Drive each pending placeholder through the XState supervisor. The
      // machine owns retry/backoff for the LLM call + comment edit and
      // persists transitions to ${stateDir}/machines/<mentionId>.jsonl.
      const {runMachinePassB} = await import('./machines/poll-driver.js')
      const result = await runMachinePassB({
        config,
        cli,
        state,
        audit,
        pending,
        siteAccount,
        fallbackBody: FALLBACK_BODY,
      })
      finalised = result.finalised
      errored = result.errored
    } else for (const rec of pending) {
      // Per-run cap on comment edits is intentionally absent; we already
      // counted each placeholder as a comment in Pass A, and `edit` does
      // not produce a new top-level comment.
      const question = rec.mention.text.replace(/￼/g, ' ').trim()
      const context = await gatherCommentReplyContext({
        cli,
        mention: rec.mention,
        siteAccount,
        audit,
      })
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

    // ── PASS C: direct replies for thread-reply mentions (no placeholder). ──
    //
    // Thread-reply mentions skip the placeholder→edit dance to avoid
    // inserting an edited comment into the reply chain. seed-cli's
    // `--reply` breaks when the parent chain contains an edited comment
    // (uses threadRoot RecordID instead of CID). We draft the full reply
    // first, then post it as a single `comment create`.
    //
    // Upstream fix: .ai/seed-cli-reply-chain-fix.md — once seed-cli is
    // patched, this pass can be removed and thread-replies can rejoin the
    // placeholder→edit flow in Pass A/B.
    let directReplied = 0
    for (const {mention} of deferredThreadReplies) {
      const question = mention.text.replace(/￼/g, ' ').trim()
      const context = await gatherCommentReplyContext({cli, mention, siteAccount, audit})
      const reply = await draftReply(question, context, audit)
      const body = reply ?? FALLBACK_BODY
      const target = buildReplyTarget(mention)
      const argv = ['comment', 'create', target.targetId, '--body', body]
      if (target.replyTo) argv.push('--reply', target.replyTo)
      let r = await cli.runWrite(argv)
      // Same seed-cli fallback as postPlaceholder: if --reply fails on
      // a threaded parent, drop to a top-level comment.
      if (r.exitCode !== 0 && target.replyTo && /non-base58btc/i.test(r.stderr)) {
        audit.trace({
          ts: nowIso(),
          level: 'warn',
          event: 'direct_reply_threading_fallback',
          data: {commentId: mention.commentId, replyTo: target.replyTo, stderr: r.stderr.slice(0, 200)},
        })
        r = await cli.runWrite(['comment', 'create', target.targetId, '--body', body])
      }
      if (r.exitCode === 0) {
        state.markProcessed(mention, audit.meta.runId, reply ? 'replied' : 'error')
        audit.trace({
          ts: nowIso(),
          level: 'info',
          event: reply ? 'direct_reply_posted' : 'direct_reply_posted_with_fallback',
          data: {
            commentId: mention.commentId,
            docId: mention.docId,
            replyPreview: body.slice(0, 200),
          },
        })
        directReplied++
      } else {
        state.markProcessed(mention, audit.meta.runId, 'error')
        audit.trace({
          ts: nowIso(),
          level: 'error',
          event: 'direct_reply_failed',
          data: {
            commentId: mention.commentId,
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
        directReplied,
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
