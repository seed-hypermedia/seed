import {describe, expect, test} from 'bun:test'
import {PollLoop, withTimeout} from '@/poll-loop'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('PollLoop', () => {
  test('ticks repeatedly on the interval', async () => {
    let runs = 0
    const loop = new PollLoop({label: 'test', intervalMs: 20, timeoutMs: 1000, run: async () => void runs++})
    loop.start()
    await sleep(120)
    loop.stop()
    const afterStop = runs
    expect(afterStop).toBeGreaterThanOrEqual(3)
    await sleep(60)
    expect(runs).toBe(afterStop) // no further ticks after stop()
  })

  test('never overlaps runs (overlap guard)', async () => {
    let concurrent = 0
    let maxConcurrent = 0
    const loop = new PollLoop({
      label: 'test',
      intervalMs: 10,
      timeoutMs: 1000,
      run: async () => {
        concurrent += 1
        maxConcurrent = Math.max(maxConcurrent, concurrent)
        await sleep(50)
        concurrent -= 1
      },
    })
    loop.start()
    await sleep(200)
    loop.stop()
    expect(maxConcurrent).toBe(1)
  })

  test('recovers after a run that hangs forever (timeout releases the guard)', async () => {
    let started = 0
    const loop = new PollLoop({
      label: 'test',
      intervalMs: 15,
      timeoutMs: 30,
      run: async () => {
        started += 1
        if (started === 1) await new Promise(() => {}) // first run never settles
      },
    })
    loop.start()
    await sleep(200)
    loop.stop()
    // Without self-healing, a forever-hung first run would wedge the loop at started === 1.
    expect(started).toBeGreaterThanOrEqual(3)
  })

  test('keeps ticking after a run throws', async () => {
    let runs = 0
    const loop = new PollLoop({
      label: 'test',
      intervalMs: 15,
      timeoutMs: 1000,
      run: async () => {
        runs += 1
        if (runs === 1) throw new Error('boom')
      },
    })
    loop.start()
    await sleep(120)
    loop.stop()
    expect(runs).toBeGreaterThanOrEqual(3)
  })
})

describe('withTimeout', () => {
  test('resolves when the promise settles in time', async () => {
    expect(await withTimeout(Promise.resolve('ok'), 1000, 'test')).toBe('ok')
  })

  test('rejects after the timeout when the promise hangs', async () => {
    await expect(withTimeout(new Promise(() => {}), 20, 'slow-op')).rejects.toThrow('slow-op timed out after 20ms')
  })
})
