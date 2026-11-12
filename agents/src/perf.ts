/**
 * In-process latency instrumentation for the Agents service.
 *
 * The service already stamps durations onto individual transcript events, but nothing aggregates
 * them, so "agents feel slow" cannot be answered with numbers. This module keeps a process-wide
 * rolling window per metric — count, min/max, mean, and percentiles over the most recent samples —
 * cheap enough to record on every hot-path span (one array write, no allocation beyond the ring).
 *
 * The snapshot is served unauthenticated at `GET /api/perf` next to `/api/health`: it contains
 * only metric names and millisecond aggregates, never ids, accounts, or content.
 *
 * Metrics recorded today (all values in milliseconds):
 * - `provider.request_gap`   — turn dispatched → provider HTTP request actually sent
 * - `provider.ttft`          — provider request sent → first streamed output event (the latency a
 *                              person stares at)
 * - `provider.turn`          — provider request sent → assistant turn complete
 * - `exec.boot`              — execute_code sandbox creation (microVM cold boot)
 * - `exec.run`               — code running inside the sandbox
 * - `exec.teardown`          — sandbox stop/kill after the result is in hand
 * - `exec.total`             — whole execute_code span as the model experiences it
 * - `run.dispatch_delay`     — run became dispatchable → executor actually started
 * - `tool.<name>`            — each tool call's execution span, by tool name
 * - `tool.call.<inner>`      — the `call` verb's span split by the callable it dispatched to
 * - `prep.provider_runtime` / `prep.system_prompt` / `prep.tool_sync` / `prep.pi_session` /
 *   `prep.replay`            — the segments inside `provider.request_gap`, so the pre-turn silence
 *                              the user waits through is attributable; unnamed remainder = gap
 *                              minus these
 * - `provider.ttft.<provider>.<model>` / `provider.turn.<provider>.<model>` — the provider spans
 *   tagged by provider+model, so one slow model is visible next to the blend
 * - `api.<ActionName>`       — each signed action handled by `Service.message`, envelope receipt →
 *                              response (names only; unsupported action names are not recorded,
 *                              so a client cannot grow the metric set)
 * - `sql.<keyword>`          — every prepared-statement `.get/.all/.run/.values` call, by the
 *                              statement's first keyword (`select`, `insert`, `update`, ...), so
 *                              the share of loop time spent inside SQLite is visible
 *
 * Per-session attribution lives elsewhere: each turn's ttft/turn duration is stamped on the
 * session events it appends (`SessionEventMeta.turn`), and `GET /api/perf/sessions/:id` serves a
 * rollup of one session's model vs tool vs idle time (see `session-perf.ts`).
 *
 * Counters (occurrences, not durations):
 * - `provider.error.<provider>.<model>.<reason>` — provider turn errors, reason normalized to the
 *   bounded {@link ProviderErrorReason} set so overload/rate-limit spikes are visible and can be
 *   correlated with `run.dispatch_delay` / `provider.request_gap` / `provider.ttft` in the same
 *   snapshot.
 * - `run.retry.<code>`       — queue-level retries of failed runs, by error code.
 * - `web_read.cache_hit` / `web_read.cache_miss` / `web_read.coalesced` — the web_read page
 *   cache's effectiveness (see web-tools.ts).
 * - `exec.pool_hit` / `exec.pool_miss` / `exec.pool_overflow` — warm-pool acquisition outcomes.
 * - `exec.cap_wait` / `exec.cap_rejected` — an acquire queued behind the host-wide sandbox
 *   concurrency cap, or gave up waiting for a slot (`exec.cap_wait_ms` records the wait).
 * - `exec.memroot_wait` / `exec.memroot_rejected` — an acquire queued because another sandbox
 *   already had the same agent's memory directory mounted (another session, a delegated child, a
 *   trigger firing), or gave up waiting for it (`exec.memroot_wait_ms` records the wait).
 * - `exec.pool_reset_exhausted` / `exec.pool_reset_error` / `exec.pool_probe_failed` — why a
 *   pooled VM was disposed: its park reset ran out of pass budget (the guest's own verdict), the
 *   reset exchange broke, or the reuse probe failed.
 * - `sql.slow`               — a prepared statement took longer than the slow-statement threshold
 *                              (`statements.ts` also logs the SQL at `warn`, rate-limited).
 *
 * Event-loop lag (`loop.lag` in the snapshot) is the one metric that is not a span: a 100 ms timer
 * measures how late it fires, and the snapshot reports the lag distribution over the last minute.
 * It is the only number that says "the server is stalled" when every span looks fine — a stall
 * that never reaches `accept()` records no spans at all. `/api/health` turns 503 on it; see
 * {@link loopLagHealth}.
 */

/** Samples kept per metric for percentile estimates. Old samples fall off; totals keep counting. */
export const PERF_WINDOW_SIZE = 256

export type PerfMetricSnapshot = {
  /** Samples recorded over the process lifetime, including ones no longer in the window. */
  count: number
  /** Milliseconds, over the process lifetime. */
  min: number
  max: number
  mean: number
  /** Percentiles over the rolling window of recent samples. */
  p50: number
  p95: number
  /** Most recent sample and when it was recorded (epoch ms). */
  last: number
  lastAt: number
}

export type PerfSnapshot = {
  /** When this process started recording (epoch ms), so rates can be derived. */
  since: number
  metrics: Record<string, PerfMetricSnapshot>
  /** Occurrence counters (errors, retries) — events with no duration to measure. */
  counters: Record<string, {count: number; lastAt: number}>
  /** Event-loop health: how late the lag timer fires, over the last minute. */
  loop: {lag: LoopLagSnapshot}
}

/**
 * Bounded normalized cause of a provider error, so error-rate counters have fixed cardinality
 * instead of raw error text. `overloaded` and `rate_limited` are the provider pushing back;
 * `timeout` is the exchange dying of old age; everything else stays `other`.
 */
export type ProviderErrorReason = 'overloaded' | 'rate_limited' | 'timeout' | 'other'

/** Classifies a provider error message into its bounded reason. */
export function providerErrorReason(message: string | undefined): ProviderErrorReason {
  const text = (message ?? '').toLowerCase()
  if (/overload|529/.test(text)) return 'overloaded'
  if (/rate.?limit|too many requests|429/.test(text)) return 'rate_limited'
  if (/timed?.?out|deadline|etimedout|esockettimedout/.test(text)) return 'timeout'
  return 'other'
}

/** Counts one occurrence of an event that has no duration (an error, a retry). */
export function recordPerfCount(metric: string): void {
  const state = counters.get(metric)
  if (state) {
    state.count += 1
    state.lastAt = Date.now()
  } else {
    counters.set(metric, {count: 1, lastAt: Date.now()})
  }
}

type MetricState = {
  count: number
  min: number
  max: number
  total: number
  last: number
  lastAt: number
  window: number[]
  windowNext: number
}

const startedAt = Date.now()
const metrics = new Map<string, MetricState>()
const counters = new Map<string, {count: number; lastAt: number}>()

/** Records one duration sample. Negative durations are clamped to zero (clock skew, not signal). */
export function recordPerf(metric: string, durationMs: number): void {
  const value = durationMs < 0 ? 0 : durationMs
  let state = metrics.get(metric)
  if (!state) {
    state = {count: 0, min: value, max: value, total: 0, last: value, lastAt: 0, window: [], windowNext: 0}
    metrics.set(metric, state)
  }
  state.count += 1
  state.total += value
  if (value < state.min) state.min = value
  if (value > state.max) state.max = value
  state.last = value
  state.lastAt = Date.now()
  if (state.window.length < PERF_WINDOW_SIZE) {
    state.window.push(value)
  } else {
    state.window[state.windowNext] = value
    state.windowNext = (state.windowNext + 1) % PERF_WINDOW_SIZE
  }
}

/**
 * Starts a span and returns the function that ends it, recording the elapsed time. The span
 * records at most once, so racing an `end` from a `finally` against an explicit call is safe.
 */
export function startPerfSpan(metric: string): () => number {
  const spanStartedAt = Date.now()
  let done = false
  return () => {
    const elapsed = Date.now() - spanStartedAt
    if (!done) {
      done = true
      recordPerf(metric, elapsed)
    }
    return elapsed
  }
}

function percentile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) return 0
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1))
  return sorted[index]!
}

/** Aggregate view of every metric, alphabetical, safe to serve as JSON. */
export function perfSnapshot(): PerfSnapshot {
  const out: Record<string, PerfMetricSnapshot> = {}
  for (const name of [...metrics.keys()].sort()) {
    const state = metrics.get(name)!
    const sorted = [...state.window].sort((a, b) => a - b)
    out[name] = {
      count: state.count,
      min: state.min,
      max: state.max,
      mean: state.count ? Math.round((state.total / state.count) * 10) / 10 : 0,
      p50: percentile(sorted, 0.5),
      p95: percentile(sorted, 0.95),
      last: state.last,
      lastAt: state.lastAt,
    }
  }
  const countersOut: Record<string, {count: number; lastAt: number}> = {}
  for (const name of [...counters.keys()].sort()) countersOut[name] = {...counters.get(name)!}
  return {since: startedAt, metrics: out, counters: countersOut, loop: {lag: loopLagSnapshot()}}
}

// ---------------------------------------------------------------------------------------------
// Event-loop lag
// ---------------------------------------------------------------------------------------------

/** How often the lag gauge's timer fires. Lag is how much later than this it actually ran. */
export const LOOP_LAG_INTERVAL_MS = 100

/** The window the lag percentiles and `max` cover: the last minute of samples. */
export const LOOP_LAG_WINDOW_MS = 60_000

/**
 * `/api/health` answers 503 (`reason: 'loop-lag'`) while the p95 lag over the last minute is above
 * this. 250 ms is a quarter of the interval Bun resets idle HTTP requests at, is far above the
 * few-millisecond lag a healthy server shows under load, and is below the point where clients
 * start timing out. The same rule drives the container healthcheck, so a stalled server shows as
 * unhealthy in `docker ps` instead of "Up".
 */
export const LOOP_LAG_UNHEALTHY_P95_MS = 250

/**
 * Samples the ring keeps: two minutes at the default interval, so the one-minute window is always
 * fully covered even when the timer fires early. Older samples are overwritten in place.
 */
const LOOP_LAG_CAPACITY = Math.ceil((2 * LOOP_LAG_WINDOW_MS) / LOOP_LAG_INTERVAL_MS)

export type LoopLagSnapshot = {
  /** Timer interval the lag is measured against. */
  intervalMs: number
  /** The window the percentiles and `max` are computed over. */
  windowMs: number
  /** Samples inside the window. Zero until the gauge has fired once. */
  samples: number
  /** Milliseconds late over the window. */
  p50: number
  p95: number
  max: number
  /** The largest lag seen since the process started, so a past stall is still visible. */
  maxSinceStart: number
  /** Most recent sample and when it was recorded (epoch ms). */
  last: number
  lastAt: number
}

type LoopLagState = {
  at: Float64Array
  lag: Float64Array
  length: number
  next: number
  maxSinceStart: number
  last: number
  lastAt: number
}

const loopLag: LoopLagState = createLoopLagState()

function createLoopLagState(): LoopLagState {
  return {
    at: new Float64Array(LOOP_LAG_CAPACITY),
    lag: new Float64Array(LOOP_LAG_CAPACITY),
    length: 0,
    next: 0,
    maxSinceStart: 0,
    last: 0,
    lastAt: 0,
  }
}

/**
 * Records one lag sample taken at `at` (epoch ms). The gauge calls this on every tick; tests call
 * it directly to drive the window math with chosen timestamps.
 */
export function recordLoopLag(lagMs: number, at: number = Date.now()): void {
  const value = lagMs < 0 ? 0 : lagMs
  loopLag.at[loopLag.next] = at
  loopLag.lag[loopLag.next] = value
  loopLag.next = (loopLag.next + 1) % LOOP_LAG_CAPACITY
  if (loopLag.length < LOOP_LAG_CAPACITY) loopLag.length += 1
  if (value > loopLag.maxSinceStart) loopLag.maxSinceStart = value
  loopLag.last = value
  loopLag.lastAt = at
}

/** The lag distribution over the window `(now - LOOP_LAG_WINDOW_MS, now]` (epoch ms). */
export function loopLagSnapshot(now: number = Date.now()): LoopLagSnapshot {
  const since = now - LOOP_LAG_WINDOW_MS
  const inWindow: number[] = []
  for (let index = 0; index < loopLag.length; index += 1) {
    if (loopLag.at[index]! > since && loopLag.at[index]! <= now) inWindow.push(loopLag.lag[index]!)
  }
  inWindow.sort((a, b) => a - b)
  return {
    intervalMs: LOOP_LAG_INTERVAL_MS,
    windowMs: LOOP_LAG_WINDOW_MS,
    samples: inWindow.length,
    p50: tenths(percentile(inWindow, 0.5)),
    p95: tenths(percentile(inWindow, 0.95)),
    max: tenths(inWindow.length ? inWindow[inWindow.length - 1]! : 0),
    maxSinceStart: tenths(loopLag.maxSinceStart),
    last: tenths(loopLag.last),
    lastAt: loopLag.lastAt,
  }
}

/** Lag comes from `performance.now()` with sub-microsecond noise; a tenth of a millisecond reads. */
function tenths(value: number): number {
  return Math.round(value * 10) / 10
}

export type LoopLagHealth = {ok: true; p95: number} | {ok: false; reason: 'loop-lag'; p95: number}

/**
 * The health rule: unhealthy while the p95 lag over the last minute exceeds
 * {@link LOOP_LAG_UNHEALTHY_P95_MS}. A single long stall does not trip it (one sample out of six
 * hundred is not the 95th percentile); a loop that stays busy for a minute does. With no samples
 * (gauge not started, as in tests and one-shot commands) the server is healthy.
 */
export function loopLagHealth(now: number = Date.now()): LoopLagHealth {
  const {p95} = loopLagSnapshot(now)
  return p95 > LOOP_LAG_UNHEALTHY_P95_MS ? {ok: false, reason: 'loop-lag', p95} : {ok: true, p95}
}

let loopLagTimer: ReturnType<typeof setInterval> | undefined

/**
 * Starts the lag gauge: a timer every {@link LOOP_LAG_INTERVAL_MS} that records how late it fired.
 * Lag is measured against the previous tick, not the scheduled time, so a sequence of late ticks
 * attributes each delay once. The timer is unref'd and never keeps the process alive. Returns the
 * function that stops it; starting twice stops the earlier gauge first.
 */
export function startLoopLagGauge(intervalMs: number = LOOP_LAG_INTERVAL_MS): () => void {
  stopLoopLagGauge()
  let previous = performance.now()
  const timer = setInterval(() => {
    const now = performance.now()
    recordLoopLag(now - previous - intervalMs)
    previous = now
  }, intervalMs)
  timer.unref?.()
  loopLagTimer = timer
  return stopLoopLagGauge
}

/** Stops the lag gauge if one is running. Recorded samples stay in the window. */
export function stopLoopLagGauge(): void {
  if (loopLagTimer !== undefined) clearInterval(loopLagTimer)
  loopLagTimer = undefined
}

/** Drops all recorded metrics. Tests only — production stats live for the process lifetime. */
export function resetPerfForTests(): void {
  metrics.clear()
  counters.clear()
  stopLoopLagGauge()
  Object.assign(loopLag, createLoopLagState())
}
