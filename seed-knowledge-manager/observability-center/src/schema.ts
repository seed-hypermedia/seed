export type EventKind =
  | 'run_meta'
  | 'trace'
  | 'llm'
  | 'tool'
  | 'seed_cli'
  | 'machine_event'
  | 'machine_snapshot'

export type IngestEvent = {
  kind: EventKind
  runId?: string | null
  ts?: string | null
  source?: string | null
  importedKey?: string | null
  data: unknown
}

export type IngestEnvelope = IngestEvent | {events: IngestEvent[]}

export type NormalizedEvent = {
  kind: EventKind
  runId: string | null
  ts: string
  source: string
  importedKey: string | null
  eventName: string | null
  level: string | null
  commentId: string | null
  mentionId: string | null
  actorId: string | null
  placeholderId: string | null
  state: string | null
  status: string | null
  preview: string | null
  payload: unknown
}

export type RunRow = {
  runId: string
  trigger: string | null
  startedAt: string | null
  endedAt: string | null
  status: string | null
  wallMs: number | null
  seedSite: string | null
  kmAccountId: string | null
  countersJson: string | null
}

export type LiveSummary = {
  aliveActors: number
  activeRuns: number
  latestEvents: Array<Record<string, unknown>>
  updatedAt: string
}

export const EVENT_KINDS: readonly EventKind[] = [
  'run_meta',
  'trace',
  'llm',
  'tool',
  'seed_cli',
  'machine_event',
  'machine_snapshot',
] as const

export function parseEnvelope(value: unknown): IngestEvent[] {
  if (!isRecord(value)) throw new Error('ingest payload must be an object')
  if (Array.isArray(value.events)) return value.events.map(parseEvent)
  return [parseEvent(value)]
}

function parseEvent(value: unknown): IngestEvent {
  if (!isRecord(value)) throw new Error('event must be an object')
  if (!isEventKind(value.kind)) throw new Error(`invalid event kind: ${String(value.kind)}`)
  if (!('data' in value)) throw new Error('event.data is required')
  return {
    kind: value.kind,
    runId: optionalString(value.runId),
    ts: optionalString(value.ts),
    source: optionalString(value.source),
    importedKey: optionalString(value.importedKey),
    data: value.data,
  }
}

function isEventKind(value: unknown): value is EventKind {
  return typeof value === 'string' && (EVENT_KINDS as readonly string[]).includes(value)
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function normalizeEvent(event: IngestEvent): NormalizedEvent {
  const data = isRecord(event.data) ? event.data : {value: event.data}
  const ts = event.ts ?? pickString(data, ['ts', 'ts_start', 'startedAt', 'start']) ?? new Date().toISOString()
  const runId = event.runId ?? pickString(data, ['runId', 'run_id'])
  const eventName = pickString(data, ['event', 'type', 'name', 'tool']) ?? event.kind
  const commentId = findStringDeep(data, ['commentId', 'comment_id'])
  const mentionId = findStringDeep(data, ['mentionId', 'mention_id'])
  const placeholderId = findStringDeep(data, ['placeholderId', 'placeholder_id'])
  const actorId = findStringDeep(data, ['actorId', 'actor_id']) ?? mentionId
  const state = stringifyState(findDeep(data, ['state', 'stateValue', 'value']))
  const status = pickString(data, ['status'])
  return {
    kind: event.kind,
    runId,
    ts,
    source: event.source ?? 'km',
    importedKey: event.importedKey ?? null,
    eventName,
    level: pickString(data, ['level']),
    commentId,
    mentionId,
    actorId,
    placeholderId,
    state,
    status,
    preview: summarizePreview(event.kind, data),
    payload: event.data,
  }
}

function pickString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.length > 0) return value
  }
  return null
}

function findStringDeep(value: unknown, keys: string[]): string | null {
  const found = findDeep(value, keys)
  return typeof found === 'string' && found.length > 0 ? found : null
}

function findDeep(value: unknown, keys: string[], depth = 0): unknown {
  if (depth > 5 || !isRecord(value)) return undefined
  for (const key of keys) {
    if (key in value) return value[key]
  }
  for (const child of Object.values(value)) {
    const found = findDeep(child, keys, depth + 1)
    if (found !== undefined) return found
  }
  return undefined
}

function stringifyState(value: unknown): string | null {
  if (value == null) return null
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function summarizePreview(kind: EventKind, data: Record<string, unknown>): string | null {
  if (kind === 'trace') {
    const event = pickString(data, ['event']) ?? 'trace'
    const nested = isRecord(data.data) ? data.data : {}
    const reason = pickString(nested, ['reason', 'message'])
    const commentId = pickString(nested, ['commentId'])
    return [event, commentId, reason].filter(Boolean).join(' · ')
  }
  if (kind === 'llm') {
    const model = pickString(data, ['model'])
    const completion = pickString(data, ['completion'])
    return [model, completion ? truncate(completion, 180) : null].filter(Boolean).join(' · ')
  }
  if (kind === 'seed_cli') {
    const argv = Array.isArray(data.argv) ? data.argv.join(' ') : null
    const exit = typeof data.exit_code === 'number' ? `exit ${data.exit_code}` : null
    return [exit, argv ? truncate(argv, 180) : null].filter(Boolean).join(' · ')
  }
  if (kind === 'machine_event' || kind === 'machine_snapshot') {
    const event = pickString(data, ['event', 'type'])
    const state = stringifyState(data.state ?? data.stateValue)
    return [event, state].filter(Boolean).join(' → ')
  }
  try {
    return truncate(JSON.stringify(data), 240)
  } catch {
    return null
  }
}

export function truncate(value: string, max: number): string {
  if (value.length <= max) return value
  return `${value.slice(0, max)}…`
}
