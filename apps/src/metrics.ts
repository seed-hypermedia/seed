/**
 * `GET /api/metrics`: the `/api/perf` snapshot and the exec canary in Prometheus text format, so
 * a collector (Grafana Alloy on the hosted server) can scrape it and alert rules can watch it.
 *
 * Same exposure class as `/api/perf`: metric names and aggregates only, never ids, accounts or
 * content. Every value is a counter or a gauge over the process lifetime; rates and ratios are the
 * alert rules' job.
 */
import type {ExecCanaryStatus} from '@/exec-canary'
import type {PerfSnapshot} from '@/perf'

export const METRICS_CONTENT_TYPE = 'text/plain; version=0.0.4; charset=utf-8'

export type MetricsInput = {
  perf: PerfSnapshot
  canary: ExecCanaryStatus
  build: {version: string; protocol: number | string}
  uptimeSeconds: number
}

/** Renders the exposition text. Series are emitted in a stable order so diffs stay readable. */
export function renderMetrics({perf, canary, build, uptimeSeconds}: MetricsInput): string {
  const out: string[] = []
  const family = (name: string, type: 'gauge' | 'counter', help: string, samples: [string, number][]) => {
    if (!samples.length) return
    out.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`)
    for (const [labels, value] of samples) out.push(`${name}${labels} ${formatValue(value)}`)
  }

  family('seed_agents_info', 'gauge', 'Build of this agents server.', [
    [labels({version: build.version, protocol: String(build.protocol)}), 1],
  ])
  family('seed_agents_uptime_seconds', 'gauge', 'Seconds since this process started.', [['', uptimeSeconds]])

  family(
    'seed_agents_events_total',
    'counter',
    'Occurrences of events with no duration (errors, retries, run outcomes, canary results), by name.',
    Object.entries(perf.counters).map(([event, {count}]) => [labels({event}), count]),
  )
  const spans = Object.entries(perf.metrics)
  family(
    'seed_agents_span_total',
    'counter',
    'Completed spans by name (see apps/src/perf.ts for the names).',
    spans.map(([span, m]) => [labels({span}), m.count]),
  )
  family(
    'seed_agents_span_p95_milliseconds',
    'gauge',
    'p95 duration over the most recent samples of each span.',
    spans.map(([span, m]) => [labels({span}), m.p95]),
  )

  const lag = perf.loop.lag
  family('seed_agents_loop_lag_p95_milliseconds', 'gauge', 'Event-loop lag p95 over the last minute.', [['', lag.p95]])
  family('seed_agents_loop_lag_max_milliseconds', 'gauge', 'Event-loop lag maximum over the last minute.', [
    ['', lag.max],
  ])

  family('seed_agents_exec_canary_enabled', 'gauge', 'Whether the exec canary runs on this server.', [
    ['', canary.enabled ? 1 : 0],
  ])
  if (canary.lastRunAt !== null) {
    family('seed_agents_exec_canary_up', 'gauge', 'Whether the last canary probe booted a sandbox and ran code.', [
      ['', canary.lastOk ? 1 : 0],
    ])
    family('seed_agents_exec_canary_last_run_timestamp_seconds', 'gauge', 'When the last canary probe finished.', [
      ['', canary.lastRunAt / 1000],
    ])
    family(
      'seed_agents_exec_canary_last_success_timestamp_seconds',
      'gauge',
      'When a canary probe last succeeded; 0 if none has this process lifetime.',
      [['', (canary.lastSuccessAt ?? 0) / 1000]],
    )
    family(
      'seed_agents_exec_canary_consecutive_failures',
      'gauge',
      'Canary probes failed in a row since the last success.',
      [['', canary.consecutiveFailures]],
    )
    family('seed_agents_exec_canary_duration_seconds', 'gauge', 'Boot, run and teardown time of the last probe.', [
      ['', (canary.lastDurationMs ?? 0) / 1000],
    ])
  }
  return out.join('\n') + '\n'
}

function labels(values: Record<string, string>): string {
  const parts = Object.entries(values).map(([key, value]) => `${key}="${escapeLabel(value)}"`)
  return `{${parts.join(',')}}`
}

function escapeLabel(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"')
}

function formatValue(value: number): string {
  return Number.isFinite(value) ? String(value) : 'NaN'
}
