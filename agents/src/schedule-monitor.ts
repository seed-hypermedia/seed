import type * as apisvc from '@/api-service'

/** Options for the background schedule trigger monitor. */
export type ScheduleMonitorOptions = {
  pollIntervalMs: number
}

/** Polls saved schedule triggers and asks the agent service to fire due occurrences. */
export class ScheduleMonitor {
  readonly #service: apisvc.Service
  readonly #options: ScheduleMonitorOptions
  #timer: ReturnType<typeof setTimeout> | null = null
  #running = false
  #stopped = true

  constructor(service: apisvc.Service, options: ScheduleMonitorOptions) {
    this.#service = service
    this.#options = options
  }

  /** Starts polling until `stop()` is called. */
  start(): void {
    if (!this.#stopped) return
    this.#stopped = false
    this.#schedule(0)
  }

  /** Stops future polls. An in-flight poll is allowed to finish. */
  stop(): void {
    this.#stopped = true
    if (this.#timer) clearTimeout(this.#timer)
    this.#timer = null
  }

  /** Runs one polling cycle for due schedule triggers. */
  async pollOnce(): Promise<void> {
    if (this.#running) return
    this.#running = true
    try {
      await this.#service.processScheduledTriggers(Date.now())
    } finally {
      this.#running = false
    }
  }

  #schedule(delayMs: number): void {
    if (this.#stopped) return
    this.#timer = setTimeout(() => {
      void this.pollOnce().finally(() => this.#schedule(this.#options.pollIntervalMs))
    }, delayMs)
  }
}
