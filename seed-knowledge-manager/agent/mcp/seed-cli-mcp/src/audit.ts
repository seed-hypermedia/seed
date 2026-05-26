/**
 * Per-run audit log. Each agent invocation gets its own directory under
 * `${logsDir}/runs/<UTC-ISO>__<trigger>__<runId>/` with a stable layout:
 *
 *   meta.json      — trigger, KM_AID, env hash, start/end, wall_ms
 *   trace.jsonl    — ordered events with timestamps
 *   llm.jsonl      — prompts, completions, reasoning, token usage
 *   tools.jsonl    — MCP tool calls + latency
 *   seed-cli.jsonl — argv + stdout + stderr + exit + ms
 *
 * A `current` symlink in `${logsDir}` always points at the newest run for
 * easy `tail -F current/trace.jsonl`. A top-level `index.jsonl` carries one
 * summary line per run for `km-log` browsing.
 *
 * All writes are append-only with `O_APPEND` and flushed eagerly so a crash
 * never loses the last record. All values pass through the Redactor before
 * being serialised so the persisted log can never contain a known secret.
 */

import {appendFileSync, closeSync, existsSync, mkdirSync, openSync, statSync, symlinkSync, unlinkSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {ulid} from 'ulid'
import type {Redactor} from './redact.js'
import {createObservabilityClientFromEnv, type ObservabilityClient, type TelemetryKind} from './observability.js'

export type Trigger = string

export type AuditMeta = {
  runId: string
  trigger: Trigger
  startedAt: string
  endedAt?: string
  wallMs?: number
  status?: 'ok' | 'error' | 'denied'
  kmAccountId?: string
  seedSite?: string
  counters?: Record<string, number>
}

export type TraceEvent = {
  ts: string
  level: 'debug' | 'info' | 'warn' | 'error'
  event: string
  data?: unknown
}

export type ToolCallRecord = {
  ts_start: string
  ts_end: string
  latency_ms: number
  tool: string
  args: unknown
  result?: unknown
  error?: string
}

export type SeedCliRecord = {
  ts_start: string
  ts_end: string
  latency_ms: number
  argv: string[]
  exit_code: number
  stdout?: string
  stderr?: string
}

export type LlmRecord = {
  ts_start: string
  ts_end: string
  latency_ms: number
  model?: string
  prompt_messages?: unknown
  completion?: string
  reasoning?: string
  tool_calls?: unknown
  usage?: {prompt?: number; completion?: number; total?: number}
}

export class AuditRun {
  readonly meta: AuditMeta
  readonly dir: string
  private readonly redactor: Redactor
  private readonly observability: ObservabilityClient | null
  private closed = false
  private startTime: number

  constructor(opts: {logsDir: string; trigger: Trigger; redactor: Redactor; kmAccountId?: string; seedSite?: string}) {
    this.redactor = opts.redactor
    this.observability = createObservabilityClientFromEnv(opts.redactor)
    const runId = ulid()
    const now = new Date()
    this.startTime = now.getTime()
    const isoSlug = now.toISOString().replace(/[:]/g, '-').replace(/\..+$/, 'Z')
    const slug = `${isoSlug}__${sanitize(opts.trigger)}__${runId}`
    this.dir = join(opts.logsDir, 'runs', slug)
    mkdirSync(this.dir, {recursive: true, mode: 0o700})
    this.meta = {
      runId,
      trigger: opts.trigger,
      startedAt: now.toISOString(),
      kmAccountId: opts.kmAccountId,
      seedSite: opts.seedSite,
      counters: {},
    }
    this.flushMeta()
    this.emitTelemetry('run_meta', this.meta)
    this.updateCurrent(opts.logsDir, slug)
  }

  trace(event: TraceEvent): void {
    this.appendJsonl('trace.jsonl', event)
    this.emitTelemetry('trace', event)
  }

  tool(record: ToolCallRecord): void {
    this.appendJsonl('tools.jsonl', record)
    this.emitTelemetry('tool', record)
    this.bumpCounter('tool_calls')
  }

  llm(record: LlmRecord): void {
    this.appendJsonl('llm.jsonl', record)
    this.emitTelemetry('llm', record)
    this.bumpCounter('llm_calls')
  }

  seedCli(record: SeedCliRecord): void {
    this.appendJsonl('seed-cli.jsonl', record)
    this.emitTelemetry('seed_cli', record)
    this.bumpCounter('seed_cli_calls')
  }

  telemetry(kind: TelemetryKind, data: unknown): void {
    this.emitTelemetry(kind, data)
  }

  async flushTelemetry(timeoutMs = 1_500): Promise<void> {
    await this.observability?.flush(timeoutMs)
  }

  bumpCounter(name: string, delta = 1): void {
    if (!this.meta.counters) this.meta.counters = {}
    this.meta.counters[name] = (this.meta.counters[name] ?? 0) + delta
  }

  close(opts: {status?: 'ok' | 'error' | 'denied'; logsDir: string}): void {
    if (this.closed) return
    this.closed = true
    const now = new Date()
    this.meta.endedAt = now.toISOString()
    this.meta.wallMs = now.getTime() - this.startTime
    this.meta.status = opts.status ?? 'ok'
    this.flushMeta()
    this.emitTelemetry('run_meta', this.meta)
    appendIndex(opts.logsDir, this.meta)
  }

  private emitTelemetry(kind: TelemetryKind, data: unknown): void {
    this.observability?.emit(kind, this.meta.runId, data)
  }

  private appendJsonl(file: string, value: unknown): void {
    const line = this.redactor(JSON.stringify(value)) + '\n'
    const path = join(this.dir, file)
    const fd = openSync(path, 'a')
    try {
      appendFileSync(fd, line)
    } finally {
      // openSync + appendFileSync(fd) doesn't auto-close; release the fd.
      closeSync(fd)
    }
  }

  private flushMeta(): void {
    const path = join(this.dir, 'meta.json')
    writeFileSync(path, this.redactor(JSON.stringify(this.meta, null, 2)) + '\n', {mode: 0o600})
  }

  private updateCurrent(logsDir: string, slug: string): void {
    const link = join(logsDir, 'current')
    try {
      if (existsSync(link)) unlinkSync(link)
    } catch {
      /* ignore */
    }
    try {
      symlinkSync(join('runs', slug), link)
    } catch {
      /* logsDir may be on a fs without symlink support; non-fatal */
    }
  }
}

function appendIndex(logsDir: string, meta: AuditMeta): void {
  const indexPath = join(logsDir, 'index.jsonl')
  if (!existsSync(logsDir)) mkdirSync(logsDir, {recursive: true, mode: 0o700})
  const line =
    JSON.stringify({
      id: meta.runId,
      trigger: meta.trigger,
      start: meta.startedAt,
      end: meta.endedAt,
      status: meta.status,
      wall_ms: meta.wallMs,
      counters: meta.counters,
    }) + '\n'
  appendFileSync(indexPath, line)
  try {
    statSync(indexPath)
  } catch {
    /* ignore */
  }
}

function sanitize(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 64)
}
