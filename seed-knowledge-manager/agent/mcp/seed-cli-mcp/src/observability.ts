import type {Redactor} from './redact.js'

export type TelemetryKind =
  | 'run_meta'
  | 'trace'
  | 'llm'
  | 'tool'
  | 'seed_cli'
  | 'machine_event'
  | 'machine_snapshot'

export type ObservabilityClient = {
  emit(kind: TelemetryKind, runId: string | null, data: unknown): void
  flush(timeoutMs?: number): Promise<void>
}

type ClientConfig = {
  url: string
  token?: string
  fullPayload: boolean
}

const STRING_LIMIT = 300
const LARGE_STRING_LIMIT = 1_200

export function createObservabilityClientFromEnv(redactor: Redactor, env: NodeJS.ProcessEnv = process.env): ObservabilityClient | null {
  const rawUrl = env.KM_OBS_URL
  if (!rawUrl) return null
  const url = normalizeIngestUrl(rawUrl)
  if (!url) return null
  return createObservabilityClient(
    {
      url,
      token: env.KM_OBS_TOKEN,
      fullPayload: /^(1|true|yes)$/i.test(env.KM_OBS_FULL_PAYLOAD ?? ''),
    },
    redactor,
  )
}

export function createObservabilityClient(config: ClientConfig, redactor: Redactor): ObservabilityClient {
  const pending = new Set<Promise<void>>()
  const emit = (kind: TelemetryKind, runId: string | null, data: unknown): void => {
    const payload = sanitizeForObservability(kind, data, config.fullPayload, redactor)
    const envelope = {
      kind,
      runId,
      ts: pickTimestamp(payload),
      source: 'km',
      data: payload,
    }
    const task = fetch(config.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(config.token ? {authorization: `Bearer ${config.token}`} : {}),
      },
      body: redactor(JSON.stringify(envelope)),
    })
      .then(async (res) => {
        if (!res.ok) await res.arrayBuffer().catch(() => undefined)
      })
      .catch(() => undefined)
      .finally(() => pending.delete(task))
    pending.add(task)
  }
  return {
    emit,
    async flush(timeoutMs = 1_500): Promise<void> {
      if (pending.size === 0) return
      await Promise.race([
        Promise.allSettled(Array.from(pending)).then(() => undefined),
        new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
      ])
    },
  }
}

export function sanitizeForObservability(kind: TelemetryKind, data: unknown, fullPayload: boolean, redactor: Redactor): unknown {
  if (fullPayload) return redactedJsonClone(data, redactor)
  const value = redactedJsonClone(data, redactor)
  const record = isRecord(value) ? value : {value}
  switch (kind) {
    case 'llm':
      return compactObject({
        ts_start: record.ts_start,
        ts_end: record.ts_end,
        latency_ms: record.latency_ms,
        model: record.model,
        completion: truncateString(record.completion, LARGE_STRING_LIMIT),
        reasoning: truncateString(record.reasoning, STRING_LIMIT),
        usage: limitDeep(record.usage, 2),
        tool_call_count: Array.isArray(record.tool_calls) ? record.tool_calls.length : undefined,
        tool_calls: Array.isArray(record.tool_calls)
          ? record.tool_calls.map((call) => callName(call)).filter((name): name is string => typeof name === 'string')
          : undefined,
      })
    case 'seed_cli':
      return compactObject({
        ts_start: record.ts_start,
        ts_end: record.ts_end,
        latency_ms: record.latency_ms,
        argv: Array.isArray(record.argv) ? record.argv.map((item) => truncateString(item, STRING_LIMIT)) : undefined,
        exit_code: record.exit_code,
        stdout: truncateString(record.stdout, LARGE_STRING_LIMIT),
        stderr: truncateString(record.stderr, LARGE_STRING_LIMIT),
      })
    case 'tool':
      return compactObject({
        ts_start: record.ts_start,
        ts_end: record.ts_end,
        latency_ms: record.latency_ms,
        tool: record.tool,
        args: limitDeep(record.args, 3),
        result: limitDeep(record.result, 3),
        error: truncateString(record.error, LARGE_STRING_LIMIT),
      })
    case 'trace':
      return compactObject({
        ts: record.ts,
        level: record.level,
        event: record.event,
        data: limitDeep(record.data, 4),
      })
    case 'machine_event':
    case 'machine_snapshot':
    case 'run_meta':
      return limitDeep(record, 5)
  }
}

function normalizeIngestUrl(raw: string): string | null {
  try {
    const url = new URL(raw)
    if (url.pathname === '/' || url.pathname === '') url.pathname = '/api/ingest'
    return url.toString()
  } catch {
    return null
  }
}

function redactedJsonClone(value: unknown, redactor: Redactor): unknown {
  try {
    return JSON.parse(redactor(JSON.stringify(value)))
  } catch {
    return redactor(String(value))
  }
}

function pickTimestamp(value: unknown): string | null {
  const record = isRecord(value) ? value : null
  const candidates = [record?.ts, record?.ts_start, record?.startedAt]
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.length > 0) return candidate
  }
  return null
}

function limitDeep(value: unknown, depth: number): unknown {
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'string') return truncateString(value, STRING_LIMIT)
  if (depth <= 0) return summarize(value)
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => limitDeep(item, depth - 1))
  if (isRecord(value)) {
    const out: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value).slice(0, 40)) out[key] = limitDeep(child, depth - 1)
    return out
  }
  return String(value)
}

function summarize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.length} items]`
  if (isRecord(value)) return `{${Object.keys(value).length} keys}`
  return truncateString(String(value), STRING_LIMIT) ?? ''
}

function truncateString(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined
  return value.length <= max ? value : `${value.slice(0, max)}…`
}

function callName(value: unknown): string | null {
  if (!isRecord(value)) return null
  if (typeof value.name === 'string') return value.name
  const fn = isRecord(value.function) ? value.function : null
  return typeof fn?.name === 'string' ? fn.name : null
}

function compactObject(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, child]) => child !== undefined))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
