/**
 * A self-healing recurring task runner.
 *
 * Replaces the fragile "self-rescheduling setTimeout" pattern where the next run is only scheduled
 * inside the previous run's `.finally()` — there, a single run that never settles (e.g. a fetch with
 * no timeout) permanently wedges the loop. {@link PollLoop} instead ticks on a fixed `setInterval`, so
 * future ticks are scheduled independently of any in-flight run, and:
 *
 *  - overlap-guards: a tick is skipped while the previous run is still in progress (no concurrent runs),
 *  - bounds each run with `timeoutMs`, and **cancels it** by aborting the {@link AbortSignal} handed to
 *    `run` — so a timed-out run stops doing work instead of merely losing a race.
 *
 * Cancellation is what makes the overlap guard meaningful. Releasing the guard on timeout without
 * aborting the run lets a slow upstream stack a fresh run on top of every still-running one, once per
 * `timeoutMs`, forever: unbounded concurrent work on a single-threaded runtime, which saturates the
 * event loop until the process stops serving anything at all. `run` MUST honour the signal (thread it
 * into every `fetch`, and check `signal.aborted` between steps) for the bound to hold.
 */
export class PollLoop {
  readonly #run: (signal: AbortSignal) => Promise<void>
  readonly #intervalMs: number
  readonly #timeoutMs: number
  readonly #label: string
  #interval: ReturnType<typeof setInterval> | null = null
  #running = false
  #stopped = true

  constructor(opts: {
    label: string
    intervalMs: number
    timeoutMs: number
    run: (signal: AbortSignal) => Promise<void>
  }) {
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
    const controller = new AbortController()
    try {
      await withTimeout(this.#run(controller.signal), this.#timeoutMs, this.#label, () =>
        controller.abort(new Error(`${this.#label} poll cycle exceeded ${this.#timeoutMs}ms`)),
      )
    } catch (error) {
      console.error(`[${this.#label}] poll tick failed`, error instanceof Error ? error.message : String(error))
    } finally {
      // The run is cancelled either way: a timeout already aborted it above, and any other exit path
      // (success or throw) aborts here so nothing the run spawned outlives the tick that owns it.
      controller.abort(new Error(`${this.#label} poll cycle finished`))
      this.#running = false
    }
  }
}

/**
 * Resolves/rejects with `promise`, or rejects after `ms` if it has not settled — whichever is first,
 * invoking `onTimeout` before rejecting so the caller can cancel the underlying work.
 *
 * The losing `promise` keeps running as far as this helper is concerned — a noop catch is attached so a
 * late rejection after a timeout does not surface as an unhandled rejection. Actually stopping that work
 * is `onTimeout`'s job (e.g. aborting an {@link AbortController} threaded into every `fetch`); without it
 * a timeout only hides the run, it does not end it.
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
  onTimeout?: () => void,
): Promise<T> {
  promise.catch(() => {})
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      onTimeout?.()
      reject(new Error(`${label} timed out after ${ms}ms`))
    }, ms)
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
