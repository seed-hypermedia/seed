/**
 * The workflow engine: agent-authored JavaScript orchestration with a journaled, deterministic
 * host API.
 *
 * A workflow is a single JS module (`export default async function (input, ctx) {...}`) executed in
 * an in-process QuickJS-WASM realm with zero ambient authority: no Date, no Math.random, no fetch,
 * no timers — every effect crosses the host boundary through `ctx.*` and is journaled. Resume after
 * a crash, timer wake, or restart is replay-from-top: the function re-executes and journaled effects
 * return their recorded results instantly, so completed work never re-executes and the program takes
 * the identical path (divergence is detected and fails the run rather than guessing).
 *
 * Concurrency model: the VM is synchronous. `ctx.*` calls return VM promises resolved by the host
 * pump ({@link runWorkflowVM}), which drains effect requests the VM enqueued synchronously, executes
 * them (or replays them from the journal), and delivers results back while pumping the VM microtask
 * queue. This supports true `ctx.parallel` fan-out without asyncify.
 */
// The singlefile variant carries the QuickJS wasm embedded in its JS instead of loading
// `emscripten-module.wasm` from disk at runtime, which no bundled deployment can serve: the
// Docker image and the compiled desktop binary both bundle main.js away from node_modules, and
// the wasmfile variant's loader then dies with ENOENT on the missing file.
import singlefileVariant from '@jitl/quickjs-singlefile-cjs-release-sync'
import {
  newQuickJSWASMModuleFromVariant,
  type QuickJSContext,
  type QuickJSRuntime,
  type QuickJSWASMModule,
} from 'quickjs-emscripten-core'

// Memoized like quickjs-emscripten's getQuickJS() was; newQuickJSWASMModuleFromVariant
// instantiates a fresh wasm module per call, which no per-run code path should pay for.
let quickJSModule: Promise<QuickJSWASMModule> | undefined
const loadQuickJS = () => (quickJSModule ??= newQuickJSWASMModuleFromVariant(singlefileVariant))

/**
 * Proves the embedded QuickJS wasm instantiates and evaluates in this build. Part of the
 * packaging selfcheck (`--exec-selfcheck`): a bundling regression that loses the wasm should
 * fail the image or binary build, not the first delegated script in production.
 */
export async function quickjsSelfcheck(): Promise<void> {
  const QuickJS = await loadQuickJS()
  const vm = QuickJS.newContext()
  try {
    const handle = vm.unwrapResult(vm.evalCode('6 * 7'))
    const value = vm.dump(handle)
    handle.dispose()
    if (value !== 42) throw new Error(`QuickJS selfcheck evaluated to ${String(value)}`)
  } finally {
    vm.dispose()
  }
}
import type {RunPlanState} from '@/runs'

/**
 * One durable entry in a workflow run's journal. `callSeq` correlates the entries of one ctx call
 * (informational — it follows host processing order). Replay MATCHING uses `key`, a deterministic
 * content key of the effect: continuation ordering after `ctx.parallel` depends on real completion
 * timing, so arrival order differs between a live run and its replay, and order-based matching
 * would misfile results. Content keys are order-independent; effects with no journaled match simply
 * execute live (the source itself is pinned on the run row, so edited-source divergence cannot
 * occur).
 */
export type WorkflowJournalEntry = {callSeq: number; key?: string} & (
  | {kind: 'call'; op: 'tool' | 'agent'; tool?: string; input: unknown; childRunId?: string; description?: string}
  | {
      kind: 'result'
      status: 'succeeded' | 'failed'
      output?: unknown
      error?: {code: string; message: string; retryable?: boolean}
    }
  | {kind: 'timer'; wakeAt: number}
  | {kind: 'fired'}
  /** A ctx.waitForEvent registration: what the run parked on, and when it gives up. */
  | {kind: 'wait'; waitId: string; match: unknown; timeoutAt?: number; label?: string}
  /** The wait's resolution: a delivered payload, or nothing at all when it timed out. */
  | {kind: 'event'; waitId: string; delivery?: unknown}
  | {kind: 'now'; value: number}
  | {kind: 'log'; level: 'debug' | 'info' | 'warn' | 'error'; message: string; data?: unknown}
  | {kind: 'step'; stepId: string; label: string; phase: 'start' | 'end'; ok?: boolean}
  | {kind: 'plan'; plan: RunPlanState}
)

export type WorkflowChildResolution = {
  status: 'succeeded' | 'failed' | 'canceled'
  output?: unknown
  error?: {code: string; message: string}
  sessionId?: string
}

/** Host capabilities a workflow run executes against; the service provides the real one, tests fake it. */
export type WorkflowAdapters = {
  runId: string
  input: unknown
  source: string
  journal: {
    load(): WorkflowJournalEntry[]
    /** Throws {code:'journal-cap'} when the run outgrew its journal budget. */
    append(entry: WorkflowJournalEntry): void
  }
  effects: {
    callTool(tool: string, input: unknown, description?: string): Promise<unknown>
    /** Creates the child run (queued) and returns its id; the pump awaits it separately. */
    spawnAgent(spec: unknown, stepLabel?: string): {childRunId: string; sessionId?: string}
    awaitChild(childRunId: string): Promise<WorkflowChildResolution>
    updatePlan(plan: RunPlanState): void
    progress(patch: {fraction?: number; label?: string}): void
    /**
     * Records what this run is listening for, so a signal or a matching activity event can find it
     * while the run is parked. Called before the park, and again on every replay that re-parks.
     */
    registerEventWait(wait: {waitId: string; match: unknown; timeoutAt?: number}): void
  }
  isCanceled(): boolean
  /** Sleeps at or beyond this park instead of holding the VM resident (default 60s). */
  timerParkThresholdMs?: number
  /** Pure-compute budget between awaits before the VM is interrupted (default 2s). */
  fuelMs?: number
  /** WASM memory cap (default 64 MiB). */
  memoryBytes?: number
}

/**
 * A workflow failure with everything the moment of failure knew: the QuickJS stack (its line
 * numbers point into `workflow.js`, i.e. the stored source), and — when the terminal error was a
 * tool call's rejection propagating out uncaught — the failing call's identity, so a reader can be
 * taken to the exact journaled call (and its arguments) instead of guessing.
 */
export type WorkflowErrorInfo = {
  code: string
  message: string
  retryable?: boolean
  stack?: string
  /** Tool name of the failed ctx.call this error propagated from, when it did. */
  tool?: string
  /** Journal callSeq of that failed call — the durable pointer to its args and result. */
  callSeq?: number
  /** Structured detail the failing tool attached, forwarded verbatim. */
  detail?: unknown
}

export type WorkflowVMOutcome =
  | {type: 'succeeded'; output: unknown}
  | {type: 'failed'; error: WorkflowErrorInfo}
  | {type: 'canceled'}
  | {
      type: 'parked'
      wait:
        | {reason: 'timer'; wakeAt: number}
        | {reason: 'event'; waitId: string; timeoutAt?: number; label?: string; answerWith?: string}
    }
  /** ctx.continueAsNew: this run is done, and a successor should carry `state` onward. */
  | {type: 'continued'; state: unknown}

export const WORKFLOW_SOURCE_MAX_BYTES = 256 * 1024
const DEFAULT_FUEL_MS = 2_000
const DEFAULT_MEMORY_BYTES = 64 * 1024 * 1024
const DEFAULT_TIMER_PARK_THRESHOLD_MS = 60_000

/**
 * Submission-time determinism lint. These are also unavailable at runtime (the realm removes them);
 * failing at authoring time turns a 2am replay stall into an immediate, fixable tool error.
 */
export function lintWorkflowSource(source: string): string[] {
  const errors: string[] = []
  const bytes = new TextEncoder().encode(source).byteLength
  if (bytes > WORKFLOW_SOURCE_MAX_BYTES) {
    errors.push(`source is ${bytes} bytes; the limit is ${WORKFLOW_SOURCE_MAX_BYTES}`)
  }
  const banned: Array<[RegExp, string]> = [
    [/\bMath\.random\b/, 'Math.random is not available: take randomness as workflow input'],
    [/\bDate\b/, 'Date is not available: use `await ctx.now()` for the current time'],
    [
      /\bsetTimeout\b|\bsetInterval\b/,
      'timers are not available: use `await ctx.sleep(ms)` (durable, survives restarts)',
    ],
    [/\bfetch\s*\(/, 'fetch is not available: use `await ctx.call("web_read", {url})` or another enabled tool'],
    [/\bXMLHttpRequest\b/, 'XMLHttpRequest is not available: use ctx.call with a web tool'],
    [/\beval\s*\(/, 'eval is not available in workflows'],
    [/\brequire\s*\(/, 'require is not available: workflows have no imports; everything comes from ctx'],
    [/\bimport\s*\(|^\s*import\s/m, 'imports are not available: workflows are single self-contained modules'],
    [/\bprocess\./, 'process is not available in workflows'],
    [/\bglobalThis\b/, 'globalThis access is not allowed in workflows'],
  ]
  for (const [pattern, message] of banned) {
    if (pattern.test(source)) errors.push(message)
  }
  const exportCount = (source.match(/export\s+default/g) ?? []).length
  if (exportCount !== 1) {
    errors.push('the module must have exactly one `export default async function (input, ctx) { ... }`')
  }
  return errors
}

/** Rewrites the single `export default` into a global the kickoff code can invoke. */
export function transformWorkflowSource(source: string): string {
  return source.replace(/export\s+default/, '__workflow_main =')
}

/**
 * Realm prelude: builds `ctx`, the pending-call registry, and removes ambient nondeterminism.
 * `__host_enqueue`, `__host_notify`, and `__host_finish` are host-installed functions.
 */
const WORKFLOW_PRELUDE = `
"use strict";
var __workflow_main;
var __pending = new Map();
var __nextCallId = 1;
class ActionError extends Error {
  constructor(info) {
    super(info && info.message ? info.message : 'Action failed');
    this.code = info && info.code ? info.code : 'tool-error';
    this.retryable = Boolean(info && info.retryable);
    this.detail = info ? info.detail : undefined;
    // Identity of the failed call, stamped by the host: if this error escapes uncaught it becomes
    // the run's terminal error, and these are what let the UI point at the exact failing call.
    this.tool = info && info.tool ? String(info.tool) : undefined;
    this.callSeq = info && typeof info.callSeq === 'number' ? info.callSeq : undefined;
    // The construction stack is prelude plumbing (__deliver), never the await site — noise that
    // would masquerade as a script location. The call identity above is the real pointer.
    this.stack = undefined;
  }
}
function __call(op, args) {
  var id = __nextCallId++;
  var promise = new Promise(function (resolve, reject) {
    __pending.set(id, {resolve: resolve, reject: reject});
  });
  __host_enqueue(op, id, JSON.stringify(args === undefined ? null : args));
  return promise;
}
function __deliver(id, ok, valueJson) {
  var entry = __pending.get(id);
  __pending.delete(id);
  if (!entry) return;
  var value = valueJson === '' ? undefined : JSON.parse(valueJson);
  if (ok) entry.resolve(value);
  else entry.reject(new ActionError(value));
}
function __makeCtx(input, runId) {
  var stepCount = 0;
  // Labels of ctx.step blocks currently executing, innermost last. Spawns inherit the innermost
  // one so the progress card can show a step and the sub-agent working it as one item.
  var openSteps = [];
  function closeStep(label) {
    var index = openSteps.lastIndexOf(label);
    if (index >= 0) openSteps.splice(index, 1);
  }
  function __delegate(spec) {
    var step = openSteps.length ? openSteps[openSteps.length - 1] : undefined;
    return __call('agent', {spec: spec, step: step}).then(function (res) {
      if (res && res.status === 'succeeded') return res.output;
      throw new ActionError({
        code: res && res.status === 'canceled' ? 'canceled' : (res && res.error && res.error.code) || 'agent-failed',
        message: (res && res.error && res.error.message) || 'Sub-agent ' + ((res && res.status) || 'failed'),
      });
    });
  }
  return Object.freeze({
    input: input,
    runId: runId,
    call: function (tool, input2, opts) { return __call('tool', {tool: tool, input: input2, opts: opts}); },
    // ctx.delegate is the documented name; ctx.agent stays as a synonym so both spellings share
    // one journal op (content keys are computed from the spec, not the ctx method name).
    delegate: __delegate,
    agent: __delegate,
    sleep: function (ms) { return __call('sleep', {ms: ms}); },
    // Parks the run until something happens: a matching activity event, or a SignalRun. Resolves
    // with the delivered payload, or null when the timeout arrives first.
    waitForEvent: function (match, opts) { return __call('wait', {match: match, opts: opts}); },
    // Ends this run and starts a successor carrying only the given state. Never resolves: nothing
    // after it in this run will run.
    continueAsNew: function (state) { return __call('continueAsNew', {state: state}); },
    minutes: function (n) { return n * 60000; },
    hours: function (n) { return n * 3600000; },
    now: function () { return __call('now', {}); },
    log: function (level, message, data) { return __call('log', {level: level, message: message, data: data}); },
    progress: function (patch) { __host_notify('progress', JSON.stringify(patch === undefined ? null : patch)); },
    plan: function (plan) { return __call('plan', {plan: plan}); },
    step: function (label, fn) {
      var id = 'step-' + (++stepCount);
      return __call('step', {stepId: id, label: label, phase: 'start'}).then(function () {
        openSteps.push(label);
        return Promise.resolve()
          .then(fn)
          .then(function (value) {
            closeStep(label);
            return __call('step', {stepId: id, label: label, phase: 'end', ok: true}).then(function () { return value; });
          }, function (error) {
            closeStep(label);
            return __call('step', {stepId: id, label: label, phase: 'end', ok: false}).then(function () { throw error; });
          });
      });
    },
    parallel: function (thunks) {
      return Promise.all(thunks.map(function (thunk) { return Promise.resolve().then(thunk); }));
    },
    parallelSettled: function (thunks) {
      return Promise.allSettled(thunks.map(function (thunk) { return Promise.resolve().then(thunk); }));
    },
  });
}
// UTF-8 text coding. QuickJS ships pure ECMAScript, so the WHATWG encoders scripts reach for by
// habit (byte-size checks before publishing, hashing prep) do not exist natively — and a missing
// global fails at runtime, deep into a run the lint approved. Encoding is a pure function of its
// input, so providing it keeps the realm deterministic and replay-safe. utf-8 only.
function __utf8Encode(input) {
  var str = String(input === undefined ? '' : input);
  var out = [];
  for (var i = 0; i < str.length; i++) {
    var code = str.codePointAt(i);
    if (code >= 0xd800 && code <= 0xdfff) code = 0xfffd; // lone surrogate -> replacement, per spec
    else if (code > 0xffff) i++;
    if (code < 0x80) out.push(code);
    else if (code < 0x800) out.push(0xc0 | (code >> 6), 0x80 | (code & 63));
    else if (code < 0x10000) out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
    else out.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 63), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
  }
  return new Uint8Array(out);
}
function __utf8Decode(input) {
  var bytes =
    input instanceof Uint8Array ? input
    : input instanceof ArrayBuffer ? new Uint8Array(input)
    : ArrayBuffer.isView(input) ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
    : null;
  if (!bytes) throw new TypeError('TextDecoder.decode expects an ArrayBuffer or ArrayBuffer view');
  var out = '';
  for (var i = 0; i < bytes.length; ) {
    var b = bytes[i];
    var code, extra;
    if (b < 0x80) { code = b; extra = 0; }
    else if ((b & 0xe0) === 0xc0) { code = b & 31; extra = 1; }
    else if ((b & 0xf0) === 0xe0) { code = b & 15; extra = 2; }
    else if ((b & 0xf8) === 0xf0) { code = b & 7; extra = 3; }
    else { out += '\\ufffd'; i++; continue; }
    var ok = true;
    for (var j = 1; j <= extra; j++) {
      var cont = bytes[i + j];
      if (cont === undefined || (cont & 0xc0) !== 0x80) { ok = false; break; }
      code = (code << 6) | (cont & 63);
    }
    if (!ok) { out += '\\ufffd'; i++; continue; }
    i += extra + 1;
    if (
      code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff) ||
      (extra === 1 && code < 0x80) || (extra === 2 && code < 0x800) || (extra === 3 && code < 0x10000)
    ) { out += '\\ufffd'; continue; }
    out += String.fromCodePoint(code);
  }
  return out;
}
class TextEncoder {
  get encoding() { return 'utf-8'; }
  encode(input) { return __utf8Encode(input); }
}
class TextDecoder {
  constructor(label) {
    var name = label === undefined ? 'utf-8' : String(label).toLowerCase();
    if (name !== 'utf-8' && name !== 'utf8' && name !== 'unicode-1-1-utf-8') {
      throw new RangeError('Only utf-8 is supported in workflows');
    }
  }
  get encoding() { return 'utf-8'; }
  decode(input) { return input === undefined ? '' : __utf8Decode(input); }
}
Math.random = function () { throw new Error('Math.random is not available in workflows; take randomness as input'); };
Date = function () { throw new Error('Date is not available in workflows; use await ctx.now()'); };
`

type PendingEffect = {callId: number; op: string; args: unknown}
type Delivery = {callId: number; ok: boolean; json: string}

class WorkflowFailure extends Error {
  readonly code: string
  readonly vmStack?: string
  constructor(code: string, message: string, vmStack?: string) {
    super(message)
    this.code = code
    this.vmStack = vmStack
  }
}

/** Executes (or resumes, by replay) one workflow run to an outcome. */
export async function runWorkflowVM(adapters: WorkflowAdapters): Promise<WorkflowVMOutcome> {
  const fuelMs = adapters.fuelMs ?? DEFAULT_FUEL_MS
  const parkThresholdMs = adapters.timerParkThresholdMs ?? DEFAULT_TIMER_PARK_THRESHOLD_MS
  const QuickJS = await loadQuickJS()
  const runtime: QuickJSRuntime = QuickJS.newRuntime()
  runtime.setMemoryLimit(adapters.memoryBytes ?? DEFAULT_MEMORY_BYTES)
  runtime.setMaxStackSize(1024 * 1024)
  let sliceDeadline = Date.now() + fuelMs
  let interrupted = false
  runtime.setInterruptHandler(() => {
    if (adapters.isCanceled() || Date.now() > sliceDeadline) {
      interrupted = true
      return true
    }
    return false
  })
  const vm: QuickJSContext = runtime.newContext()

  const effectsQueue: PendingEffect[] = []
  const deliveries: Delivery[] = []
  const inflight = new Map<number, Promise<void>>()
  let finished: {ok: boolean; value: unknown} | null = null
  let cancellationRequested = false
  const parkState: {
    timer: {wakeAt: number} | null
    event: {waitId: string; timeoutAt?: number; label?: string; answerWith?: string} | null
  } = {timer: null, event: null}
  // A holder rather than a plain `let`: it is written from inside handleEffect, and the pump loop
  // reads it afterwards.
  const continuation: {requested: {state: unknown} | null} = {requested: null}

  // Journal replay state: entry groups (one per ctx call, correlated by callSeq) filed under their
  // deterministic content key and consumed FIFO per key. Order-independent by construction, so
  // continuation reordering after ctx.parallel cannot misfile results.
  const journal = adapters.journal.load()
  const groupsBySeq = new Map<number, WorkflowJournalEntry[]>()
  for (const entry of journal) {
    const list = groupsBySeq.get(entry.callSeq) ?? []
    list.push(entry)
    groupsBySeq.set(entry.callSeq, list)
  }
  const groupsByKey = new Map<string, WorkflowJournalEntry[][]>()
  for (const [, group] of [...groupsBySeq.entries()].sort((a, b) => a[0] - b[0])) {
    const key = group[0]?.key
    if (!key) continue
    const queue = groupsByKey.get(key) ?? []
    queue.push(group)
    groupsByKey.set(key, queue)
  }
  const takeJournaledGroup = (key: string): WorkflowJournalEntry[] | undefined => {
    const queue = groupsByKey.get(key)
    if (!queue || queue.length === 0) return undefined
    return queue.shift()
  }
  const remainingJournaledGroups = (): number => {
    let count = 0
    for (const queue of groupsByKey.values()) count += queue.length
    return count
  }
  let callCounter = 0
  for (const seq of groupsBySeq.keys()) callCounter = Math.max(callCounter, seq)

  const effectKey = (op: string, args: Record<string, unknown>): string => {
    switch (op) {
      case 'tool':
        return `tool|${String(args.tool ?? '')}|${JSON.stringify(args.input ?? null)}`
      case 'agent':
        return `agent|${JSON.stringify(args.spec ?? null)}`
      case 'sleep':
        return `sleep|${Math.max(0, Number(args.ms) || 0)}`
      case 'wait':
        return `wait|${JSON.stringify(args.match ?? null)}`
      case 'continueAsNew':
        return 'continueAsNew'
      case 'now':
        return 'now'
      case 'log':
        return `log|${String(args.level ?? '')}|${String(args.message ?? '')}`
      case 'step':
        return `step|${String(args.stepId ?? '')}|${String(args.phase ?? '')}`
      case 'plan':
        return `plan|${JSON.stringify(args.plan ?? null)}`
      default:
        return `op|${op}`
    }
  }

  const dispose = () => {
    try {
      vm.dispose()
    } catch {}
    try {
      runtime.dispose()
    } catch {}
  }

  const evalGuarded = (code: string, label: string): void => {
    sliceDeadline = Date.now() + fuelMs
    interrupted = false
    // The label doubles as the eval unit's filename, so stack frames say where they are: an error
    // in the script itself reads `workflow.js:LINE`, with LINE valid in the stored source (the
    // export-default transform preserves line numbers).
    const result = vm.evalCode(code, `${label}.js`)
    if ('error' in result && result.error) {
      const detail = vm.dump(result.error)
      result.error.dispose()
      const message =
        typeof detail === 'object' && detail && 'message' in detail ? String(detail.message) : String(detail)
      const stack =
        typeof detail === 'object' && detail && 'stack' in detail && detail.stack ? String(detail.stack) : undefined
      if (interrupted) {
        throw new WorkflowFailure(
          adapters.isCanceled() ? 'canceled' : 'fuel-exhausted',
          adapters.isCanceled() ? 'Workflow canceled' : `Workflow compute slice exceeded ${fuelMs}ms (${label})`,
        )
      }
      throw new WorkflowFailure('workflow-error', message, stack)
    }
    if ('value' in result) result.value.dispose()
  }

  const pumpJobs = (): void => {
    sliceDeadline = Date.now() + fuelMs
    interrupted = false
    const result = runtime.executePendingJobs()
    if (result.error) {
      const detail = vm.dump(result.error)
      result.error.dispose()
      if (interrupted) {
        throw new WorkflowFailure(
          adapters.isCanceled() ? 'canceled' : 'fuel-exhausted',
          adapters.isCanceled() ? 'Workflow canceled' : `Workflow compute slice exceeded ${fuelMs}ms (microtasks)`,
        )
      }
      throw new WorkflowFailure(
        'workflow-error',
        typeof detail === 'object' && detail && 'message' in detail ? String(detail.message) : String(detail),
        typeof detail === 'object' && detail && 'stack' in detail && detail.stack ? String(detail.stack) : undefined,
      )
    }
  }

  const scheduleDelivery = (callId: number, ok: boolean, value: unknown): void => {
    deliveries.push({callId, ok, json: value === undefined ? '' : JSON.stringify(value ?? null)})
  }

  const journaledResultValue = (entry: Extract<WorkflowJournalEntry, {kind: 'result'}>): [boolean, unknown] => {
    if (entry.status === 'succeeded') return [true, entry.output]
    // Re-attach the call's identity on replay, so a failure delivered from the journal carries the
    // same pointer a live failure does — the terminal error must not depend on which pass failed.
    return [false, {...(entry.error ?? {code: 'tool-error', message: 'Action failed'}), callSeq: entry.callSeq}]
  }

  /** Runs a live (non-replayed) async effect and journals + delivers its result. */
  const startInflight = (callId: number, callSeq: number, effect: () => Promise<unknown>, tool?: string): void => {
    const promise = effect()
      .then((output) => {
        adapters.journal.append({kind: 'result', callSeq, status: 'succeeded', output})
        scheduleDelivery(callId, true, output)
      })
      .catch((error: unknown) => {
        const info = {
          code:
            typeof error === 'object' && error && 'code' in error
              ? String((error as {code: unknown}).code)
              : 'tool-error',
          message:
            error instanceof Error
              ? error.message
              : typeof error === 'object' && error && 'message' in error
                ? String((error as {message: unknown}).message)
                : String(error),
          retryable:
            typeof error === 'object' && error && 'retryable' in error
              ? Boolean((error as {retryable: unknown}).retryable)
              : false,
        }
        const detail =
          typeof error === 'object' && error && 'detail' in error ? (error as {detail: unknown}).detail : undefined
        adapters.journal.append({kind: 'result', callSeq, status: 'failed', error: info})
        // The delivered value additionally names the call, so an uncaught rejection becomes a
        // terminal error that still knows exactly which call it was.
        scheduleDelivery(callId, false, {
          ...info,
          callSeq,
          ...(tool ? {tool} : {}),
          ...(detail !== undefined ? {detail} : {}),
        })
      })
      .finally(() => {
        inflight.delete(callId)
      })
    inflight.set(callId, promise)
  }

  /** Resolves a child-run wait: journals the resolution as the call's result and delivers it. */
  const startChildWait = (callId: number, callSeq: number, childRunId: string): void => {
    startInflight(callId, callSeq, async () => {
      const resolution = await adapters.effects.awaitChild(childRunId)
      // The full resolution (status/output/error) is the delivered value; ctx.agent unwraps it.
      return resolution as unknown
    })
  }

  const handleEffect = (effect: PendingEffect): void => {
    const args = (effect.args ?? {}) as Record<string, unknown>
    const key = effectKey(effect.op, args)
    const journaled = takeJournaledGroup(key)
    const callSeq = journaled?.[0]?.callSeq ?? ++callCounter
    const journaledCall = journaled?.find((entry) => entry.kind === 'call') as
      | Extract<WorkflowJournalEntry, {kind: 'call'}>
      | undefined
    const journaledResult = journaled?.find((entry) => entry.kind === 'result') as
      | Extract<WorkflowJournalEntry, {kind: 'result'}>
      | undefined

    switch (effect.op) {
      case 'tool': {
        const tool = String(args.tool ?? '')
        // Scripts narrate their own work: ctx.call(tool, input, {description}) labels this call
        // for the run card and live activity. Descriptions are display metadata — they ride the
        // journal entry but stay OUT of the content key, so relabeling never breaks replay.
        const opts = args.opts as {description?: unknown} | undefined
        const description = typeof opts?.description === 'string' ? opts.description : undefined
        if (journaledResult) {
          const [ok, value] = journaledResultValue(journaledResult)
          scheduleDelivery(effect.callId, ok, ok ? value : {...(value as Record<string, unknown>), tool})
          return
        }
        if (!journaledCall) {
          adapters.journal.append({
            kind: 'call',
            callSeq,
            key,
            op: 'tool',
            tool,
            input: args.input,
            ...(description ? {description} : {}),
          })
        }
        // A call journaled without a result was interrupted mid-execution; whether it took effect is
        // unknowable, so it re-executes (workflow tools should be idempotent or cheap).
        startInflight(effect.callId, callSeq, () => adapters.effects.callTool(tool, args.input, description), tool)
        return
      }
      case 'agent': {
        if (journaledResult) {
          const [ok, value] = journaledResultValue(journaledResult)
          scheduleDelivery(effect.callId, ok, value)
          return
        }
        if (journaledCall?.childRunId) {
          // Child already spawned before an interruption; reconnect to it instead of double-spawning.
          startChildWait(effect.callId, callSeq, journaledCall.childRunId)
          return
        }
        const spawned = adapters.effects.spawnAgent(args.spec, typeof args.step === 'string' ? args.step : undefined)
        adapters.journal.append({
          kind: 'call',
          callSeq,
          key,
          op: 'agent',
          input: args.spec,
          childRunId: spawned.childRunId,
        })
        startChildWait(effect.callId, callSeq, spawned.childRunId)
        return
      }
      case 'sleep': {
        const ms = Math.max(0, Number(args.ms) || 0)
        const journaledTimer = journaled?.find((entry) => entry.kind === 'timer') as
          | Extract<WorkflowJournalEntry, {kind: 'timer'}>
          | undefined
        const fired = journaled?.some((entry) => entry.kind === 'fired')
        const wakeAt = journaledTimer?.wakeAt ?? Date.now() + ms
        if (!journaledTimer) adapters.journal.append({kind: 'timer', callSeq, key, wakeAt})
        if (fired) {
          scheduleDelivery(effect.callId, true, null)
          return
        }
        const remaining = wakeAt - Date.now()
        if (remaining <= 0) {
          adapters.journal.append({kind: 'fired', callSeq, key})
          scheduleDelivery(effect.callId, true, null)
          return
        }
        if (remaining >= parkThresholdMs) {
          // Long sleep: request a park; the pump drains other work first, then parks the run.
          // Parallel sleeps keep the EARLIEST deadline — overwriting would silently delay the
          // shorter sleep's continuation to the longer sleep's wake time.
          parkState.timer = {wakeAt: parkState.timer ? Math.min(parkState.timer.wakeAt, wakeAt) : wakeAt}
          // The delivery happens on the post-wake replay, where `remaining <= 0` fires the timer.
          return
        }
        // Short sleep: hold the VM resident; journal the timer's own `fired` marker (not a result).
        const timerPromise = new Promise<void>((resolve) => setTimeout(resolve, remaining))
          .then(() => {
            adapters.journal.append({kind: 'fired', callSeq, key})
            scheduleDelivery(effect.callId, true, null)
          })
          .finally(() => inflight.delete(effect.callId))
        inflight.set(effect.callId, timerPromise)
        return
      }
      case 'wait': {
        const match = args.match ?? {}
        const opts = args.opts as {timeoutMs?: unknown; label?: unknown} | undefined
        const timeoutMs = Number(opts?.timeoutMs)
        const label = typeof opts?.label === 'string' ? opts.label : undefined
        const journaledWait = journaled?.find((entry) => entry.kind === 'wait') as
          | Extract<WorkflowJournalEntry, {kind: 'wait'}>
          | undefined
        const journaledEvent = journaled?.find((entry) => entry.kind === 'event') as
          | Extract<WorkflowJournalEntry, {kind: 'event'}>
          | undefined
        // The wait id is minted once and journaled, so every replay re-registers the SAME wait —
        // a signal sent while the run was down still lands on the wait the script is asking for.
        const waitId = journaledWait?.waitId ?? crypto.randomUUID()
        const timeoutAt =
          journaledWait?.timeoutAt ?? (Number.isFinite(timeoutMs) && timeoutMs > 0 ? Date.now() + timeoutMs : undefined)
        if (!journaledWait) {
          adapters.journal.append({
            kind: 'wait',
            callSeq,
            key,
            waitId,
            match,
            ...(timeoutAt === undefined ? {} : {timeoutAt}),
            ...(label ? {label} : {}),
          })
        }
        if (journaledEvent) {
          // Delivered (payload) or timed out (no delivery) — both are settled facts on replay.
          scheduleDelivery(effect.callId, true, journaledEvent.delivery ?? null)
          return
        }
        if (timeoutAt !== undefined && Date.now() >= timeoutAt) {
          adapters.journal.append({kind: 'event', callSeq, key, waitId})
          scheduleDelivery(effect.callId, true, null)
          return
        }
        adapters.effects.registerEventWait({waitId, match, ...(timeoutAt === undefined ? {} : {timeoutAt})})
        // Several parallel waits all register and any of them can wake the run. Park on the one
        // with the earliest deadline, though, so an untimed or later first wait cannot suppress it.
        const answerWith = answerSignalFor(match)
        if (
          !parkState.event ||
          (timeoutAt !== undefined &&
            (parkState.event.timeoutAt === undefined || timeoutAt < parkState.event.timeoutAt))
        ) {
          parkState.event = {
            waitId,
            ...(timeoutAt === undefined ? {} : {timeoutAt}),
            ...(label ? {label} : {}),
            ...(answerWith === undefined ? {} : {answerWith}),
          }
        }
        return
      }
      case 'continueAsNew': {
        // Nothing is delivered: this call never resolves, because this run ends here.
        continuation.requested = {state: args.state ?? null}
        return
      }
      case 'now': {
        const journaledNow = journaled?.find((entry) => entry.kind === 'now') as
          | Extract<WorkflowJournalEntry, {kind: 'now'}>
          | undefined
        const value = journaledNow?.value ?? Date.now()
        if (!journaledNow) adapters.journal.append({kind: 'now', callSeq, key, value})
        scheduleDelivery(effect.callId, true, value)
        return
      }
      case 'log': {
        const level = ['debug', 'info', 'warn', 'error'].includes(String(args.level))
          ? (String(args.level) as 'debug' | 'info' | 'warn' | 'error')
          : 'info'
        const alreadyJournaled = journaled?.some((entry) => entry.kind === 'log')
        if (!alreadyJournaled) {
          adapters.journal.append({
            kind: 'log',
            callSeq,
            key,
            level,
            message: String(args.message ?? ''),
            ...(args.data === undefined ? {} : {data: args.data}),
          })
        }
        scheduleDelivery(effect.callId, true, null)
        return
      }
      case 'step': {
        const alreadyJournaled = journaled?.some(
          (entry) => entry.kind === 'step' && entry.phase === (args.phase as string),
        )
        const entry: WorkflowJournalEntry & {kind: 'step'} = {
          kind: 'step',
          callSeq,
          key,
          stepId: String(args.stepId ?? `step-${callSeq}`),
          label: String(args.label ?? ''),
          phase: args.phase === 'end' ? 'end' : 'start',
          ...(args.ok === undefined ? {} : {ok: Boolean(args.ok)}),
        }
        if (!alreadyJournaled) adapters.journal.append(entry)
        applyStepToPlan(entry)
        scheduleDelivery(effect.callId, true, null)
        return
      }
      case 'plan': {
        const plan = normalizePlan(args.plan)
        const alreadyJournaled = journaled?.some((entry) => entry.kind === 'plan')
        if (!alreadyJournaled) adapters.journal.append({kind: 'plan', callSeq, key, plan})
        planState = plan
        adapters.effects.updatePlan(plan)
        scheduleDelivery(effect.callId, true, null)
        return
      }
      default:
        scheduleDelivery(effect.callId, false, {code: 'unknown-op', message: `Unknown ctx operation: ${effect.op}`})
    }
  }

  // Plan state derived from step/plan entries (rebuilt during replay too, so the card heals).
  let planState: RunPlanState = {steps: []}
  const applyStepToPlan = (entry: Extract<WorkflowJournalEntry, {kind: 'step'}>): void => {
    // ctx.step matches a ctx.plan-declared step by label so declared plans don't grow duplicates.
    const existing =
      planState.steps.find((step) => step.id === entry.stepId) ??
      planState.steps.find(
        (step) => step.label === entry.label && (step.status === 'pending' || step.status === 'running'),
      )
    if (entry.phase === 'start') {
      if (existing) existing.status = 'running'
      else planState.steps.push({id: entry.stepId, label: entry.label, status: 'running'})
    } else if (existing) {
      existing.status = entry.ok === false ? 'failed' : 'done'
    }
    adapters.effects.updatePlan(planState)
  }

  try {
    // Host bridge functions. Effects are recorded synchronously; nothing re-enters the VM here.
    const enqueueFn = vm.newFunction('__host_enqueue', (opHandle, idHandle, argsHandle) => {
      const op = vm.getString(opHandle)
      const callId = vm.getNumber(idHandle)
      const argsJson = vm.getString(argsHandle)
      effectsQueue.push({callId, op, args: argsJson === '' ? undefined : JSON.parse(argsJson)})
    })
    vm.setProp(vm.global, '__host_enqueue', enqueueFn)
    enqueueFn.dispose()
    const notifyFn = vm.newFunction('__host_notify', (kindHandle, jsonHandle) => {
      const kind = vm.getString(kindHandle)
      const json = vm.getString(jsonHandle)
      if (kind === 'progress') {
        try {
          const patch = JSON.parse(json) as {fraction?: number; label?: string} | null
          if (patch && typeof patch === 'object') adapters.effects.progress(patch)
        } catch {}
      }
    })
    vm.setProp(vm.global, '__host_notify', notifyFn)
    notifyFn.dispose()
    const finishFn = vm.newFunction('__host_finish', (okHandle, valueHandle) => {
      const ok = vm.dump(okHandle) === true
      const valueJson = vm.getString(valueHandle)
      finished = {ok, value: valueJson === '' ? undefined : JSON.parse(valueJson)}
    })
    vm.setProp(vm.global, '__host_finish', finishFn)
    finishFn.dispose()

    evalGuarded(WORKFLOW_PRELUDE, 'prelude')
    evalGuarded(transformWorkflowSource(adapters.source), 'workflow')
    const kickoff = `
      (function () {
        if (typeof __workflow_main !== 'function') throw new Error('export default must be a function');
        var ctx = __makeCtx(${JSON.stringify(adapters.input ?? null)}, ${JSON.stringify(adapters.runId)});
        Promise.resolve(__workflow_main(ctx.input, ctx)).then(function (value) {
          __host_finish(true, JSON.stringify(value === undefined ? null : value));
        }, function (error) {
          __host_finish(false, JSON.stringify({
            code: error && error.code ? String(error.code) : 'workflow-error',
            message: error && error.message ? String(error.message) : String(error),
            stack: error && error.stack ? String(error.stack) : undefined,
            tool: error && error.tool ? String(error.tool) : undefined,
            callSeq: error && typeof error.callSeq === 'number' ? error.callSeq : undefined,
            detail: error ? error.detail : undefined,
          }));
        });
      })();
    `
    evalGuarded(kickoff, 'kickoff')

    for (;;) {
      pumpJobs()
      while (effectsQueue.length > 0) handleEffect(effectsQueue.shift()!)
      if (deliveries.length > 0) {
        const batch = deliveries.splice(0)
        for (const delivery of batch) {
          evalGuarded(`__deliver(${delivery.callId}, ${delivery.ok}, ${JSON.stringify(delivery.json)})`, 'deliver')
        }
        continue
      }
      cancellationRequested ||= adapters.isCanceled()
      if ((finished || cancellationRequested) && inflight.size > 0) {
        // Effects already issued by a failing parallel sibling or a canceled run cannot be stopped.
        // Keep the run non-terminal until they are journaled so tools and children cannot mutate
        // external state or append results after clients have observed completion.
        await Promise.race(inflight.values())
        continue
      }
      if (cancellationRequested) return {type: 'canceled'}
      if (finished) {
        const done: {ok: boolean; value: unknown} = finished
        if (done.ok) {
          const leftovers = remainingJournaledGroups()
          if (leftovers > 0) {
            // Content-keyed matching: a leftover means the resumed code issued fewer/different
            // calls than the original pass. Informational — the run still completed.
            console.warn('[agents/workflow] replay finished with unconsumed journal groups', {
              runId: adapters.runId,
              leftovers,
            })
          }
          return {type: 'succeeded', output: done.value ?? null}
        }
        const failure = (done.value ?? {}) as {code?: string; message?: string}
        // An interrupt inside an async body surfaces as a rejection (QuickJS message: "interrupted"),
        // not an eval error: map it back to the real cause.
        if (interrupted || failure.message === 'interrupted') {
          if (adapters.isCanceled()) return {type: 'canceled'}
          return {
            type: 'failed',
            error: {code: 'fuel-exhausted', message: `Workflow compute slice exceeded ${fuelMs}ms`},
          }
        }
        const error = (done.value ?? {}) as Partial<WorkflowErrorInfo>
        return {
          type: 'failed',
          error: {
            code: error.code || 'workflow-error',
            message: error.message || 'Workflow failed',
            ...(error.stack ? {stack: error.stack} : {}),
            ...(error.tool ? {tool: error.tool} : {}),
            ...(typeof error.callSeq === 'number' ? {callSeq: error.callSeq} : {}),
            ...(error.detail !== undefined ? {detail: error.detail} : {}),
          },
        }
      }
      if (continuation.requested && inflight.size === 0) {
        return {type: 'continued', state: continuation.requested.state}
      }
      if (parkState.event && inflight.size === 0) {
        // A sleep parked alongside a wait keeps the earlier deadline: whichever comes first wakes
        // the run, and the replay settles both from the journal.
        const timeoutAt =
          parkState.timer &&
          (parkState.event.timeoutAt === undefined || parkState.timer.wakeAt < parkState.event.timeoutAt)
            ? parkState.timer.wakeAt
            : parkState.event.timeoutAt
        return {
          type: 'parked',
          wait: {
            reason: 'event',
            waitId: parkState.event.waitId,
            ...(timeoutAt === undefined ? {} : {timeoutAt}),
            ...(parkState.event.label ? {label: parkState.event.label} : {}),
          },
        }
      }
      if (parkState.timer && inflight.size === 0) {
        return {type: 'parked', wait: {reason: 'timer', wakeAt: parkState.timer.wakeAt}}
      }
      if (inflight.size > 0) {
        await Promise.race(inflight.values())
        continue
      }
      return {
        type: 'failed',
        error: {
          code: 'workflow-deadlock',
          message: 'The workflow is awaiting something that can never resolve (a promise outside ctx)',
        },
      }
    }
  } catch (error) {
    if (error instanceof WorkflowFailure) {
      if (error.code === 'canceled') return {type: 'canceled'}
      return {
        type: 'failed',
        error: {code: error.code, message: error.message, ...(error.vmStack ? {stack: error.vmStack} : {})},
      }
    }
    if (typeof error === 'object' && error && (error as {code?: string}).code === 'journal-cap') {
      return {
        type: 'failed',
        error: {code: 'journal-cap', message: 'Workflow journal cap reached; split the work into smaller workflows'},
      }
    }
    return {
      type: 'failed',
      error: {code: 'workflow-error', message: error instanceof Error ? error.message : String(error)},
    }
  } finally {
    // Give abandoned inflight promises a no-op catch so late rejections don't surface.
    for (const pending of inflight.values()) pending.catch(() => {})
    dispose()
  }
}

/**
 * The signal name that would answer a wait, when a signal can answer it at all — which is what a
 * person needs to know before they are offered a button. A wait naming a signal takes that name; a
 * wait with no criteria takes any name; a wait watching the activity feed cannot be answered by
 * hand and gets nothing. Counterpart of `signalMatchesWait` in run-events.ts, which decides the
 * same question on delivery; a test asserts the two agree.
 */
export function answerSignalFor(match: unknown): string | undefined {
  if (typeof match !== 'object' || match === null) return DEFAULT_ANSWER_SIGNAL
  const criteria = match as {signal?: unknown; eventType?: unknown; resource?: unknown; author?: unknown}
  if (typeof criteria.signal === 'string' && criteria.signal) return criteria.signal
  if (criteria.signal !== undefined) return undefined
  const watchesActivity =
    criteria.eventType !== undefined || criteria.resource !== undefined || criteria.author !== undefined
  return watchesActivity ? undefined : DEFAULT_ANSWER_SIGNAL
}

/** What an open wait — one that named no criteria at all — is answered with. */
export const DEFAULT_ANSWER_SIGNAL = 'answer'

/** Bounds and validates a model-supplied plan/todo snapshot (shared with the update_plan tool). */
export function normalizeRunPlan(raw: unknown): RunPlanState {
  return normalizePlan(raw)
}

function normalizePlan(raw: unknown): RunPlanState {
  if (typeof raw !== 'object' || raw === null) return {steps: []}
  const record = raw as {title?: unknown; steps?: unknown}
  const steps = Array.isArray(record.steps)
    ? record.steps
        // Models routinely declare plans as bare strings; accept them as pending steps rather
        // than silently dropping them.
        .map((step) => (typeof step === 'string' ? {label: step} : step))
        .filter((step): step is Record<string, unknown> => typeof step === 'object' && step !== null)
        .slice(0, 100)
        .map((step, index) => ({
          id: typeof step.id === 'string' && step.id ? step.id : `step-${index + 1}`,
          label: typeof step.label === 'string' ? step.label.slice(0, 200) : `Step ${index + 1}`,
          status: (['pending', 'running', 'done', 'failed', 'skipped'] as const).includes(step.status as 'pending')
            ? (step.status as 'pending' | 'running' | 'done' | 'failed' | 'skipped')
            : 'pending',
        }))
    : []
  return {
    ...(typeof record.title === 'string' && record.title ? {title: record.title.slice(0, 200)} : {}),
    steps,
  }
}
