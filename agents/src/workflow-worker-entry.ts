/**
 * Worker entry for the workflow-in-worker proof of concept (see workflow-worker-host.ts and
 * hypermedia/agent-worker-isolated-execution.md). Runs the unmodified {@link runWorkflowVM} with a proxy
 * WorkflowAdapters that marshals every effect back to the main thread.
 */
import {runWorkflowVM, type WorkflowAdapters, type WorkflowJournalEntry} from './workflow-host'
import {WORKFLOW_WORKER_CTRL} from './workflow-worker-host'

type ErrShape = {message?: string; code?: string; detail?: unknown}
function reviveError(e: ErrShape | undefined): Error {
  const err = new Error(e?.message ?? 'error') as Error & {code?: string; detail?: unknown}
  if (e?.code) err.code = e.code
  if (e?.detail !== undefined) err.detail = e.detail
  return err
}

const scope = self as unknown as {
  postMessage: (m: unknown) => void
  addEventListener: (t: 'message', cb: (ev: {data: unknown}) => void) => void
}

let msgId = 0
const pending = new Map<number, {resolve: (v: unknown) => void; reject: (e: unknown) => void}>()

scope.addEventListener('message', (ev) => {
  const msg = ev.data as {t: string; [k: string]: unknown}
  if (msg.t === 'init') {
    void runInit(msg as unknown as InitMessage)
    return
  }
  if (msg.t === 'call-done') {
    const m = msg as unknown as {id: number; ok: boolean; result?: unknown; error?: ErrShape}
    const p = pending.get(m.id)
    if (!p) return
    pending.delete(m.id)
    m.ok ? p.resolve(m.result) : p.reject(reviveError(m.error))
  }
})

type InitMessage = {
  t: 'init'
  sab: SharedArrayBuffer
  runId: string
  input: unknown
  source: string
  journal: WorkflowJournalEntry[]
  config: {timerParkThresholdMs?: number; fuelMs?: number; memoryBytes?: number}
}

async function runInit(init: InitMessage): Promise<void> {
  const ctrl = new Int32Array(init.sab)
  const data = new Uint8Array(init.sab, WORKFLOW_WORKER_CTRL.CTRL_DATA_OFFSET)
  const post = (m: unknown) => scope.postMessage(m)

  const callAsync = (op: 'callTool' | 'awaitChild', args: unknown[]): Promise<unknown> =>
    new Promise((resolve, reject) => {
      const id = ++msgId
      pending.set(id, {resolve, reject})
      post({t: 'call', id, op, args})
    })

  // Synchronous round-trip: post the request, block on the generation counter, read the JSON reply.
  const syncSpawn = (args: unknown[]): {childRunId: string; sessionId?: string} => {
    const gen = Atomics.load(ctrl, WORKFLOW_WORKER_CTRL.CTRL_SYNC_GEN)
    post({t: 'sync', op: 'spawnAgent', args})
    Atomics.wait(ctrl, WORKFLOW_WORKER_CTRL.CTRL_SYNC_GEN, gen)
    const len = Atomics.load(ctrl, WORKFLOW_WORKER_CTRL.CTRL_SYNC_LEN)
    const ok = Atomics.load(ctrl, WORKFLOW_WORKER_CTRL.CTRL_SYNC_OK)
    const parsed = JSON.parse(new TextDecoder().decode(data.subarray(0, len)))
    if (!ok) throw reviveError(parsed as ErrShape)
    return parsed as {childRunId: string; sessionId?: string}
  }

  const proxy: WorkflowAdapters = {
    runId: init.runId,
    input: init.input,
    source: init.source,
    journal: {
      load: () => init.journal,
      // Cap enforcement stays on main (its append throws journal-cap, which rejects the run there).
      append: (entry) => post({t: 'journal', entry}),
    },
    effects: {
      callTool: (tool, input, description) => callAsync('callTool', [tool, input, description]),
      awaitChild: (childRunId) => callAsync('awaitChild', [childRunId]) as Promise<never>,
      spawnAgent: (spec, stepLabel) => syncSpawn([spec, stepLabel]),
      updatePlan: (plan) => post({t: 'void', op: 'updatePlan', args: [plan]}),
      progress: (patch) => post({t: 'void', op: 'progress', args: [patch]}),
      registerEventWait: (wait) => post({t: 'void', op: 'registerEventWait', args: [wait]}),
    },
    isCanceled: () => Atomics.load(ctrl, WORKFLOW_WORKER_CTRL.CTRL_CANCEL) === 1,
    timerParkThresholdMs: init.config.timerParkThresholdMs,
    fuelMs: init.config.fuelMs,
    memoryBytes: init.config.memoryBytes,
  }

  try {
    const outcome = await runWorkflowVM(proxy)
    post({t: 'outcome', outcome})
  } catch (error) {
    const e = error as {message?: string; stack?: string}
    post({t: 'fail', error: {message: e?.message ?? String(error), stack: e?.stack}})
  }
}
