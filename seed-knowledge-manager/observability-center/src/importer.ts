import {existsSync, readdirSync, readFileSync, statSync} from 'node:fs'
import {basename, join} from 'node:path'
import type {IngestEvent, EventKind} from './schema.js'
import type {Store} from './store.js'

export type ImportOptions = {
  logsDir?: string | null
  stateDir?: string | null
  fullPayload?: boolean
}

export type ImportResult = {
  events: number
  runs: number
  machineFiles: number
}

const LOG_FILES: Array<{file: string; kind: EventKind}> = [
  {file: 'trace.jsonl', kind: 'trace'},
  {file: 'llm.jsonl', kind: 'llm'},
  {file: 'tools.jsonl', kind: 'tool'},
  {file: 'seed-cli.jsonl', kind: 'seed_cli'},
]

export function importKmArtifacts(store: Store, opts: ImportOptions): ImportResult {
  const result: ImportResult = {events: 0, runs: 0, machineFiles: 0}
  if (opts.logsDir) importRuns(store, opts.logsDir, opts.fullPayload === true, result)
  if (opts.stateDir) importMachines(store, opts.stateDir, result)
  return result
}

function importRuns(store: Store, logsDir: string, fullPayload: boolean, result: ImportResult): void {
  const runsDir = join(logsDir, 'runs')
  if (!existsSync(runsDir)) return
  for (const runSlug of safeReaddir(runsDir)) {
    const runDir = join(runsDir, runSlug)
    if (!safeStat(runDir)?.isDirectory()) continue
    const metaPath = join(runDir, 'meta.json')
    const meta = readJson(metaPath)
    const runId = recordObject(meta)?.runId
    if (meta) {
      store.record({kind: 'run_meta', runId: stringOrNull(runId), source: 'km-import', importedKey: `${metaPath}:meta`, data: meta})
      result.events++
      result.runs++
    }
    for (const {file, kind} of LOG_FILES) {
      const path = join(runDir, file)
      for (const {lineNo, value} of readJsonl(path)) {
        const event: IngestEvent = {
          kind,
          runId: stringOrNull(runId),
          source: 'km-import',
          importedKey: `${path}:${lineNo}`,
          data: fullPayload ? value : compactPayload(kind, value),
        }
        store.record(event)
        result.events++
      }
    }
  }
}

function importMachines(store: Store, stateDir: string, result: ImportResult): void {
  const machinesDir = join(stateDir, 'machines')
  if (!existsSync(machinesDir)) return
  for (const file of safeReaddir(machinesDir)) {
    if (!file.endsWith('.jsonl')) continue
    result.machineFiles++
    const actorId = basename(file, '.jsonl')
    const path = join(machinesDir, file)
    for (const {lineNo, value} of readJsonl(path)) {
      const row = recordObject(value) ?? {}
      const initialMention = recordObject(row.initialMention)
      const payload = recordObject(row.payload) ?? {}
      const mention = initialMention ?? recordObject(payload.mention) ?? null
      const data = {
        event: row.initialMention ? 'actor_persisted_enqueue' : 'persisted_event',
        type: typeof row.type === 'string' ? row.type : undefined,
        ts: typeof row.ts === 'string' ? row.ts : undefined,
        actorId,
        mentionId: actorId,
        commentId: stringOrNull(recordObject(mention)?.commentId),
        docId: stringOrNull(recordObject(mention)?.docId),
        payload,
        initialMention,
      }
      store.record({
        kind: 'machine_event',
        source: 'km-import',
        importedKey: `${path}:${lineNo}`,
        ts: typeof row.ts === 'string' ? row.ts : null,
        data,
      })
      result.events++
    }
  }
}

function readJson(path: string): unknown | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

function readJsonl(path: string): Array<{lineNo: number; value: unknown}> {
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8')
    .split('\n')
    .map((line, index) => ({line, lineNo: index + 1}))
    .filter(({line}) => line.trim().length > 0)
    .flatMap(({line, lineNo}) => {
      try {
        return [{lineNo, value: JSON.parse(line)}]
      } catch {
        return []
      }
    })
}

function safeReaddir(path: string): string[] {
  try {
    return readdirSync(path)
  } catch {
    return []
  }
}

function safeStat(path: string): ReturnType<typeof statSync> | null {
  try {
    return statSync(path)
  } catch {
    return null
  }
}

function recordObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function compactPayload(kind: EventKind, value: unknown): unknown {
  const record = recordObject(value) ?? {value}
  if (kind === 'llm') {
    return compactObject({
      ts_start: record.ts_start,
      ts_end: record.ts_end,
      latency_ms: record.latency_ms,
      model: record.model,
      completion: truncate(record.completion, 1_200),
      reasoning: truncate(record.reasoning, 300),
      usage: limitDeep(record.usage, 2),
      tool_call_count: Array.isArray(record.tool_calls) ? record.tool_calls.length : undefined,
    })
  }
  if (kind === 'seed_cli') {
    return compactObject({
      ts_start: record.ts_start,
      ts_end: record.ts_end,
      latency_ms: record.latency_ms,
      argv: Array.isArray(record.argv) ? record.argv.map((item) => truncate(item, 300)) : undefined,
      exit_code: record.exit_code,
      stdout: truncate(record.stdout, 1_200),
      stderr: truncate(record.stderr, 1_200),
    })
  }
  if (kind === 'tool') {
    return compactObject({
      ts_start: record.ts_start,
      ts_end: record.ts_end,
      latency_ms: record.latency_ms,
      tool: record.tool,
      args: limitDeep(record.args, 3),
      result: limitDeep(record.result, 3),
      error: truncate(record.error, 1_200),
    })
  }
  if (kind === 'trace') {
    return compactObject({ts: record.ts, level: record.level, event: record.event, data: limitDeep(record.data, 4)})
  }
  return limitDeep(record, 5)
}

function limitDeep(value: unknown, depth: number): unknown {
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'string') return truncate(value, 300)
  if (depth <= 0) return Array.isArray(value) ? `[${value.length} items]` : recordObject(value) ? `{${Object.keys(value).length} keys}` : String(value)
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => limitDeep(item, depth - 1))
  const record = recordObject(value)
  if (!record) return String(value)
  return Object.fromEntries(Object.entries(record).slice(0, 40).map(([key, child]) => [key, limitDeep(child, depth - 1)]))
}

function truncate(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined
  return value.length <= max ? value : `${value.slice(0, max)}…`
}

function compactObject(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, child]) => child !== undefined))
}
