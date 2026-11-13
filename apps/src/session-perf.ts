/**
 * Per-session latency rollup: turns one session's durable rows into the breakdown that answers
 * "where did this session's wall time go" — model turns vs tool execution vs sandbox overhead vs
 * waiting for the user — without anyone replaying the transcript by hand.
 *
 * Pure over already-decoded rows so it is unit-testable without a service harness; the API layer
 * feeds it `runs` and `session_events` rows and serves the result at
 * `GET /api/perf/sessions/:sessionId`. The rollup contains tool names, counts, and millisecond
 * aggregates only — never message content, arguments, or outputs.
 *
 * Attribution model (event timestamps are append times):
 * - The gap before a `tool_call` or assistant `message` inside a run window is model time: the
 *   provider was streaming or thinking. Gaps outside every run window are the user's own pauses.
 * - `tool_result` meta.durationMs is tool time, summed by tool name.
 * - `tool_result` outputs that carry a numeric `bootMs` (code exec) accumulate sandbox boot
 *   overhead, the slice a warm pool removes.
 * - Events stamped with `meta.turn` (ttftMs/turnMs) additionally aggregate provider-side turn
 *   timing exactly as the provider reported it, deduplicated per turn index.
 */

export type SessionPerfRunRow = {
  id: string
  status: string
  createdAt: number
  startedAt: number | null
  finishedAt: number | null
}

export type SessionPerfEventRow = {
  seq: number
  createdAt: number
  /** Decoded session event payload (`event_cbor`). Unknown shapes are counted, never trusted. */
  event: unknown
}

export type SessionPerfToolStat = {count: number; totalMs: number; maxMs: number}

export type SessionPerfRollup = {
  sessionId: string
  eventCount: number
  runs: Array<{
    id: string
    status: string
    /** Run became dispatchable → executor started (queueing, e.g. behind the concurrency cap). */
    dispatchWaitMs: number | null
    /** startedAt → finishedAt; null while the run is still going. */
    activeMs: number | null
  }>
  totals: {
    /** Sum of finished runs' active spans. */
    activeMs: number
    /** Gap time attributed to the model (before tool_calls / assistant messages inside runs). */
    modelGapMs: number
    /** Gap time outside every run window: the user reading, typing, or away. */
    idleMs: number
    /** Sum of all tool_result durations. */
    toolMs: number
    /** Sandbox cold-boot milliseconds buried inside tool time (what a warm pool removes). */
    execBootMs: number
    execBootCount: number
  }
  tools: Record<string, SessionPerfToolStat>
  /** Provider-reported per-turn timing from meta.turn, present once events carry it. */
  turns: {
    count: number
    totalTurnMs: number
    totalTtftMs: number
    maxTurnMs: number
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** Computes the rollup. `events` must be ordered by seq ascending; runs by createdAt. */
export function sessionPerfRollup(
  sessionId: string,
  runs: SessionPerfRunRow[],
  events: SessionPerfEventRow[],
): SessionPerfRollup {
  const runWindows = runs
    .filter((run) => run.startedAt !== null)
    .map((run) => ({start: run.startedAt!, end: run.finishedAt ?? Number.POSITIVE_INFINITY}))
  const inRun = (at: number) => runWindows.some((w) => at >= w.start && at <= w.end)

  const tools: Record<string, SessionPerfToolStat> = {}
  const totals = {activeMs: 0, modelGapMs: 0, idleMs: 0, toolMs: 0, execBootMs: 0, execBootCount: 0}
  const turnsSeen = new Set<string>()
  const turns = {count: 0, totalTurnMs: 0, totalTtftMs: 0, maxTurnMs: 0}

  let prevAt: number | null = null
  for (const row of events) {
    const event = isRecord(row.event) ? row.event : {}
    const type = typeof event.type === 'string' ? event.type : undefined
    const role = typeof event.role === 'string' ? event.role : undefined

    if (prevAt !== null) {
      const gap = Math.max(0, row.createdAt - prevAt)
      const modelAuthored = type === 'tool_call' || (type === 'message' && role !== 'user')
      if (modelAuthored) {
        if (inRun(row.createdAt)) totals.modelGapMs += gap
        else totals.idleMs += gap
      } else if (!inRun(row.createdAt)) {
        totals.idleMs += gap
      }
    }
    prevAt = row.createdAt

    const meta = isRecord(event.meta) ? event.meta : undefined
    if (type === 'tool_result') {
      const name = typeof event.name === 'string' ? event.name : 'unknown'
      const durationMs = asFiniteNumber(meta?.durationMs) ?? 0
      const stat = (tools[name] ??= {count: 0, totalMs: 0, maxMs: 0})
      stat.count += 1
      stat.totalMs += durationMs
      if (durationMs > stat.maxMs) stat.maxMs = durationMs
      totals.toolMs += durationMs
      const output = isRecord(event.output) ? event.output : undefined
      const bootMs = asFiniteNumber(output?.bootMs)
      if (bootMs !== undefined) {
        totals.execBootMs += bootMs
        totals.execBootCount += 1
      }
    }

    const turn = meta && isRecord(meta.turn) ? meta.turn : undefined
    if (turn) {
      const turnMs = asFiniteNumber(turn.turnMs)
      const index = asFiniteNumber(turn.index)
      // The same turn stamps every event it appends; count it once. Turn indexes restart per run,
      // so the dedup key includes the nearest preceding run window start.
      const windowStart = runWindows.filter((w) => w.start <= row.createdAt).at(-1)?.start ?? 0
      const key = `${windowStart}:${index ?? row.seq}`
      if (turnMs !== undefined && !turnsSeen.has(key)) {
        turnsSeen.add(key)
        turns.count += 1
        turns.totalTurnMs += turnMs
        turns.totalTtftMs += asFiniteNumber(turn.ttftMs) ?? 0
        if (turnMs > turns.maxTurnMs) turns.maxTurnMs = turnMs
      }
    }
  }

  const runsOut = runs.map((run) => ({
    id: run.id,
    status: run.status,
    dispatchWaitMs: run.startedAt !== null ? Math.max(0, run.startedAt - run.createdAt) : null,
    activeMs: run.startedAt !== null && run.finishedAt !== null ? Math.max(0, run.finishedAt - run.startedAt) : null,
  }))
  totals.activeMs = runsOut.reduce((sum, run) => sum + (run.activeMs ?? 0), 0)

  return {sessionId, eventCount: events.length, runs: runsOut, totals, tools, turns}
}
