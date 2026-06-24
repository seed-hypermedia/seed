/**
 * A self-healing recurring task runner.
 *
 * Replaces the fragile "self-rescheduling setTimeout" pattern where the next run is only scheduled
 * inside the previous run's `.finally()` — there, a single run that never settles (e.g. a fetch with
 * no timeout) permanently wedges the loop. {@link PollLoop} instead ticks on a fixed `setInterval`, so
 * future ticks are scheduled independently of any in-flight run, and:
 *
 *  - overlap-guards: a tick is skipped while the previous run is still in progress (no concurrent runs),
 *  - bounds each run with `timeoutMs`: even a stuck run releases the guard so the next tick proceeds.
 *
 * Together these guarantee the loop keeps making progress no matter how a single run misbehaves.
 */
export class PollLoop {
  readonly #run: () => Promise<void>
  readonly #intervalMs: number
  readonly #timeoutMs: number
  readonly #label: string
  #interval: ReturnType<typeof setInterval> | null = null
  #running = false
  #stopped = true

  constructor(opts: {label: string; intervalMs: number; timeoutMs: number; run: () => Promise<void>}) {
    this.#label = opts.label
    this.#intervalMs = opts.intervalMs
    this.#timeoutMs = opts.timeoutMs
    this.#run = opts.run
  }

  /** Starts ticking immediately and then every `intervalMs` until {@link stop} is called. */
  start(): void {
    if (!this.#stopped) return
    this.#stopped = false
    void this.#tick()
    this.#interval = setInterval(() => void this.#tick(), this.#intervalMs)
  }

  /** Stops future ticks. An in-flight run is allowed to finish. */
  stop(): void {
    this.#stopped = true
    if (this.#interval) clearInterval(this.#interval)
    this.#interval = null
  }

  async #tick(): Promise<void> {
    if (this.#running || this.#stopped) return
    this.#running = true
    try {
      await withTimeout(this.#run(), this.#timeoutMs, this.#label)
    } catch (error) {
      console.error(`[${this.#label}] poll tick failed`, error instanceof Error ? error.message : String(error))
    } finally {
      this.#running = false
    }
  }
}

/**
 * Resolves/rejects with `promise`, or rejects after `ms` if it has not settled — whichever is first.
 * The losing `promise` keeps running; a noop catch is attached so a late rejection after a timeout does
 * not surface as an unhandled rejection. Callers that need the underlying work to actually stop on
 * timeout must pass their own cancellation (e.g. an AbortSignal to fetch).
 */
export async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  promise.catch(() => {})
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
