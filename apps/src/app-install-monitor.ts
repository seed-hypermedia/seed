import type * as apisvc from '@/api-service'
import {PollLoop} from '@/poll-loop'

/** Options for the background pass over app install pages. */
export type AppInstallMonitorOptions = {
  pollIntervalMs: number
  /** Safety-net timeout for a whole pass, enforced by {@link PollLoop}. Default two minutes. */
  pollTimeoutMs?: number
}

const DEFAULT_POLL_TIMEOUT_MS = 120_000

/**
 * Looks for app install pages on a timer and keeps this server's installs in line with them (see
 * app-installs.ts). An install without a pinned version follows its app's latest, so the pass also picks up a newly
 * published version of an app. The first pass runs at start, so a server offers its installed apps
 * as soon as it has read them.
 */
export class AppInstallMonitor {
  readonly #loop: PollLoop

  constructor(service: apisvc.Service, options: AppInstallMonitorOptions) {
    this.#loop = new PollLoop({
      label: 'Agents Apps',
      intervalMs: options.pollIntervalMs,
      timeoutMs: options.pollTimeoutMs ?? DEFAULT_POLL_TIMEOUT_MS,
      run: (signal) => service.refreshAppInstalls({signal}),
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
