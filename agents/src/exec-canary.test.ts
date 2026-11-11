import {beforeEach, describe, expect, test} from 'bun:test'
import type {CodeExecProbeResult} from '@/code-exec'
import {ExecCanary} from '@/exec-canary'
import {renderMetrics} from '@/metrics'
import {perfSnapshot, recordPerf, recordPerfCount, resetPerfForTests} from '@/perf'

beforeEach(() => resetPerfForTests())

/** A canary whose probe answers from a script of results. */
function scriptedCanary(results: CodeExecProbeResult[], intervalMs = 0): ExecCanary {
  return new ExecCanary({probe: async () => results.shift()!, intervalMs})
}

describe('exec canary', () => {
  test('tracks consecutive failures and the last success, and counts each outcome', async () => {
    const canary = scriptedCanary([
      {ok: true, bootMs: 300, durationMs: 400},
      {ok: false, bootMs: 0, durationMs: 50, error: 'SIGABRT'},
      {ok: false, bootMs: 0, durationMs: 60, error: 'SIGABRT'},
      {ok: true, bootMs: 310, durationMs: 420},
    ])
    await canary.runOnce()
    const firstSuccess = canary.status().lastSuccessAt
    expect(firstSuccess).not.toBeNull()

    await canary.runOnce()
    await canary.runOnce()
    expect(canary.status()).toMatchObject({lastOk: false, consecutiveFailures: 2, lastError: 'SIGABRT'})
    expect(canary.status().lastSuccessAt).toBe(firstSuccess)

    await canary.runOnce()
    expect(canary.status()).toMatchObject({lastOk: true, consecutiveFailures: 0, lastError: null, lastBootMs: 310})
    const counters = perfSnapshot().counters
    expect(counters['exec.canary_ok']?.count).toBe(2)
    expect(counters['exec.canary_failed']?.count).toBe(2)
  })

  test('a probe that never answers counts as a failure', async () => {
    const canary = new ExecCanary({probe: () => new Promise(() => {}), intervalMs: 0})
    const originalSetTimeout = globalThis.setTimeout
    // Fire the canary's own deadline immediately instead of waiting two minutes.
    globalThis.setTimeout = ((fn: () => void) => originalSetTimeout(fn, 0)) as typeof setTimeout
    try {
      const result = await canary.runOnce()
      expect(result.ok).toBe(false)
      expect(result.error).toContain('timed out')
    } finally {
      globalThis.setTimeout = originalSetTimeout
    }
  })

  test('is disabled at interval 0', () => {
    const canary = scriptedCanary([], 0)
    canary.start()
    expect(canary.status().enabled).toBe(false)
    canary.stop()
  })
})

describe('metrics exposition', () => {
  test('renders counters, spans, loop lag and the canary in Prometheus text format', async () => {
    recordPerfCount('exec.boot_failed')
    recordPerfCount('exec.boot_failed')
    recordPerfCount('run.failed')
    recordPerf('exec.boot', 900)
    const canary = scriptedCanary([{ok: false, bootMs: 0, durationMs: 1500, error: 'SIGABRT'}], 300_000)
    await canary.runOnce()

    const text = renderMetrics({
      perf: perfSnapshot(),
      canary: canary.status(),
      build: {version: '2026.11.1', protocol: 3},
      uptimeSeconds: 42,
    })
    const lines = text.split('\n')
    expect(lines).toContain('seed_agents_info{version="2026.11.1",protocol="3"} 1')
    expect(lines).toContain('seed_agents_uptime_seconds 42')
    expect(lines).toContain('seed_agents_events_total{event="exec.boot_failed"} 2')
    expect(lines).toContain('seed_agents_events_total{event="run.failed"} 1')
    expect(lines).toContain('seed_agents_span_total{span="exec.boot"} 1')
    expect(lines).toContain('seed_agents_span_p95_milliseconds{span="exec.boot"} 900')
    expect(lines).toContain('seed_agents_exec_canary_enabled 1')
    expect(lines).toContain('seed_agents_exec_canary_up 0')
    expect(lines).toContain('seed_agents_exec_canary_consecutive_failures 1')
    expect(lines).toContain('seed_agents_exec_canary_last_success_timestamp_seconds 0')
    expect(lines).toContain('seed_agents_exec_canary_duration_seconds 1.5')
    expect(lines).toContain('# TYPE seed_agents_events_total counter')
    expect(text.endsWith('\n')).toBe(true)
  })

  test('omits canary results before the first probe and escapes label values', () => {
    recordPerfCount('tool.error."quoted"\\name')
    const text = renderMetrics({
      perf: perfSnapshot(),
      canary: scriptedCanary([], 0).status(),
      build: {version: 'dev', protocol: 3},
      uptimeSeconds: 1,
    })
    expect(text).toContain('seed_agents_exec_canary_enabled 0')
    expect(text).not.toContain('seed_agents_exec_canary_up')
    expect(text).toContain('seed_agents_events_total{event="tool.error.\\"quoted\\"\\\\name"} 1')
  })
})
