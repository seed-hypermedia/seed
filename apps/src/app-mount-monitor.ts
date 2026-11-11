import type * as apisvc from '@/api-service'
import {PollLoop} from '@/poll-loop'

/** Options for the background pass over app mount documents. */
export type AppMountMonitorOptions = {
  pollIntervalMs: number
  /** Safety-net timeout for a whole pass, enforced by {@link PollLoop}. Default two minutes. */
  pollTimeoutMs?: number
}

const DEFAULT_POLL_TIMEOUT_MS = 120_000

/**
 * Looks for app mount documents on a timer and keeps this server's mounts in line with them (see
 * app-mounts.ts). A mount without a pinned version follows its app's latest, so the pass also picks up a newly
 * published version of an app. The first pass runs at start, so a server offers its mounted apps
 * as soon as it has read them.
 */
export class AppMountMonitor {
  readonly #loop: PollLoop

  constructor(service: apisvc.Service, options: AppMountMonitorOptions) {
    this.#loop = new PollLoop({
      label: 'Agents Apps',
      intervalMs: options.pollIntervalMs,
      timeoutMs: options.pollTimeoutMs ?? DEFAULT_POLL_TIMEOUT_MS,
      run: (signal) => service.refreshAppMounts({signal}),
    })
  }

  /** Starts polling until `stop()` is called. */
  start(): void {
    this.#loop.start()
  }

  /** Stops future passes. An in-flight pass is allowed to finish. */
  stop(): void {
    this.#loop.stop()
  }
}
