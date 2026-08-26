import {State} from '@shm/shared/client/.generated/daemon/v1alpha/daemon_pb'
import {describe, expect, it, vi} from 'vitest'
import {waitForDaemonActive} from '../daemon-readiness'

describe('waitForDaemonActive', () => {
  it('keeps waiting past the normal startup timeout while migration is making progress', async () => {
    let now = 0
    const states = [
      {state: State.MIGRATING, tasks: [{completed: 1, total: 3}]},
      {state: State.MIGRATING, tasks: [{completed: 2, total: 3}]},
      {state: State.ACTIVE, tasks: []},
    ]
    const getInfo = vi.fn(async () => states.shift()!)

    await waitForDaemonActive({
      getInfo,
      onDaemonState: vi.fn(),
      retryDelayMs: 200,
      startupTimeoutMs: 1_000,
      migrationStallTimeoutMs: 10_000,
      now: () => now,
      sleep: async (delay) => {
        now += delay + 1_000
      },
    })

    expect(getInfo).toHaveBeenCalledTimes(3)
  })
})
