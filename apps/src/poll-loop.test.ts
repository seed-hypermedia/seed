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

  test('aborts the run signal when a run exceeds the timeout', async () => {
    let aborted = false
    const loop = new PollLoop({
      label: 'test',
      intervalMs: 1000,
      timeoutMs: 25,
      run: async (signal) => {
        signal.addEventListener('abort', () => void (aborted = true))
        await new Promise(() => {}) // never settles on its own
      },
    })
    loop.start()
    await sleep(80)
    loop.stop()
    expect(aborted).toBe(true)
  })

  test('a slow upstream cannot stack unbounded concurrent runs', async () => {
    // Regression: releasing the overlap guard on timeout WITHOUT cancelling the run let every tick add
    // another still-running cycle, once per timeoutMs, until the event loop was saturated and the process
    // stopped serving. A run that honours its signal must never leave more than one cycle in flight.
    let inFlight = 0
    let maxInFlight = 0
    let starts = 0
    const loop = new PollLoop({
      label: 'test',
      intervalMs: 5,
      timeoutMs: 15,
      run: async (signal) => {
        starts += 1
        inFlight += 1
        maxInFlight = Math.max(maxInFlight, inFlight)
        // A well-behaved run: slower than the timeout, but it stops when told to.
        await new Promise<void>((resolve) => {
          if (signal.aborted) return resolve()
          signal.addEventListener('abort', () => resolve(), {once: true})
        })
        inFlight -= 1
      },
    })
    loop.start()
    await sleep(120)
    loop.stop()
    await sleep(20)
    expect(starts).toBeGreaterThanOrEqual(3) // loop kept making progress
    expect(maxInFlight).toBe(1) // and never piled up
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

  test('invokes onTimeout before rejecting so callers can cancel the work', async () => {
    let cancelled = false
    await expect(withTimeout(new Promise(() => {}), 20, 'slow-op', () => void (cancelled = true))).rejects.toThrow(
      'slow-op timed out after 20ms',
    )
    expect(cancelled).toBe(true)
  })

  test('does not invoke onTimeout when the promise settles in time', async () => {
    let cancelled = false
    expect(await withTimeout(Promise.resolve('ok'), 1000, 'test', () => void (cancelled = true))).toBe('ok')
    await sleep(30)
    expect(cancelled).toBe(false)
  })
})
