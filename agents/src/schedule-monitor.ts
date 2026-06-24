import type * as apisvc from '@/api-service'
import {PollLoop} from '@/poll-loop'

/** Options for the background schedule trigger monitor. */
export type ScheduleMonitorOptions = {
  pollIntervalMs: number
  /** Safety-net timeout for a whole poll cycle, enforced by {@link PollLoop}. Default 60s. */
  pollTimeoutMs?: number
}

const DEFAULT_POLL_TIMEOUT_MS = 60_000

/** Polls saved schedule triggers and asks the agent service to fire due occurrences. */
export class ScheduleMonitor {
  readonly #service: apisvc.Service
  readonly #loop: PollLoop

  constructor(service: apisvc.Service, options: ScheduleMonitorOptions) {
    this.#service = service
    this.#loop = new PollLoop({
      label: 'Agents Schedule',
      intervalMs: options.pollIntervalMs,
      timeoutMs: options.pollTimeoutMs ?? DEFAULT_POLL_TIMEOUT_MS,
      run: () => this.pollOnce(),
    })
  }

  /** Starts polling until `stop()` is called. */
  start(): void {
    this.#loop.start()
  }

  /** Stops future polls. An in-flight poll is allowed to finish. */
  stop(): void {
    this.#loop.stop()
  }

  /** Runs one polling cycle for due schedule triggers. */
  async pollOnce(): Promise<void> {
    await this.#service.processScheduledTriggers(Date.now())
  }
}
