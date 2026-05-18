import {hmId} from '@shm/shared/utils/entity-id-url'
import {afterEach, describe, expect, it, vi} from 'vitest'

vi.mock('@/grpc-client', () => ({
  grpcClient: {
    telemetry: {
      recordCheckpoints: vi.fn().mockResolvedValue({}),
    },
  },
}))

import {createTelemetryReporter, telemetryKeyForId, telemetryKeyForRoute, TelemetryStage} from '../telemetry'

describe('desktop telemetry', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('builds document correlation keys without route UI state', () => {
    const id = hmId('acc', {path: ['docs', 'intro'], version: 'cid1', latest: true, blockRef: 'block-a'})

    expect(telemetryKeyForId(id)).toBe('hm://acc/docs/intro?v=cid1')
    expect(telemetryKeyForRoute({key: 'document', id, panel: {key: 'comments', id, openComment: 'c1'}})).toBe(
      'hm://acc/docs/intro?v=cid1',
    )
    expect(telemetryKeyForRoute({key: 'profile', id: hmId('bob'), tab: 'profile'})).toBe('hm://bob')
    expect(telemetryKeyForRoute({key: 'settings'})).toBeNull()
  })

  it('debounces checkpoints into a single batch', async () => {
    vi.useFakeTimers()
    const recordCheckpoints = vi.fn().mockResolvedValue({})
    const reporter = createTelemetryReporter({
      client: {telemetry: {recordCheckpoints}} as any,
      source: 'renderer:test',
      nowNanos: vi.fn().mockReturnValueOnce(BigInt(10)).mockReturnValueOnce(BigInt(20)),
    })

    reporter.report('hm://acc/a?v=c1', TelemetryStage.LinkClick)
    reporter.report('hm://acc/a?v=c1', TelemetryStage.ComponentRendered)

    expect(recordCheckpoints).not.toHaveBeenCalled()
    vi.advanceTimersByTime(399)
    await Promise.resolve()
    expect(recordCheckpoints).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    await Promise.resolve()

    expect(recordCheckpoints).toHaveBeenCalledTimes(1)
    expect(recordCheckpoints).toHaveBeenCalledWith({
      source: 'renderer:test',
      checkpoints: [
        {key: 'hm://acc/a?v=c1', stage: 'renderer.link_click', tsUnixNanos: BigInt(10)},
        {key: 'hm://acc/a?v=c1', stage: 'renderer.component_rendered', tsUnixNanos: BigInt(20)},
      ],
    })
  })

  it('flushes safely when the telemetry RPC fails', async () => {
    vi.useFakeTimers()
    const onError = vi.fn()
    const reporter = createTelemetryReporter({
      client: {telemetry: {recordCheckpoints: vi.fn().mockRejectedValue(new Error('offline'))}} as any,
      source: 'renderer:test',
      nowNanos: () => BigInt(1),
      onError,
    })

    reporter.report('hm://acc/a?v=c1', TelemetryStage.LinkClick)
    await expect(reporter.flush()).resolves.toBeUndefined()

    expect(onError).toHaveBeenCalledTimes(1)
    expect(reporter.pendingCount()).toBe(0)
  })
})
