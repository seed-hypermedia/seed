import {describe, expect, test, beforeEach} from 'bun:test'
import {PERF_WINDOW_SIZE, perfSnapshot, recordPerf, resetPerfForTests, startPerfSpan} from '@/perf'

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
})
