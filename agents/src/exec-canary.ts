/**
 * The exec canary: on a timer, boot a brand-new sandbox, run one command, tear it down.
 *
 * Code execution can break while every other signal stays green. On 2026-11-07 msb 0.6.8 started
 * aborting every new microVM (its 65,536th sandbox id overflowed a 16-bit network slot), and for 55
 * hours every `execute` and lambda tool failed while `/api/health` answered 200 and the containers
 * reported healthy. Nothing exercised a cold boot unless a person or a trigger happened to.
 *
 * The canary is that exercise. Its result is served at `/api/metrics` (what alerting scrapes) and
 * summarized in `/api/health`. It deliberately does not turn health 503: a restart does not fix a
 * broken sandbox runtime, so failing health would only add a restart loop to the outage.
 */
import type {CodeExecProbeResult} from '@/code-exec'
import {recordPerf, recordPerfCount} from '@/perf'
import {PollLoop} from '@/poll-loop'

/** A probe that takes longer than this is counted as failed; a wedged boot must not hide. */
export const EXEC_CANARY_TIMEOUT_MS = 120_000

/** What the canary last saw. Timestamps are epoch milliseconds; null until the first probe. */
export type ExecCanaryStatus = {
  enabled: boolean
  intervalMs: number
  lastRunAt: number | null
  lastOk: boolean | null
  lastSuccessAt: number | null
  lastDurationMs: number | null
  lastBootMs: number | null
  lastError: string | null
  consecutiveFailures: number
}

/** Runs {@link probe} every `intervalMs` and keeps the latest outcome. */
export class ExecCanary {
  readonly #probe: () => Promise<CodeExecProbeResult>
  readonly #intervalMs: number
  readonly #loop: PollLoop | null
  #status: ExecCanaryStatus

  constructor(opts: {probe: () => Promise<CodeExecProbeResult>; intervalMs: number}) {
    this.#probe = opts.probe
    this.#intervalMs = opts.intervalMs
    this.#status = {
      enabled: opts.intervalMs > 0,
      intervalMs: opts.intervalMs,
      lastRunAt: null,
      lastOk: null,
      lastSuccessAt: null,
      lastDurationMs: null,
      lastBootMs: null,
      lastError: null,
      consecutiveFailures: 0,
    }
    this.#loop =
      opts.intervalMs > 0
        ? new PollLoop({
            label: 'Exec Canary',
            intervalMs: opts.intervalMs,
            timeoutMs: EXEC_CANARY_TIMEOUT_MS,
            run: () => this.runOnce().then(() => {}),
          })
        : null
  }

  /** Probes now and then every interval. A no-op when the canary is disabled. */
  start(): void {
    this.#loop?.start()
  }

  stop(): void {
    this.#loop?.stop()
  }

  status(): ExecCanaryStatus {
    return {...this.#status}
  }

  /** One probe, recorded. Exposed so tests and operators can run it without waiting a tick. */
  async runOnce(): Promise<CodeExecProbeResult> {
    const result = await withTimeout(this.#probe(), EXEC_CANARY_TIMEOUT_MS)
    const wasFailing = this.#status.consecutiveFailures > 0
    const now = Date.now()
    this.#status = {
      ...this.#status,
      lastRunAt: now,
      lastOk: result.ok,
      lastSuccessAt: result.ok ? now : this.#status.lastSuccessAt,
      lastDurationMs: result.durationMs,
      lastBootMs: result.bootMs,
      lastError: result.ok ? null : result.error ?? 'unknown error',
      consecutiveFailures: result.ok ? 0 : this.#status.consecutiveFailures + 1,
    }
    recordPerf('exec.canary', result.durationMs)
    recordPerfCount(result.ok ? 'exec.canary_ok' : 'exec.canary_failed')
    // Log transitions, not every tick: the first failure and the recovery are what an operator
    // reading the container log needs.
    if (!result.ok && !wasFailing) {
      console.warn('[Exec Canary] Sandbox probe failed', {error: result.error, durationMs: result.durationMs})
    } else if (result.ok && wasFailing) {
      console.log('[Exec Canary] Sandbox probe recovered', {bootMs: result.bootMs})
    }
    return result
  }
}

async function withTimeout(pending: Promise<CodeExecProbeResult>, ms: number): Promise<CodeExecProbeResult> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const startedAt = Date.now()
  const timeout = new Promise<CodeExecProbeResult>((resolve) => {
    timer = setTimeout(
      () => resolve({ok: false, bootMs: 0, durationMs: Date.now() - startedAt, error: `Probe timed out after ${ms}ms`}),
      ms,
    )
  })
  try {
    return await Promise.race([pending, timeout])
  } finally {
    clearTimeout(timer)
  }
}
