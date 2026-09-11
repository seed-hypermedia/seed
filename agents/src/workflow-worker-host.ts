/**
 * Phase-1 proof of concept for worker-isolated run execution (see hypermedia/agent-worker-isolated-execution.md).
 *
 * Runs the QuickJS workflow VM in a dedicated Worker thread so its CPU-bound compute no longer
 * blocks the main event loop (the HTTP API and WebSocket broadcast). The worker executes the exact
 * same {@link runWorkflowVM} with a *proxy* WorkflowAdapters whose every effect is marshalled back
 * here; this side supplies the real adapters the service already builds. Nothing about the workflow
 * contract, journal format, or determinism changes — this is a transport, not a rewrite.
 *
 * The bridge:
 *  - async effects (callTool, awaitChild) → request/reply messages, awaited in the worker.
 *  - void effects (updatePlan, progress, registerEventWait) and journal appends → ordered fire-and-
 *    forget messages; message order guarantees they land before the terminal outcome message.
 *  - the one *synchronous-returning* effect (spawnAgent) → a synchronous round-trip via
 *    Atomics.wait on a SharedArrayBuffer, so the worker's pump gets its {childRunId} inline and the
 *    existing #spawnWorkflowChildAgent (which can throw) is reused unchanged.
 *  - isCanceled() and the fuel interrupt → a cancel byte in the SharedArrayBuffer, read inline.
 *
 * Gated by SEED_AGENTS_WORKFLOW_WORKER=1; off, the caller uses the in-process path unchanged.
 */
import {existsSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import type {WorkflowAdapters, WorkflowVMOutcome} from './workflow-host'

/**
 * Resolves the worker entry beside this module: `workflow-worker-entry.js` in the bundled build
 * (Bun.build emits it as a sibling of main.js), `.ts` from source in dev and tests.
 */
function workerEntryUrl(): URL {
  for (const ext of ['js', 'ts'] as const) {
    const url = new URL(`./workflow-worker-entry.${ext}`, import.meta.url)
    try {
      if (existsSync(fileURLToPath(url))) return url
    } catch {
      /* fall through */
    }
  }
  return new URL('./workflow-worker-entry.ts', import.meta.url)
}

/** Control SharedArrayBuffer layout (Int32 header + a data region for the sync-effect reply). */
const CTRL_CANCEL = 0 // 1 once the run is canceled; read by the worker's isCanceled/interrupt
const CTRL_SYNC_GEN = 1 // bumped by main to wake the worker's Atomics.wait after a sync effect
const CTRL_SYNC_LEN = 2 // byte length of the JSON reply in the data region
const CTRL_SYNC_OK = 3 // 1 = result, 0 = thrown error (encoded as {message, code})
const CTRL_HEADER_INT32S = 4
const CTRL_DATA_OFFSET = CTRL_HEADER_INT32S * 4
const CTRL_SAB_BYTES = 64 * 1024

type WorkerToHost =
  | {t: 'call'; id: number; op: 'callTool' | 'awaitChild'; args: unknown[]}
  | {t: 'void'; op: 'updatePlan' | 'progress' | 'registerEventWait'; args: unknown[]}
  | {t: 'sync'; op: 'spawnAgent'; args: unknown[]}
  | {t: 'journal'; entry: unknown}
  | {t: 'partial'; patch: unknown}
  | {t: 'outcome'; outcome: WorkflowVMOutcome}
  | {t: 'fail'; error: {message: string; stack?: string}}

/** Spawns the worker, wires the effect bridge to `adapters`, and resolves with the VM outcome. */
export function runWorkflowInWorker(
  adapters: WorkflowAdapters,
  opts: {onCancelCheck?: () => boolean; emitPartial?: (patch: unknown) => void} = {},
): Promise<WorkflowVMOutcome> {
  const sab = new SharedArrayBuffer(CTRL_SAB_BYTES)
  const ctrl = new Int32Array(sab)
  const data = new Uint8Array(sab, CTRL_DATA_OFFSET)

  const worker = new Worker(workerEntryUrl(), {type: 'module'})

  // Reflect cancellation into the SharedArrayBuffer so the worker's synchronous interrupt sees it.
  const cancelPoll = setInterval(() => {
    if ((opts.onCancelCheck ?? adapters.isCanceled)()) Atomics.store(ctrl, CTRL_CANCEL, 1)
  }, 50)
  ;(cancelPoll as {unref?: () => void}).unref?.()

  const replySync = (ok: boolean, value: unknown): void => {
    const json = JSON.stringify(value ?? null)
    const bytes = new TextEncoder().encode(json)
    data.set(bytes.subarray(0, data.length))
    Atomics.store(ctrl, CTRL_SYNC_LEN, Math.min(bytes.length, data.length))
    Atomics.store(ctrl, CTRL_SYNC_OK, ok ? 1 : 0)
    Atomics.add(ctrl, CTRL_SYNC_GEN, 1)
    Atomics.notify(ctrl, CTRL_SYNC_GEN)
  }

  return new Promise<WorkflowVMOutcome>((resolve, reject) => {
    let settled = false
    const finish = (fn: () => void): void => {
      if (settled) return
      settled = true
      clearInterval(cancelPoll)
      worker.terminate()
      fn()
    }

    worker.addEventListener('message', (ev: MessageEvent) => {
      const msg = ev.data as WorkerToHost
      switch (msg.t) {
        case 'call': {
          const fn = adapters.effects[msg.op] as (...a: unknown[]) => Promise<unknown>
          Promise.resolve()
            .then(() => fn(...msg.args))
            .then(
              (result) => worker.postMessage({t: 'call-done', id: msg.id, ok: true, result}),
              (error) =>
                worker.postMessage({
                  t: 'call-done',
                  id: msg.id,
                  ok: false,
                  error: serializeError(error),
                }),
            )
          return
        }
        case 'void': {
          try {
            ;(adapters.effects[msg.op] as (...a: unknown[]) => void)(...msg.args)
          } catch {
            /* progress/plan updates are best-effort */
          }
          return
        }
        case 'sync': {
          // Synchronous round-trip: run the effect and hand the reply back through the SAB.
          try {
            const result = (adapters.effects.spawnAgent as (...a: unknown[]) => unknown)(...msg.args)
            replySync(true, result)
          } catch (error) {
            replySync(false, serializeError(error))
          }
          return
        }
        case 'journal': {
          try {
            adapters.journal.append(msg.entry as never)
          } catch (error) {
            // A journal-cap throw is enforced worker-side too; surface anything unexpected.
            finish(() => reject(error))
          }
          return
        }
        case 'partial':
          opts.emitPartial?.(msg.patch)
          return
        case 'outcome':
          finish(() => resolve(msg.outcome))
          return
        case 'fail':
          finish(() => reject(Object.assign(new Error(msg.error.message), {stack: msg.error.stack})))
          return
      }
    })
    worker.addEventListener('error', (ev: ErrorEvent) => finish(() => reject(ev.error ?? new Error(ev.message))))

    worker.postMessage({
      t: 'init',
      sab,
      runId: adapters.runId,
      input: adapters.input,
      source: adapters.source,
      journal: adapters.journal.load(),
      config: {
        timerParkThresholdMs: adapters.timerParkThresholdMs,
        fuelMs: adapters.fuelMs,
        memoryBytes: adapters.memoryBytes,
      },
    })
  })
}

function serializeError(error: unknown): {message: string; code?: string; detail?: unknown} {
  if (error && typeof error === 'object') {
    const e = error as {message?: unknown; code?: unknown; detail?: unknown}
    return {
      message: typeof e.message === 'string' ? e.message : String(error),
      ...(typeof e.code === 'string' ? {code: e.code} : {}),
      ...(e.detail !== undefined ? {detail: e.detail} : {}),
    }
  }
  return {message: String(error)}
}

export const WORKFLOW_WORKER_CTRL = {
  CTRL_CANCEL,
  CTRL_SYNC_GEN,
  CTRL_SYNC_LEN,
  CTRL_SYNC_OK,
  CTRL_DATA_OFFSET,
}
