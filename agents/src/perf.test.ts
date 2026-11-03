import {describe, expect, test, beforeEach} from 'bun:test'
import {
  LOOP_LAG_INTERVAL_MS,
  LOOP_LAG_UNHEALTHY_P95_MS,
  LOOP_LAG_WINDOW_MS,
  PERF_WINDOW_SIZE,
  loopLagHealth,
  loopLagSnapshot,
  perfSnapshot,
  providerErrorReason,
  recordLoopLag,
  recordPerf,
  recordPerfCount,
  resetPerfForTests,
  startLoopLagGauge,
  startPerfSpan,
  stopLoopLagGauge,
} from '@/perf'

describe('perf', () => {
  beforeEach(() => {
    resetPerfForTests()
  })

  test('records lifetime aggregates and window percentiles', () => {
    for (const value of [10, 20, 30, 40, 100]) recordPerf('exec.boot', value)
    const snapshot = perfSnapshot().metrics['exec.boot']!
    expect(snapshot.count).toBe(5)
    expect(snapshot.min).toBe(10)
    expect(snapshot.max).toBe(100)
    expect(snapshot.mean).toBe(40)
    expect(snapshot.p50).toBe(30)
    expect(snapshot.p95).toBe(100)
    expect(snapshot.last).toBe(100)
    expect(snapshot.lastAt).toBeGreaterThan(0)
  })

  test('clamps negative durations to zero', () => {
    recordPerf('provider.ttft', -50)
    expect(perfSnapshot().metrics['provider.ttft']!.min).toBe(0)
  })

  test('window is bounded while lifetime count keeps growing', () => {
    for (let index = 0; index < PERF_WINDOW_SIZE + 50; index += 1) recordPerf('tool.read', index)
    const snapshot = perfSnapshot().metrics['tool.read']!
    expect(snapshot.count).toBe(PERF_WINDOW_SIZE + 50)
    // The oldest 50 samples fell off, so the window's median reflects only recent values.
    expect(snapshot.p50).toBeGreaterThanOrEqual(50)
    expect(snapshot.min).toBe(0)
  })

  test('span records once even when ended twice', () => {
    const end = startPerfSpan('exec.total')
    end()
    end()
    expect(perfSnapshot().metrics['exec.total']!.count).toBe(1)
  })

  test('snapshot lists metrics alphabetically', () => {
    recordPerf('z.metric', 1)
    recordPerf('a.metric', 1)
    expect(Object.keys(perfSnapshot().metrics)).toEqual(['a.metric', 'z.metric'])
  })

  test('counters accumulate occurrences separately from duration metrics', () => {
    recordPerfCount('provider.error.anthropic.claude-x.overloaded')
    recordPerfCount('provider.error.anthropic.claude-x.overloaded')
    const snapshot = perfSnapshot()
    expect(snapshot.counters['provider.error.anthropic.claude-x.overloaded']!.count).toBe(2)
    expect(snapshot.counters['provider.error.anthropic.claude-x.overloaded']!.lastAt).toBeGreaterThan(0)
    expect(snapshot.metrics['provider.error.anthropic.claude-x.overloaded']).toBeUndefined()
  })

  test('provider error reasons normalize to the bounded set', () => {
    expect(providerErrorReason('Overloaded')).toBe('overloaded')
    expect(providerErrorReason('HTTP 529: server overloaded')).toBe('overloaded')
    expect(providerErrorReason('429 Too Many Requests')).toBe('rate_limited')
    expect(providerErrorReason('rate limit exceeded, retry later')).toBe('rate_limited')
    expect(providerErrorReason('request timed out after 60s')).toBe('timeout')
    expect(providerErrorReason('fetch failed: ETIMEDOUT')).toBe('timeout')
    expect(providerErrorReason('invalid api key')).toBe('other')
    expect(providerErrorReason(undefined)).toBe('other')
  })

  describe('loop lag', () => {
    const now = 1_700_000_000_000

    test('empty gauge reports zeros and is healthy', () => {
      const lag = loopLagSnapshot(now)
      expect(lag).toEqual({
        intervalMs: LOOP_LAG_INTERVAL_MS,
        windowMs: LOOP_LAG_WINDOW_MS,
        samples: 0,
        p50: 0,
        p95: 0,
        max: 0,
        maxSinceStart: 0,
        last: 0,
        lastAt: 0,
      })
      expect(loopLagHealth(now)).toEqual({ok: true, p95: 0})
      expect(perfSnapshot().loop.lag.samples).toBe(0)
    })

    test('percentiles and max cover only the last minute; maxSinceStart keeps the lifetime peak', () => {
      // A 9 s stall 90 s ago: outside the window, but still the lifetime maximum.
      recordLoopLag(9_000, now - 90_000)
      for (let index = 0; index < 100; index += 1) recordLoopLag(index, now - 50_000 + index * 100)
      const lag = loopLagSnapshot(now)
      expect(lag.samples).toBe(100)
      expect(lag.p50).toBe(49)
      expect(lag.p95).toBe(94)
      expect(lag.max).toBe(99)
      expect(lag.maxSinceStart).toBe(9_000)
      expect(lag.last).toBe(99)
      expect(lag.lastAt).toBe(now - 50_000 + 99 * 100)
    })

    test('the ring overwrites in place without losing the window', () => {
      // Three minutes of ticks at the real interval: far more than the ring holds.
      const ticks = (3 * LOOP_LAG_WINDOW_MS) / LOOP_LAG_INTERVAL_MS
      for (let index = 0; index < ticks; index += 1) {
        recordLoopLag(index % 7, now - 3 * LOOP_LAG_WINDOW_MS + (index + 1) * LOOP_LAG_INTERVAL_MS)
      }
      const lag = loopLagSnapshot(now)
      expect(lag.samples).toBe(LOOP_LAG_WINDOW_MS / LOOP_LAG_INTERVAL_MS)
      expect(lag.max).toBe(6)
    })

    test('one long stall does not trip the health rule; a busy minute does', () => {
      for (let index = 0; index < 599; index += 1) recordLoopLag(1, now - 59_900 + index * 100)
      recordLoopLag(28_000, now)
      expect(loopLagSnapshot(now).max).toBe(28_000)
      expect(loopLagHealth(now)).toEqual({ok: true, p95: 1})

      resetPerfForTests()
      // Every tick over the last minute fired 400 ms late: the server is stalled, not spiking.
      for (let index = 0; index < 120; index += 1) recordLoopLag(400, now - 59_000 + index * 500)
      expect(loopLagHealth(now)).toEqual({ok: false, reason: 'loop-lag', p95: 400})

      resetPerfForTests()
      for (let index = 0; index < 120; index += 1) {
        recordLoopLag(LOOP_LAG_UNHEALTHY_P95_MS, now - 59_000 + index * 500)
      }
      // Exactly at the threshold is still healthy; the rule is "exceeds".
      expect(loopLagHealth(now).ok).toBe(true)
    })

    test('negative lag (a timer firing early) is clamped to zero', () => {
      recordLoopLag(-5, now)
      expect(loopLagSnapshot(now).max).toBe(0)
    })

    test('the running gauge sees a synchronous stall of the loop', async () => {
      startLoopLagGauge(10)
      try {
        await new Promise((resolve) => setTimeout(resolve, 30))
        const stallUntil = performance.now() + 80
        while (performance.now() < stallUntil) {
          // Hold the thread, as a long statement or a big CBOR encode would.
        }
        await new Promise((resolve) => setTimeout(resolve, 30))
        const lag = loopLagSnapshot()
        expect(lag.samples).toBeGreaterThan(0)
        expect(lag.max).toBeGreaterThanOrEqual(60)
        expect(lag.maxSinceStart).toBe(lag.max)
      } finally {
        stopLoopLagGauge()
      }
      const samples = loopLagSnapshot().samples
      await new Promise((resolve) => setTimeout(resolve, 40))
      expect(loopLagSnapshot().samples).toBe(samples)
    })
  })
})
