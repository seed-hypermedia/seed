#!/usr/bin/env node
/**
 * Standalone driver for the LAFH cadenced outputs:
 *   - boletin:    weekly bulletin
 *   - gap:        gap-detection report
 *   - health:     network-health report
 *
 * Pattern: load governance → collect a period snapshot from activity →
 * one DeepSeek call to draft the doc body → publish via seed-cli at a
 * deterministic path under `/agents/knowledge-manager/state/...`.
 *
 * No nanobot. No tool orchestration. systemd timers invoke this with
 * `KM_TASK=<task>`.
 *
 * Templates referenced inline are the human-canonical structure (see
 * seed-knowledge-manager/templates/) — we feed a compact version into
 * the system prompt so DeepSeek produces consistent output.
 */

import {GovernanceCache} from './governance.js'
import {SeedCli} from './seedcli.js'
import {AuditRun} from './audit.js'
import {buildRedactor} from './redact.js'
import {loadConfig} from './config.js'
import {bump, checkCap, isWriteAllowed} from './limits.js'
import {State} from './state.js'

type Task = 'boletin' | 'gap' | 'health'

type TaskConfig = {
  task: Task
  /** ISO date period stamp used as path slug. */
  periodStamp: string
  /** Human-readable period for prose (e.g. "2026-W19", "April 2026"). */
  periodLabel: string
  /** Window of activity to summarize, in days. */
  windowDays: number
  /** Path under the site root where the doc is created (relative to /). */
  docPath: string
  /** Doc title. */
  title: string
  /** Frontmatter `type` value. */
  type: string
  /** System-prompt skeleton + instructions. */
  systemPrompt: string
}

async function main(): Promise<void> {
  const taskName = (process.env.KM_TASK ?? '').toLowerCase()
  if (!isTask(taskName)) {
    throw new Error(`KM_TASK must be one of: boletin | gap | health (got "${taskName}")`)
  }
  const config = loadConfig()
  const redactor = buildRedactor()
  const audit = new AuditRun({
    logsDir: config.logsDir,
    trigger: `cadence-${taskName}`,
    redactor,
    seedSite: config.seedSite,
  })
  audit.trace({
    ts: nowIso(),
    level: 'info',
    event: 'agent_start',
    data: {seedServer: config.seedServer, seedSite: config.seedSite, mode: 'cadence-cli', task: taskName},
  })

  let status: 'ok' | 'error' | 'denied' = 'ok'
  try {
    const cli = new SeedCli(config, redactor, audit)
    const state = new State(config.stateDir)
    const governance = new GovernanceCache(config, cli)

    // Resolve agent accountId.
    const keyShow = await cli.runRead(['key', 'show', config.keyName])
    if (keyShow.exitCode !== 0) throw new Error(`key show failed: ${keyShow.stderr}`)
    const kmAccountId = (keyShow.parsedJson as {accountId?: string} | undefined)?.accountId
    if (!kmAccountId) throw new Error('Could not resolve agent accountId')
    audit.meta.kmAccountId = kmAccountId

    const g = await governance.getGovernance(true)
    audit.trace({ts: nowIso(), level: 'info', event: 'governance_loaded', data: {fetchedAt: g.fetchedAt}})

    const tc = buildTaskConfig(taskName, g.runbook, g.charter)

    // Path policy: documents are writes; respect rules.
    if (g.rules.draftOnly) {
      audit.trace({ts: nowIso(), level: 'warn', event: 'draft_only_active', data: {task: tc.task, path: tc.docPath}})
      status = 'denied'
      return
    }
    const allow = isWriteAllowed(tc.docPath, g.rules)
    if (!allow.allowed) {
      audit.trace({ts: nowIso(), level: 'warn', event: 'write_blocked_by_rules', data: {path: tc.docPath, reason: allow.reason}})
      status = 'denied'
      return
    }
    const cap = checkCap(state.getRateState(), 'documents', g.rules)
    if (!cap.allowed) {
      audit.trace({ts: nowIso(), level: 'warn', event: 'write_blocked_by_rules', data: {path: tc.docPath, reason: cap.reason}})
      status = 'denied'
      return
    }

    // Collect activity snapshot.
    const cutoffMs = Date.now() - tc.windowDays * 86_400_000
    const snapshot = await collectSnapshot(cli, config.seedSite, cutoffMs)
    audit.trace({
      ts: nowIso(),
      level: 'info',
      event: 'snapshot_collected',
      data: {
        windowDays: tc.windowDays,
        events: snapshot.events.length,
        comments: snapshot.commentsByDoc.size,
        docs: snapshot.docsByPath.size,
        authors: snapshot.activeAuthors.size,
      },
    })

    // Draft the body via DeepSeek.
    const userPrompt = buildUserPrompt(tc, snapshot)
    const draft = await draftDoc(tc.systemPrompt, userPrompt, audit)
    if (!draft) throw new Error('DeepSeek returned no completion')

    // Publish.
    const fullDoc = ensureFrontmatter(draft, {
      title: tc.title,
      type: tc.type,
      period: tc.periodStamp,
      periodLabel: tc.periodLabel,
      created_by: 'knowledge-manager',
      created_at: new Date().toISOString(),
    })
    const tmpFile = await writeTempMarkdown(fullDoc)
    const siteAccount = config.seedSite.replace(/^hm:\/\//, '').split('/')[0]!
    const argv = [
      'document',
      'create',
      '--account',
      siteAccount,
      '--path',
      tc.docPath,
      '--name',
      tc.title,
      '--file',
      tmpFile,
      '--force', // each cadence run replaces the doc at the same path
    ]
    const r = await cli.runWrite(argv)
    if (r.exitCode === 0) {
      state.setRateState(bump(state.getRateState(), 'documents'))
      audit.trace({
        ts: nowIso(),
        level: 'info',
        event: 'cadence_doc_published',
        data: {task: tc.task, path: tc.docPath, link: extractLink(r.stdout)},
      })
    } else {
      status = 'error'
      audit.trace({
        ts: nowIso(),
        level: 'error',
        event: 'cadence_doc_failed',
        data: {task: tc.task, exitCode: r.exitCode, stderr: r.stderr.slice(0, 400)},
      })
    }
  } catch (err) {
    status = 'error'
    audit.trace({
      ts: nowIso(),
      level: 'error',
      event: 'cadence_fatal',
      data: {message: err instanceof Error ? err.message : String(err)},
    })
  } finally {
    audit.trace({ts: nowIso(), level: 'info', event: 'agent_end', data: {status}})
    audit.close({status, logsDir: config.logsDir})
  }
}

function isTask(s: string): s is Task {
  return s === 'boletin' || s === 'gap' || s === 'health'
}

function buildTaskConfig(task: Task, runbook: string, charter: string): TaskConfig {
  const now = new Date()
  const lafhRunbookContext =
    `Charter excerpt:\n${charter.slice(0, 1200)}\n\nRunbook excerpt:\n${runbook.slice(0, 1200)}`
  if (task === 'boletin') {
    const week = isoWeekStamp(now)
    return {
      task,
      periodStamp: week,
      periodLabel: week,
      windowDays: 7,
      docPath: `/agents/knowledge-manager/state/boletin/${week}`,
      title: `Boletín — ${week}`,
      type: 'boletin',
      systemPrompt:
        `You are the Knowledge Manager generating the WEEKLY BULLETIN (boletín periódico) for a Seed Hypermedia community, applying LAFH/GC-Red methodology.\n\n` +
        `Output a complete Markdown document body (no triple-backtick fences around the whole). Use these section headings exactly:\n` +
        `## New documents published\n## Active threads\n## Decisions made\n## New members\n## Gaps surfaced or filled\n## Recommended reading from this period\n## Health note\n\n` +
        `Cite every document/comment with full hm:// URLs. Cap each list at 5–7 items, prioritized (not exhaustive). Be concise — the bulletin is meant to be scannable in two minutes.\n\n` +
        `Where the snapshot lacks data for a section, write one honest sentence ("no formal decisions captured this period" etc) — that is itself a signal. Do NOT invent items.\n\n` +
        `${lafhRunbookContext}`,
    }
  }
  if (task === 'gap') {
    const stamp = isoDateStamp(now)
    return {
      task,
      periodStamp: stamp,
      periodLabel: stamp,
      windowDays: 7,
      docPath: `/agents/knowledge-manager/state/gaps/${stamp}`,
      title: `Gap report — ${stamp}`,
      type: 'gap-report',
      systemPrompt:
        `You are the Knowledge Manager generating a GAP REPORT for a Seed Hypermedia community, applying LAFH/GC-Red methodology.\n\n` +
        `Output a complete Markdown document body. Use these sections:\n` +
        `## How this was produced\n## Open gaps\n### 🔴 High priority\n### 🟡 Medium priority\n### 🟢 Low priority / parking lot\n## Contradictions detected\n## Stale or potentially outdated content\n## Patterns\n\n` +
        `For each gap include: **Evidence:** with hm:// links, **Why it matters:**, **Proposed action:**, **Suggested owner:** (or "open"). ` +
        `Do NOT invent gaps; if the snapshot doesn't surface enough data, write "no high-priority gaps detected this period" and move on. Honest signal beats fluff.\n\n` +
        `${lafhRunbookContext}`,
    }
  }
  // health
  const stamp = isoMonthStamp(now)
  return {
    task,
    periodStamp: stamp,
    periodLabel: stamp,
    windowDays: 30,
    docPath: `/agents/knowledge-manager/state/network-health/${stamp}`,
    title: `Network health — ${stamp}`,
    type: 'network-health',
    systemPrompt:
      `You are the Knowledge Manager generating a NETWORK HEALTH REPORT for a Seed Hypermedia community, applying LAFH/GC-Red methodology.\n\n` +
      `Output a complete Markdown document body. Sections in this order:\n` +
      `## TL;DR\n## Activity metrics\n## Production of knowledge products\n## Silos\n## Stale corpus\n## Pace assessment\n## Memory check\n## Methodology adherence\n## Recommended actions\n\n` +
      `Be diagnostic, not flattering. If activity exists but produces no synthesis/decisions/methods, label it a red flag (LAFH: activity without production is noise). ` +
      `Quantify what you can ("N new docs", "M comments", "K active authors of N total writers"). Cite hm:// links for any document referenced.\n\n` +
      `${lafhRunbookContext}`,
  }
}

// ─── Snapshot collection ─────────────────────────────────────────────────

type Snapshot = {
  events: ActivityEvent[]
  /** docId -> count */
  commentsByDoc: Map<string, number>
  /** docId -> latest update time */
  docsByPath: Map<string, string>
  /** authorId -> count */
  activeAuthors: Map<string, number>
}

type ActivityEvent = {
  id?: string
  type?: string
  time?: string
  author?: {id?: {uid?: string}}
  // The daemon serializes ID fields inconsistently — sometimes a bare
  // string, sometimes an object with id/uid/path/version. We tolerate
  // both via unwrapTargetId.
  docId?: unknown
  target?: unknown
  capability?: unknown
}

async function collectSnapshot(cli: SeedCli, seedSite: string, cutoffMs: number): Promise<Snapshot> {
  const r = await cli.runRead(['activity', '--limit', '300'])
  const all = ((r.parsedJson as {events?: ActivityEvent[]} | undefined)?.events) ?? []
  const siteAccount = seedSite.replace(/^hm:\/\//, '').split('/')[0]!
  const events: ActivityEvent[] = []
  const commentsByDoc = new Map<string, number>()
  const docsByPath = new Map<string, string>()
  const activeAuthors = new Map<string, number>()
  for (const ev of all) {
    if (!ev.time) continue
    const t = Date.parse(ev.time)
    if (Number.isFinite(t) && t < cutoffMs) continue
    // Filter to events touching our site.
    const target = unwrapTargetId(ev) ?? ''
    if (siteAccount && !target.includes(siteAccount)) continue
    events.push(ev)
    const author = ev.author?.id?.uid
    if (author) activeAuthors.set(author, (activeAuthors.get(author) ?? 0) + 1)
    if (ev.type === 'comment') {
      const docId = stripFragment(target)
      commentsByDoc.set(docId, (commentsByDoc.get(docId) ?? 0) + 1)
    }
    if (ev.type === 'doc-update') {
      const docIdStr = unwrapTargetId(ev)
      if (docIdStr) docsByPath.set(stripVersion(docIdStr), ev.time ?? '')
    }
  }
  return {events, commentsByDoc, docsByPath, activeAuthors}
}

function unwrapTargetId(ev: ActivityEvent): string | undefined {
  // Daemon serializes IDs as either a bare string OR an object
  // {id?, uid?, ...}. Tolerate both shapes (and refuse anything else).
  const tryId = (v: unknown): string | undefined => {
    if (typeof v === 'string') return v
    if (v && typeof v === 'object') {
      const o = v as {id?: unknown; uid?: unknown}
      if (typeof o.id === 'string') return o.id
      if (typeof o.uid === 'string') return `hm://${o.uid}`
    }
    return undefined
  }
  return tryId(ev.docId) ?? tryId(ev.target)
}

function stripFragment(id: string): string {
  return id.split('#')[0]!
}

function stripVersion(id: string): string {
  return id.split('?')[0]!.split('#')[0]!
}

// ─── Prompt builder ──────────────────────────────────────────────────────

function buildUserPrompt(tc: TaskConfig, snapshot: Snapshot): string {
  const lines: string[] = []
  lines.push(`Task: ${tc.task}`)
  lines.push(`Period: ${tc.periodLabel} (window: last ${tc.windowDays} days)`)
  lines.push(`Site activity snapshot below.`)
  lines.push('')
  lines.push(`### New / updated documents (${snapshot.docsByPath.size})`)
  for (const [doc, time] of snapshot.docsByPath) {
    lines.push(`- ${doc} (last update ${time})`)
  }
  lines.push('')
  lines.push(`### Comment activity by document (${snapshot.commentsByDoc.size} docs)`)
  for (const [doc, count] of snapshot.commentsByDoc) {
    lines.push(`- ${doc}: ${count} comments`)
  }
  lines.push('')
  lines.push(`### Active authors (${snapshot.activeAuthors.size})`)
  for (const [author, count] of snapshot.activeAuthors) {
    lines.push(`- ${author}: ${count} events`)
  }
  lines.push('')
  lines.push('### Raw events (most recent first, truncated)')
  const sample = snapshot.events.slice(0, 80)
  for (const ev of sample) {
    const author = ev.author?.id?.uid ?? '?'
    const target = unwrapTargetId(ev) ?? '?'
    lines.push(`- ${ev.time} ${ev.type} by ${author} → ${target}`)
  }
  lines.push('')
  lines.push(`Produce the document now. Stick to the section headings in the system prompt. Use plain markdown. Do not wrap in code fences. Do not add a YAML frontmatter — that will be inserted automatically.`)
  return lines.join('\n')
}

async function draftDoc(systemPrompt: string, userPrompt: string, audit: AuditRun): Promise<string | null> {
  const apiKey = process.env.DEEPSEEK_API_KEY
  if (!apiKey) {
    audit.trace({ts: nowIso(), level: 'error', event: 'deepseek_no_key'})
    return null
  }
  const body = JSON.stringify({
    model: 'deepseek-chat',
    messages: [
      {role: 'system', content: systemPrompt},
      {role: 'user', content: userPrompt},
    ],
    temperature: 0.3,
    max_tokens: 2400,
  })
  const t0 = Date.now()
  let res: Response
  try {
    res = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {'content-type': 'application/json', authorization: `Bearer ${apiKey}`},
      body,
    })
  } catch (err) {
    audit.trace({
      ts: nowIso(),
      level: 'error',
      event: 'deepseek_network_error',
      data: {message: err instanceof Error ? err.message : String(err)},
    })
    return null
  }
  const latencyMs = Date.now() - t0
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    audit.trace({
      ts: nowIso(),
      level: 'error',
      event: 'deepseek_http_error',
      data: {status: res.status, body: text.slice(0, 400), latencyMs},
    })
    return null
  }
  const json = (await res.json()) as {
    choices?: Array<{message?: {content?: string}}>
    usage?: {prompt_tokens?: number; completion_tokens?: number; total_tokens?: number}
  }
  const completion = json.choices?.[0]?.message?.content?.trim()
  audit.llm({
    ts_start: new Date(t0).toISOString(),
    ts_end: nowIso(),
    latency_ms: latencyMs,
    model: 'deepseek-chat',
    completion: completion ?? '',
    usage: {
      prompt: json.usage?.prompt_tokens,
      completion: json.usage?.completion_tokens,
      total: json.usage?.total_tokens,
    },
  })
  return completion ?? null
}

// ─── Output assembly ─────────────────────────────────────────────────────

function ensureFrontmatter(body: string, fm: Record<string, string>): string {
  if (body.startsWith('---\n')) return body
  const lines: string[] = ['---']
  for (const [k, v] of Object.entries(fm)) {
    lines.push(`${k}: ${escapeYaml(v)}`)
  }
  lines.push('---', '')
  return lines.join('\n') + '\n' + body
}

function escapeYaml(value: string): string {
  if (/^[a-zA-Z0-9_./-]+$/.test(value)) return value
  return JSON.stringify(value)
}

async function writeTempMarkdown(body: string): Promise<string> {
  const {writeFileSync} = await import('node:fs')
  const {tmpdir} = await import('node:os')
  const {join} = await import('node:path')
  const path = join(tmpdir(), `km-cadence-${Date.now()}-${Math.random().toString(36).slice(2)}.md`)
  writeFileSync(path, body, {mode: 0o600})
  return path
}

function extractLink(stdout: string): string | undefined {
  return stdout.match(/https?:\/\/\S+/)?.[0]
}

function nowIso(): string {
  return new Date().toISOString()
}

function isoDateStamp(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function isoMonthStamp(d: Date): string {
  return d.toISOString().slice(0, 7)
}

function isoWeekStamp(d: Date): string {
  // ISO week per https://en.wikipedia.org/wiki/ISO_week_date
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const day = t.getUTCDay() || 7
  t.setUTCDate(t.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1))
  const weekNum = Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
  return `${t.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('km-cadence fatal:', err)
  process.exit(1)
})
