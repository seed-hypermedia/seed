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
 * - `provider.ttft.<provider>.<model>` / `provider.turn.<provider>.<model>` — the provider spans
 *   tagged by provider+model, so one slow model is visible next to the blend
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
 * - `exec.pool_hit` / `exec.pool_miss` / `exec.pool_overflow` — warm-pool acquisition outcomes.
 * - `exec.pool_reset_exhausted` / `exec.pool_reset_error` / `exec.pool_probe_failed` — why a
 *   pooled VM was disposed: its park reset ran out of pass budget (the guest's own verdict), the
 *   reset exchange broke, or the reuse probe failed.
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
  return {since: startedAt, metrics: out, counters: countersOut}
}

/** Drops all recorded metrics. Tests only — production stats live for the process lifetime. */
export function resetPerfForTests(): void {
  metrics.clear()
  counters.clear()
}
