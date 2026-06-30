/**
 * MCP tool registry. Each tool wraps either:
 *   - a read operation on `seed-cli`,
 *   - a write operation that goes through governance + rate-limit checks,
 *   - or a state-mutation helper used by the LLM's polling loop.
 *
 * Tool inputs are validated with zod; outputs are returned as JSON
 * payloads conforming to the MCP `CallToolResult` shape.
 */

import {z} from 'zod'
import type {Server} from '@modelcontextprotocol/sdk/server/index.js'
import {CallToolRequestSchema, ListToolsRequestSchema} from '@modelcontextprotocol/sdk/types.js'
import type {AgentConfig} from './config.js'
import type {AuditRun} from './audit.js'
import type {SeedCli} from './seedcli.js'
import type {GovernanceCache} from './governance.js'
import type {State} from './state.js'
import type {Mention} from './mentions.js'
import {
  classifyEvent,
  mentionsAccount,
  buildReplyTarget,
  commentEventCandidate,
  findKmMentionInComment,
  buildCommentMention,
} from './mentions.js'
import type {SeedComment} from './mentions.js'
import {bump, checkCap, isWriteAllowed} from './limits.js'

type ToolDef = {
  name: string
  description: string
  inputSchema: object
  call: (input: unknown) => Promise<unknown>
}

export type ToolDeps = {
  config: AgentConfig
  cli: SeedCli
  governance: GovernanceCache
  state: State
  audit: AuditRun
  /** Resolved at boot from `seed-cli key list`. */
  kmAccountId: string
}

export function buildTools(deps: ToolDeps): ToolDef[] {
  const {config, cli, governance, state, audit, kmAccountId} = deps

  const tools: ToolDef[] = []

  tools.push({
    name: 'seed_get_governance',
    description: 'Fetch and return the agent\'s governance documents (charter, rules, runbook, allowlist) parsed from the target Seed site. Cached for 60s.',
    inputSchema: z.object({force: z.boolean().optional()}).describe('force=true bypasses cache.'),
    async call(input) {
      const args = z.object({force: z.boolean().optional()}).parse(input ?? {})
      const g = await governance.getGovernance(args.force ?? false)
      audit.trace({ts: nowIso(), level: 'info', event: 'governance_loaded', data: {fetchedAt: g.fetchedAt}})
      return {
        rules: g.rules,
        allowlist: g.allowlist,
        charter: g.charter,
        runbook: g.runbook,
        fetchedAt: g.fetchedAt,
      }
    },
  })

  tools.push({
    name: 'seed_search',
    description: 'Search documents in the target site. Wraps `seed-cli search`.',
    inputSchema: z.object({query: z.string(), limit: z.number().int().min(1).max(50).optional()}),
    async call(input) {
      const args = z.object({query: z.string(), limit: z.number().int().optional()}).parse(input)
      const argv = ['search', args.query, '-a', stripHm(config.seedSite)]
      if (args.limit) argv.push('--limit', String(args.limit))
      const r = await cli.runRead(argv)
      return r.parsedJson ?? {raw: r.stdout}
    },
  })

  tools.push({
    name: 'seed_query_space',
    description: 'List documents under the target site (or a path prefix). Wraps `seed-cli query`.',
    inputSchema: z.object({
      path: z.string().optional(),
      mode: z.enum(['Children', 'AllDescendants']).optional(),
      limit: z.number().int().min(1).max(200).optional(),
      sort: z.enum(['Path', 'Title', 'CreateTime', 'UpdateTime', 'DisplayTime']).optional(),
      reverse: z.boolean().optional(),
    }),
    async call(input) {
      const a = z
        .object({
          path: z.string().optional(),
          mode: z.string().optional(),
          limit: z.number().int().optional(),
          sort: z.string().optional(),
          reverse: z.boolean().optional(),
        })
        .parse(input ?? {})
      const argv = ['query', config.seedSite]
      if (a.path) argv.push('--path', a.path)
      if (a.mode) argv.push('--mode', a.mode)
      if (a.limit) argv.push('--limit', String(a.limit))
      if (a.sort) argv.push('--sort', a.sort)
      if (a.reverse) argv.push('--reverse')
      const r = await cli.runRead(argv)
      return r.parsedJson ?? {raw: r.stdout}
    },
  })

  tools.push({
    name: 'seed_get_document',
    description: 'Fetch a document as Markdown with frontmatter. Wraps `seed-cli document get`.',
    inputSchema: z.object({id: z.string()}),
    async call(input) {
      const a = z.object({id: z.string()}).parse(input)
      const r = await cli.runRead(['document', 'get', a.id])
      return {markdown: r.stdout, exitCode: r.exitCode}
    },
  })

  tools.push({
    name: 'seed_list_comments',
    description: 'List comments on a document. Wraps `seed-cli comment list`.',
    inputSchema: z.object({targetId: z.string()}),
    async call(input) {
      const a = z.object({targetId: z.string()}).parse(input)
      const r = await cli.runRead(['comment', 'list', a.targetId])
      return r.parsedJson ?? {raw: r.stdout}
    },
  })

  tools.push({
    name: 'seed_get_comment_thread',
    description:
      'Walk the replyParent chain from a comment up to the thread root. Returns the thread oldest→newest with each comment’s author and body. Caps at 30 comments.',
    inputSchema: z.object({commentId: z.string(), max: z.number().int().min(1).max(100).optional()}),
    async call(input) {
      const a = z.object({commentId: z.string(), max: z.number().int().optional()}).parse(input)
      const max = a.max ?? 30
      const collected: Array<Record<string, unknown>> = []
      let current = a.commentId
      for (let i = 0; i < max; i++) {
        const r = await cli.runRead(['comment', 'get', current])
        if (r.exitCode !== 0 || !r.parsedJson) break
        const c = r.parsedJson as {replyParent?: string} & Record<string, unknown>
        collected.unshift(c)
        if (!c.replyParent) break
        current = c.replyParent
      }
      return {thread: collected}
    },
  })

  tools.push({
    name: 'seed_site_sync_status',
    description:
      'Report local-daemon subscription state and writer-capability availability for a site. Wraps `seed-cli site sync-status`.',
    inputSchema: z.object({siteId: z.string(), writer: z.string().optional()}),
    async call(input) {
      const a = z.object({siteId: z.string(), writer: z.string().optional()}).parse(input)
      const argv = ['site', 'sync-status', a.siteId]
      if (a.writer) argv.push('--writer', a.writer)
      const r = await cli.runRead(argv)
      return r.parsedJson ?? {raw: r.stdout, exitCode: r.exitCode}
    },
  })

  tools.push({
    name: 'seed_get_activity',
    description: 'Fetch activity events for the target site. Optional cursor token for pagination. Wraps `seed-cli activity`.',
    inputSchema: z.object({
      token: z.string().optional(),
      limit: z.number().int().min(1).max(500).optional(),
      resource: z.string().optional(),
    }),
    async call(input) {
      const a = z.object({token: z.string().optional(), limit: z.number().int().optional(), resource: z.string().optional()}).parse(input ?? {})
      const argv = ['activity']
      if (a.token) argv.push('--token', a.token)
      if (a.limit) argv.push('--limit', String(a.limit))
      argv.push('--resource', a.resource ?? config.seedSite)
      const r = await cli.runRead(argv)
      return r.parsedJson ?? {raw: r.stdout}
    },
  })

  tools.push({
    name: 'seed_get_citations',
    description: 'List documents/comments that cite a given Hypermedia ID. Wraps `seed-cli citations`.',
    inputSchema: z.object({id: z.string()}),
    async call(input) {
      const a = z.object({id: z.string()}).parse(input)
      const r = await cli.runRead(['citations', a.id])
      return r.parsedJson ?? {raw: r.stdout}
    },
  })

  tools.push({
    name: 'seed_list_capabilities',
    description: 'List capabilities granted on a Seed account/site. Used to derive the WRITER set. Wraps `seed-cli account capabilities`.',
    inputSchema: z.object({accountId: z.string().optional()}),
    async call(input) {
      const a = z.object({accountId: z.string().optional()}).parse(input ?? {})
      const target = a.accountId ?? config.seedSite
      const r = await cli.runRead(['account', 'capabilities', target])
      return r.parsedJson ?? {raw: r.stdout}
    },
  })

  // ─── writes ──────────────────────────────────────────────────────────────

  tools.push({
    name: 'seed_create_document',
    description: 'Create a document at a path on the target site. Enforces governance.allowWritePaths, denyWritePaths, draft_only kill-switch, max_documents_per_run cap.',
    inputSchema: z.object({
      path: z.string(),
      title: z.string(),
      bodyMarkdown: z.string(),
    }),
    async call(input) {
      const a = z.object({path: z.string(), title: z.string(), bodyMarkdown: z.string()}).parse(input)
      const g = await governance.getGovernance()
      if (g.rules.draftOnly) {
        audit.trace({ts: nowIso(), level: 'warn', event: 'write_blocked_by_rules', data: {path: a.path, reason: 'draft_only'}})
        return {written: false, reason: 'draft_only'}
      }
      const allow = isWriteAllowed(a.path, g.rules)
      if (!allow.allowed) {
        audit.trace({ts: nowIso(), level: 'warn', event: 'write_blocked_by_rules', data: {path: a.path, reason: allow.reason}})
        return {written: false, reason: allow.reason}
      }
      const cap = checkCap(state.getRateState(), 'documents', g.rules)
      if (!cap.allowed) {
        audit.trace({ts: nowIso(), level: 'warn', event: 'write_blocked_by_rules', data: {path: a.path, reason: cap.reason}})
        return {written: false, reason: cap.reason}
      }
      // Write body to temp file because seed-cli expects --file.
      const tmpFile = await writeTempMarkdown(a.bodyMarkdown)
      const argv = [
        'document',
        'create',
        '--account',
        stripHm(config.seedSite),
        '--path',
        a.path,
        '--name',
        a.title,
        '--file',
        tmpFile,
      ]
      const r = await cli.runWrite(argv)
      state.setRateState(bump(state.getRateState(), 'documents'))
      audit.trace({
        ts: nowIso(),
        level: 'info',
        event: 'document_created',
        data: {path: a.path, exit: r.exitCode, link: parseLinkFromStdout(r.stdout)},
      })
      return {written: r.exitCode === 0, exitCode: r.exitCode, stdout: r.stdout}
    },
  })

  tools.push({
    name: 'seed_update_document',
    description: 'Update an existing document. Same governance + rate checks as create.',
    inputSchema: z.object({id: z.string(), bodyMarkdown: z.string(), title: z.string().optional(), summary: z.string().optional()}),
    async call(input) {
      const a = z.object({id: z.string(), bodyMarkdown: z.string(), title: z.string().optional(), summary: z.string().optional()}).parse(input)
      const g = await governance.getGovernance()
      const path = pathFromHmId(a.id)
      if (g.rules.draftOnly) return {written: false, reason: 'draft_only'}
      const allow = isWriteAllowed(path, g.rules)
      if (!allow.allowed) return {written: false, reason: allow.reason}
      const cap = checkCap(state.getRateState(), 'documents', g.rules)
      if (!cap.allowed) return {written: false, reason: cap.reason}
      const tmpFile = await writeTempMarkdown(a.bodyMarkdown)
      const argv = ['document', 'update', a.id, '-f', tmpFile]
      if (a.title) argv.push('--title', a.title)
      if (a.summary) argv.push('--summary', a.summary)
      const r = await cli.runWrite(argv)
      state.setRateState(bump(state.getRateState(), 'documents'))
      return {written: r.exitCode === 0, exitCode: r.exitCode, stdout: r.stdout}
    },
  })

  tools.push({
    name: 'seed_create_comment',
    description: 'Create a comment on a document or block. Enforces draft_only and per-run/per-day caps.',
    inputSchema: z.object({
      targetId: z.string().describe('hm://… optionally with #blockId'),
      body: z.string(),
    }),
    async call(input) {
      const a = z.object({targetId: z.string(), body: z.string()}).parse(input)
      const g = await governance.getGovernance()
      const cap = checkCap(state.getRateState(), 'comments', g.rules)
      if (!cap.allowed) {
        audit.trace({ts: nowIso(), level: 'warn', event: 'write_blocked_by_rules', data: {target: a.targetId, reason: cap.reason}})
        return {posted: false, reason: cap.reason}
      }
      // draft_only does NOT block comments (comments are how the agent
      // communicates regardless). It only blocks document writes.
      const argv = ['comment', 'create', a.targetId, '--body', a.body]
      const r = await cli.runWrite(argv)
      state.setRateState(bump(state.getRateState(), 'comments'))
      audit.trace({ts: nowIso(), level: 'info', event: 'comment_posted', data: {target: a.targetId, exit: r.exitCode}})
      return {posted: r.exitCode === 0, exitCode: r.exitCode, stdout: r.stdout}
    },
  })

  tools.push({
    name: 'seed_reply_comment',
    description: 'Reply to an existing comment (creates a thread). Same caps as seed_create_comment.',
    inputSchema: z.object({targetId: z.string(), parentCommentId: z.string(), body: z.string()}),
    async call(input) {
      const a = z.object({targetId: z.string(), parentCommentId: z.string(), body: z.string()}).parse(input)
      const g = await governance.getGovernance()
      const cap = checkCap(state.getRateState(), 'comments', g.rules)
      if (!cap.allowed) return {posted: false, reason: cap.reason}
      const argv = ['comment', 'create', a.targetId, '--reply', a.parentCommentId, '--body', a.body]
      const r = await cli.runWrite(argv)
      state.setRateState(bump(state.getRateState(), 'comments'))
      return {posted: r.exitCode === 0, exitCode: r.exitCode, stdout: r.stdout}
    },
  })

  // ─── state helpers ───────────────────────────────────────────────────────

  tools.push({
    name: 'cursor_get',
    description: 'Read the activity-cursor token used by the polling loop.',
    inputSchema: z.object({}).strict(),
    async call() {
      return {token: state.getCursor()}
    },
  })

  tools.push({
    name: 'cursor_set',
    description: 'Write the activity-cursor token for the polling loop.',
    inputSchema: z.object({token: z.string()}),
    async call(input) {
      const a = z.object({token: z.string()}).parse(input)
      state.setCursor(a.token)
      return {ok: true}
    },
  })

  tools.push({
    name: 'inbox_pop',
    description: 'Pop the oldest pending mention from the inbox queue.',
    inputSchema: z.object({}).strict(),
    async call() {
      return {mention: state.popFromInbox()}
    },
  })

  tools.push({
    name: 'inbox_size',
    description: 'Number of mentions waiting in the inbox queue.',
    inputSchema: z.object({}).strict(),
    async call() {
      return {size: state.inboxSize()}
    },
  })

  tools.push({
    name: 'inbox_mark_done',
    description: 'Record a mention as processed (idempotency). Status: replied | not-allowed | error.',
    inputSchema: z.object({
      mention: z.unknown(),
      runId: z.string(),
      status: z.enum(['replied', 'not-allowed', 'error']),
    }),
    async call(input) {
      const a = z.object({mention: z.unknown(), runId: z.string(), status: z.enum(['replied', 'not-allowed', 'error'])}).parse(input)
      state.markProcessed(a.mention as Mention, a.runId, a.status)
      return {ok: true}
    },
  })

  tools.push({
    name: 'inbox_enqueue_from_event',
    description: 'Classify a raw activity event for a mention of the agent and enqueue it if matched. Returns the parsed mention or null.',
    inputSchema: z.object({event: z.unknown()}),
    async call(input) {
      const a = z.object({event: z.unknown()}).parse(input)
      const mention = classifyEvent(a.event as Parameters<typeof classifyEvent>[0], kmAccountId)
      if (mention) state.enqueue(mention)
      return {mention}
    },
  })

  tools.push({
    name: 'mention_target_for_reply',
    description: 'Given a mention, returns the {targetId, replyTo?} payload to pass to seed_create_comment / seed_reply_comment.',
    inputSchema: z.object({mention: z.unknown()}),
    async call(input) {
      const a = z.object({mention: z.unknown()}).parse(input)
      return buildReplyTarget(a.mention as Mention)
    },
  })

  tools.push({
    name: 'check_mention_text',
    description: 'Returns true if the given text contains a mention of the agent\'s accountId.',
    inputSchema: z.object({text: z.string()}),
    async call(input) {
      const a = z.object({text: z.string()}).parse(input)
      return {mentions: mentionsAccount(a.text, kmAccountId)}
    },
  })

  tools.push({
    name: 'poll_collect',
    description:
      "Deterministic poll loop step. Loads governance + writer capabilities, fetches activity since last cursor, filters for mentions of the agent by allowed invokers, enqueues them, advances the cursor, and returns the queue. After this returns, the LLM should iterate over `pending` and call seed_reply_comment / seed_create_comment + inbox_mark_done for each.",
    inputSchema: z.object({}).strict(),
    async call() {
      const g = await governance.getGovernance()
      // Resolve allowed invoker set.
      let allowedInvokers: Set<string>
      if (g.rules.mentions.invokerSource === 'allowlist-doc') {
        allowedInvokers = new Set(g.allowlist.invokers)
      } else {
        const capsResult = await cli.runRead(['account', 'capabilities', config.seedSite])
        const writers = new Set<string>()
        try {
          const parsed = capsResult.parsedJson as {capabilities?: Array<{delegate?: string; role?: string}>}
          for (const c of parsed.capabilities ?? []) {
            if (c.role === 'WRITER' && c.delegate) writers.add(c.delegate)
          }
        } catch {
          /* ignore */
        }
        // The site account itself counts as a writer.
        writers.add(stripHm(config.seedSite))
        allowedInvokers = writers
      }
      audit.trace({
        ts: nowIso(),
        level: 'info',
        event: 'poll_collect_writers',
        data: {count: allowedInvokers.size},
      })
      // Activity feed is reverse-chronological. We fetch the first page
      // and stop walking as soon as we hit the lastEventId we processed
      // last poll. Comment bodies are not in the feed, so for each
      // candidate comment event we fetch the full comment via
      // `comment get` and inspect its annotations for an Embed link to
      // the agent's accountId.
      const lastSeenId = state.getCursor()
      // First-time runs (no cursor) shouldn't backfill the entire history
      // through `comment get` calls — cap the work we do per poll.
      const MAX_COMMENT_FETCHES = 25
      // Note: the activity feed's `--resource` filter is exact-match on the
      // doc path, so filtering by the site root would exclude comments
      // posted on subdocuments (`/discussions/...`, `/agents/...`). We pull
      // the unfiltered feed and post-filter by `comment.targetAccount`.
      const r = await cli.runRead(['activity', '--limit', '50'])
      const siteAccount = stripHm(config.seedSite)
      let events: Array<{id?: string; type?: string; time?: string; author?: string | {id?: {uid?: string}}}> = []
      try {
        const parsed = r.parsedJson as {events?: typeof events}
        events = parsed.events ?? []
      } catch {
        /* ignore */
      }
      let newestEventId: string | undefined
      const blocked = new Set(g.rules.moderation.blockedAuthors)
      let enqueued = 0
      let skippedNotAllowed = 0
      let scannedComments = 0
      let exhaustedBudget = false
      for (const ev of events) {
        if (!newestEventId && ev.id) newestEventId = ev.id
        if (lastSeenId && ev.id === lastSeenId) break
        if (scannedComments >= MAX_COMMENT_FETCHES) {
          exhaustedBudget = true
          break
        }
        const candidate = commentEventCandidate(ev)
        if (!candidate) continue
        scannedComments++
        // Fetch the full comment to inspect annotations.
        const cr = await cli.runRead(['comment', 'get', candidate.commentId])
        if (cr.exitCode !== 0 || !cr.parsedJson) continue
        const comment = cr.parsedJson as SeedComment
        // Skip comments not targeting our site.
        if (comment.targetAccount !== siteAccount) continue
        // Don't reply to ourselves.
        if (comment.author === kmAccountId) continue
        const evidence = findKmMentionInComment(comment, [kmAccountId, siteAccount])
        if (!evidence) continue
        const mention = buildCommentMention(comment, evidence, candidate.ts)
        if (blocked.has(mention.author)) continue
        if (!allowedInvokers.has(mention.author)) {
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
        state.enqueue(mention)
        audit.trace({
          ts: nowIso(),
          level: 'info',
          event: 'mention_enqueued',
          data: {
            author: mention.author,
            kind: mention.kind,
            docId: mention.docId,
            commentId: mention.commentId,
            blockId: mention.blockId,
          },
        })
        enqueued++
      }
      if (newestEventId) state.setCursor(newestEventId)
      // Drain inbox up to the per-run comment cap into the response.
      const cap = g.rules.caps.maxCommentsPerRun
      const pending: unknown[] = []
      for (let i = 0; i < cap; i++) {
        const m = state.popFromInbox()
        if (!m) break
        const target = buildReplyTarget(m)
        pending.push({mention: m, target})
      }
      audit.trace({
        ts: nowIso(),
        level: 'info',
        event: 'poll_collect_done',
        data: {
          events: events.length,
          scannedComments,
          enqueued,
          skippedNotAllowed,
          pendingForReply: pending.length,
          cursorAdvanced: Boolean(newestEventId),
          exhaustedBudget,
        },
      })
      return {
        eventsScanned: events.length,
        scannedComments,
        enqueued,
        skippedNotAllowed,
        pending,
        cursorAdvanced: Boolean(newestEventId),
        newestEventId: newestEventId ?? null,
        exhaustedBudget,
        runId: audit.meta.runId,
      }
    },
  })

  return tools
}

export function registerToolHandlers(server: Server, tools: ToolDef[]): void {
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: jsonSchema(t.inputSchema),
    })),
  }))

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const tool = tools.find((t) => t.name === req.params.name)
    if (!tool) {
      return {content: [{type: 'text' as const, text: `unknown tool: ${req.params.name}`}], isError: true}
    }
    const start = Date.now()
    const tsStart = nowIso()
    try {
      const result = await tool.call(req.params.arguments)
      return {content: [{type: 'text' as const, text: JSON.stringify(result)}], _meta: {tsStart, latencyMs: Date.now() - start}}
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return {
        content: [{type: 'text' as const, text: JSON.stringify({error: msg})}],
        isError: true,
        _meta: {tsStart, latencyMs: Date.now() - start},
      }
    }
  })
}

// ─── helpers ──────────────────────────────────────────────────────────────

function nowIso(): string {
  return new Date().toISOString()
}

function stripHm(id: string): string {
  return id.replace(/^hm:\/\//, '').split('/')[0]!
}

function pathFromHmId(id: string): string {
  const stripped = id.replace(/^hm:\/\//, '')
  const idx = stripped.indexOf('/')
  return idx === -1 ? '/' : stripped.slice(idx)
}

function parseLinkFromStdout(s: string): string | undefined {
  const m = s.match(/https?:\/\/\S+/)
  return m?.[0]
}

async function writeTempMarkdown(body: string): Promise<string> {
  const {writeFileSync} = await import('node:fs')
  const {tmpdir} = await import('node:os')
  const {join} = await import('node:path')
  const path = join(tmpdir(), `km-doc-${Date.now()}-${Math.random().toString(36).slice(2)}.md`)
  writeFileSync(path, body, {mode: 0o600})
  return path
}

// MCP tools want a JSON Schema, not a zod schema. We accept either: if the
// caller passes a zod schema we call its `_def` extractor; otherwise pass
// through. (Production MCP servers use zod-to-json-schema; we keep it
// minimal here.)
function jsonSchema(s: object): object {
  if (typeof (s as {_def?: unknown})._def !== 'undefined') {
    // This is a zod schema. Provide a minimal, permissive schema; the LLM
    // will see the description text. For production, swap in
    // zod-to-json-schema.
    return {type: 'object', additionalProperties: true}
  }
  return s
}
