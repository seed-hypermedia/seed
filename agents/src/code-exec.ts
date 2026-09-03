/**
 * Sandboxed code execution inside an agent's memory workspace.
 *
 * Runs model-written code in a hardware-isolated microVM (the embedded `microsandbox` runtime:
 * libkrun on macOS/Linux, WHP on Windows) with the agent's memory directory bind-mounted at
 * `/workspace` as the working directory. Code therefore reads and writes the same files the
 * `memory_*` tools and the desktop Memory tab see, while the VM boundary keeps it away from the
 * host. Each execution uses a fresh ephemeral sandbox with capped CPU, memory, and wall-clock
 * duration; networking is disabled unless explicitly allowed.
 *
 * The SDK is loaded lazily and injected in tests, so the service runs fine on hosts without
 * virtualization support — the tool then fails with a clear error instead of breaking the server.
 */

import {listMemory, memoryRootPath} from '@/agent-memory'
import {recordPerf, recordPerfCount} from '@/perf'
import * as fs from 'node:fs'

/** Guest path where the agent's memory directory is mounted. */
export const EXEC_WORKSPACE_GUEST_PATH = '/workspace'
/** Maximum bytes of stdout/stderr each returned to the model. */
export const MAX_EXEC_OUTPUT_BYTES = 64 * 1024
/** Upper bound for a single execution timeout. */
export const MAX_EXEC_TIMEOUT_SECS = 300
/** Characters of recent combined output kept in live progress updates (enough for ~10 lines). */
export const EXEC_OUTPUT_TAIL_CHARS = 2000
/** Minimum interval between output-driven progress callbacks. */
export const EXEC_PROGRESS_INTERVAL_MS = 250
/**
 * Extra wall-clock past the requested timeout before the host kills the execution itself.
 *
 * The sandbox SDK gets `.timeout()` and `.maxDuration()` and normally enforces them, but a guest
 * that wedges the VM can outlive both (observed in production: a 60s-timeout compile running 150s+
 * while pinning its vCPU). The host-side deadline is the backstop that cannot be ignored: it fires
 * this grace period after the SDK's own timeout should have, kills the execution, and returns
 * whatever output was collected.
 */
export const EXEC_TIMEOUT_GRACE_MS = 5_000
/** How long sandbox teardown may take before escalating from a graceful stop to a hard kill. */
export const EXEC_TEARDOWN_TIMEOUT_MS = 5_000

/** Code-execution backend configuration. */
export type CodeExecConfig = {
  /** Execution backend. Empty string disables code execution. */
  backend: '' | 'microsandbox'
  /** OCI image for the sandbox rootfs. Must provide `python` and `/bin/sh`. */
  image: string
  /**
   * OCI image used for the `ts` runtime, which needs `bun` on PATH (default `oven/bun`).
   *
   * The main rootfs is a Python image with no JavaScript runtime in it, so `ts` runs in its own
   * image. An operator can set this explicitly empty to withhold TypeScript — the runtime is then
   * simply not offered: the tool contract the model sees lists only the runtimes this server can
   * actually run, instead of advertising one that would fail inside the sandbox.
   */
  tsImage: string
  /** Virtual CPUs per sandbox. */
  cpus: number
  /** Guest memory per sandbox in MiB. */
  memoryMib: number
  /** Default per-execution timeout in seconds. */
  timeoutSecs: number
  /** Allow outbound network access from sandboxes. */
  allowNetwork: boolean
  /** Upstream DNS nameservers for sandbox name resolution when networking is enabled. */
  dnsServers: string[]
  /** Keep microVMs alive between executions (hypermedia/agent-exec-warm-pool.md). Off by default. */
  warmPool: boolean
  /**
   * Maximum RETAINED pool entries (parked or leased pooled VMs). Not a hard cap on total live
   * VMs: same-key concurrency and lost boot races create transient single-use overflow VMs at
   * boot-per-call cost, so the cap can never make a call fail or wait.
   */
  poolMaxVms: number
  /** How long a parked VM may sit idle before it is disposed. */
  poolIdleTtlMs: number
  /**
   * Maximum age of a pooled VM, enforced only BETWEEN calls: an over-age VM is disposed at park
   * time, after its call completed — a VM can never expire while it is being used. Bounds the
   * slow cruft of a long-lived guest (unreaped zombie corpses from per-call resets, memory drift)
   * at the cost of one invisible re-boot per this interval of continuous use.
   */
  poolVmMaxAgeMs: number
  /** Override for EXEC_TIMEOUT_GRACE_MS, so tests can exercise the watchdog without real waits. */
  timeoutGraceMs?: number
  /** Override for EXEC_TEARDOWN_TIMEOUT_MS, so tests can exercise stop→kill escalation quickly. */
  teardownTimeoutMs?: number
}

/** Runtimes the execute tool can run code in. */
export type CodeExecRuntime = 'ts' | 'python' | 'shell'

/** Every runtime this build knows how to run, in the order the contract lists them. */
export const CODE_EXEC_RUNTIMES: readonly CodeExecRuntime[] = ['ts', 'python', 'shell']

/**
 * The identity an execution runs for, carried explicitly across the sandbox seam so a pooling
 * source keys VMs on typed identity — never inferred from a filesystem path, which is a
 * representation detail and not a security boundary.
 *
 * Two distinct boundaries live here:
 * - `accountId` + `agentId` are the SECURITY boundary: a sandbox must never be shared across
 *   agent instances, ever.
 * - `sessionId` is a PREDICTABILITY boundary: pooling is additionally confined to one session, so
 *   guest RAM state (installed packages, temp files, environment) from one conversation can never
 *   surface in another. A new session always starts from a cold, known-clean VM; only repeat
 *   calls within the same session get the warm one. Durable cross-session state belongs in
 *   /workspace, which is the agent's memory and survives regardless.
 */
export type ExecPrincipal = {accountId: string; agentId: string; sessionId: string}

/** One code execution request against an agent's memory workspace. */
export type CodeExecRequest = {
  /** Who this execution belongs to; sandbox reuse must never cross this identity. */
  principal: ExecPrincipal
  stateDir: string
  runtime: CodeExecRuntime
  code: string
  /** Optional timeout override in seconds, clamped to [1, MAX_EXEC_TIMEOUT_SECS]. */
  timeoutSecs?: number
  /** Called with live progress while the execution runs, so callers can show what is happening. */
  onProgress?: (progress: CodeExecProgress) => void
}

/** Live progress emitted during an execution. */
export type CodeExecProgress = {
  /** `starting` while the sandbox boots, `running` once the code is executing. */
  stage: 'starting' | 'running'
  /** Last ~EXEC_OUTPUT_TAIL_CHARS characters of combined stdout/stderr, when the backend streams output. */
  outputTail?: string
}

/** One memory file changed by an execution. */
export type CodeExecFileChange = {path: string; change: 'added' | 'modified' | 'removed'}

/** Result of a completed (or failed) code execution. */
export type CodeExecResult = {
  exitCode: number
  success: boolean
  stdout: string
  stderr: string
  /** True when stdout or stderr was cut to the size limit. */
  truncated: boolean
  durationMs: number
  /**
   * How much of `durationMs` went to booting the sandbox before any code ran. On today's
   * fresh-VM-per-call backend this is pure overhead the warm-pool workstream aims to remove;
   * exposing it per call is what lets that claim be measured instead of assumed.
   */
  bootMs: number
  /** Memory files added/modified/removed by the execution, from a before/after listing diff. */
  changedFiles: CodeExecFileChange[]
  /** Real change count; exceeds `changedFiles.length` when the reported list was capped. */
  changedFilesTotal: number
}

/** Structural slice of the microsandbox SDK used here, so tests can inject a fake. */
export type SandboxSdk = {
  Sandbox: {
    builder(name: string): SandboxBuilderLike
  }
  /**
   * Network policy factories. `fromProfiles(['public'])` (SDK >= 0.6.8) and the older `nonLocal()`
   * both mean: public internet allowed, private/link-local/metadata ranges are not.
   */
  NetworkPolicy: {
    fromProfiles?(profiles: Iterable<string>): unknown
    nonLocal?(): unknown
  }
}

/**
 * The non-local egress policy in whichever dialect the loaded SDK speaks. A staged runtime can be
 * older than the code that loads it (a packaged app updates its binary and its staged modules
 * independently), so both dialects stay supported.
 */
function nonLocalNetworkPolicy(sdk: SandboxSdk): unknown {
  const {fromProfiles, nonLocal} = sdk.NetworkPolicy
  if (typeof fromProfiles === 'function') return fromProfiles(['public'])
  if (typeof nonLocal === 'function') return nonLocal()
  throw new CodeExecError(502, 'The sandbox SDK offers no non-local network policy')
}

export type MountBuilderLike = {
  bind(host: string): MountBuilderLike
  quota(mib: number): MountBuilderLike
}

export type DnsBuilderLike = {
  nameservers(servers: string[]): DnsBuilderLike
}

export type NetworkBuilderLike = {
  enabled(enabled: boolean): NetworkBuilderLike
  dns(configure: (dns: DnsBuilderLike) => DnsBuilderLike): NetworkBuilderLike
  policy(policy: unknown): NetworkBuilderLike
}

export type SandboxBuilderLike = {
  image(image: string): SandboxBuilderLike
  cpus(count: number): SandboxBuilderLike
  memory(mib: number): SandboxBuilderLike
  workdir(path: string): SandboxBuilderLike
  ephemeral(ephemeral: boolean): SandboxBuilderLike
  security(profile: string): SandboxBuilderLike
  disableNetwork(): SandboxBuilderLike
  network(configure: (network: NetworkBuilderLike) => NetworkBuilderLike): SandboxBuilderLike
  maxDuration(secs: number): SandboxBuilderLike
  volume(guestPath: string, configure: (mount: MountBuilderLike) => MountBuilderLike): SandboxBuilderLike
  create(): Promise<SandboxLike>
}

export type ExecOptionsBuilderLike = {
  args(args: string[]): ExecOptionsBuilderLike
  timeout(ms: number): ExecOptionsBuilderLike
}

export type ExecOutputLike = {
  readonly code: number
  readonly success: boolean
  stdout(): string
  stderr(): string
}

/** Event from a streaming execution, mirroring the microsandbox `ExecEvent` shape. */
export type ExecStreamEventLike =
  | {kind: 'started'; pid: number}
  | {kind: 'stdout'; data: Uint8Array}
  | {kind: 'stderr'; data: Uint8Array}
  | {kind: 'exited'; code: number}

export type ExecStreamHandleLike = {
  recv(): Promise<ExecStreamEventLike | null>
  kill(): Promise<void>
}

export type SandboxLike = {
  execWith(cmd: string, configure: (builder: ExecOptionsBuilderLike) => ExecOptionsBuilderLike): Promise<ExecOutputLike>
  /** Streaming variant of execWith; when present, output is streamed so progress can be reported live. */
  execStreamWith?(
    cmd: string,
    configure: (builder: ExecOptionsBuilderLike) => ExecOptionsBuilderLike,
  ): Promise<ExecStreamHandleLike>
  stop(): Promise<void>
  kill(): Promise<void>
}

/** Machine-readable cause when code execution is unavailable, so clients can offer targeted help. */
export type CodeExecUnavailableCode =
  | 'config-disabled'
  | 'unsupported-platform'
  | 'whp-disabled'
  | 'kvm-missing'
  | 'kvm-forbidden'
  | 'runtime-error'

/** Result of probing whether code execution can actually work on this host. */
export type CodeExecAvailability = {
  available: boolean
  reason?: string
  code?: CodeExecUnavailableCode
  /** Runtimes this server can actually run; empty when execution is unavailable. */
  runtimes: CodeExecRuntime[]
}

/** Executes code in sandboxes for agent memory workspaces. */
export type CodeExecutor = {
  /** Whether this server is configured to offer code execution. */
  enabled: boolean
  /**
   * Runtimes this server offers, from configuration alone — no probe, so callers building a tool
   * contract can narrow its runtime enum synchronously.
   */
  runtimes: CodeExecRuntime[]
  /** Whether execution can actually work here: config, platform support, loadable runtime. Memoized. */
  availability(): Promise<CodeExecAvailability>
  execute(request: CodeExecRequest): Promise<CodeExecResult>
  /** Settles any asynchronously disposed sandboxes; shutdown and tests await it for determinism. */
  drain(): Promise<void>
}

/** Error raised for invalid execution requests or backend failures. */
export class CodeExecError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** Default public DNS resolvers used inside sandboxes when networking is enabled. */
export const DEFAULT_EXEC_DNS_SERVERS = ['1.1.1.1', '8.8.8.8']

/** Default configuration: microsandbox backend, python image (bun image for ts), network enabled with public DNS. */
export function defaultCodeExecConfig(): CodeExecConfig {
  return {
    backend: 'microsandbox',
    image: 'python',
    tsImage: 'oven/bun',
    cpus: 1,
    memoryMib: 512,
    timeoutSecs: 60,
    allowNetwork: true,
    dnsServers: DEFAULT_EXEC_DNS_SERVERS,
    warmPool: false,
    poolMaxVms: 3,
    poolIdleTtlMs: 3 * 60_000,
    poolVmMaxAgeMs: 30 * 60_000,
  }
}

/**
 * Loads the microsandbox SDK. The package is `external` in the compiled binary (its napi binding,
 * `msb` helper, and libkrunfw cannot live inside the bundle), and build-binary.ts stages it into
 * `node_modules/` next to the executable. The plain import covers dev mode and cwd-based
 * resolution; the explicit require covers the compiled binary when the bare specifier resolves
 * against the bundle's virtual filesystem instead of the staged copy.
 */
/**
 * Points MSB_PATH / MSB_LIBKRUNFW_PATH at the runtime binaries staged next to the executable.
 * In dev the napi binding finds them inside the platform package on its own; in the compiled
 * binary that package sits in the staged node_modules, and the env override is the reliable way
 * to reference it. Explicit env set by the operator always wins.
 */
const pointAtStagedRuntime = (path: typeof import('node:path'), stagedModules: string) => {
  const platformDir = path.join(stagedModules, '@superradcompany')
  if (!fs.existsSync(platformDir)) return
  for (const pkg of fs.readdirSync(platformDir)) {
    const msb = path.join(platformDir, pkg, 'bin', process.platform === 'win32' ? 'msb.exe' : 'msb')
    if (!process.env.MSB_PATH && fs.existsSync(msb)) process.env.MSB_PATH = msb
    const libDir = path.join(platformDir, pkg, 'lib')
    if (!process.env.MSB_LIBKRUNFW_PATH && fs.existsSync(libDir)) {
      const lib = fs.readdirSync(libDir).find((f) => f.startsWith('libkrunfw'))
      if (lib) process.env.MSB_LIBKRUNFW_PATH = path.join(libDir, lib)
    }
  }
}

export const loadMicrosandbox = async (): Promise<SandboxSdk> => {
  const path = await import('node:path')
  const stagedModules = path.join(path.dirname(process.execPath), 'node_modules')
  try {
    if (fs.existsSync(stagedModules)) pointAtStagedRuntime(path, stagedModules)
    return (await import('microsandbox')) as unknown as SandboxSdk
  } catch (importError) {
    // The package declares only an `import` export condition, so the staged copy must be loaded
    // by file URL (bare-specifier resolution inside the compiled binary stops at the bundle).
    try {
      const {pathToFileURL} = await import('node:url')
      const staged = path.join(stagedModules, 'microsandbox', 'dist', 'index.js')
      return (await import(pathToFileURL(staged).href)) as unknown as SandboxSdk
    } catch {
      throw importError
    }
  }
}

/** What an execution needs from a sandbox, whatever provides it. */
export type SandboxSpec = {
  /**
   * SECURITY: the identity a pooling source MUST key sandbox reuse on (together with `image`).
   * Two different principals may never receive the same VM; a test must prove it before any
   * pooling source ships.
   */
  principal: ExecPrincipal
  /** OCI image for the rootfs (already runtime-resolved: tsImage for ts, image otherwise). */
  image: string
  /** Host path of the agent's memory directory, bind-mounted at the workspace guest path. */
  memoryRoot: string
  /**
   * This call's execution timeout. The boot-per-call source derives the VM's max lifetime from it
   * (the VM exists for exactly one call); a pooling source must NOT — pooled VM lifetime is the
   * source's own policy (idle TTL, caps), decoupled from any single call's timeout.
   */
  timeoutSecs: number
}

/**
 * A sandbox on loan for one execution. `release` MUST be called exactly once, success or failure;
 * `healthy: false` tells the source the guest may be wedged (a watchdog kill, an SDK error) so it
 * is disposed rather than ever handed out again.
 */
export type SandboxLease = {
  sandbox: SandboxLike
  /** Milliseconds spent booting; 0 once a pooling source hands out a warm sandbox. */
  bootMs: number
  /** True when the lease reused a live sandbox instead of booting one. */
  reused: boolean
  release(opts: {healthy: boolean}): Promise<void>
}

/**
 * Where executions get their sandboxes — the seam the warm-pool workstream implements
 * (hypermedia/agent-exec-warm-pool.md). The default source boots a fresh microVM per lease and tears it down
 * on release, which is exactly the historical behavior; a pooling source can keep healthy
 * sandboxes alive between leases without the execute path changing at all.
 *
 * Contract every source must honor:
 * - A sandbox is on loan to at most one lease at a time — never double-leased. Concurrent
 *   acquires for the same (principal, image) either queue or get distinct VMs.
 * - `release` may return fast (parking is not teardown); actual disposal can drain
 *   asynchronously. `drain` is where that debt is settled, so shutdown and tests stay
 *   deterministic.
 * - A reused sandbox must be reset before it is handed out again (no processes or guest temp
 *   state from the previous call), per the reset-before-park contract in the pool design.
 */
export type SandboxSource = {
  acquire(spec: SandboxSpec): Promise<SandboxLease>
  /** Resolves when every asynchronously disposed sandbox has finished tearing down. */
  drain(): Promise<void>
}

/** Builds a source from executor internals; injectable so tests can substitute a fake source. */
export type SandboxSourceFactory = (config: CodeExecConfig, getSdk: () => Promise<SandboxSdk>) => SandboxSource

/** Boots one microVM for a spec, with the max lifetime the calling source chose. */
async function bootSandboxVm(
  config: CodeExecConfig,
  getSdk: () => Promise<SandboxSdk>,
  spec: SandboxSpec,
  maxDurationSecs: number,
): Promise<{sandbox: SandboxLike; bootMs: number}> {
  const sdk = await getSdk()
  const bootStartedAt = Date.now()
  let sandbox: SandboxLike
  try {
    let builder = sdk.Sandbox.builder(`seed-exec-${crypto.randomUUID().slice(0, 13)}`)
      .image(spec.image)
      .cpus(config.cpus)
      .memory(config.memoryMib)
      .workdir(EXEC_WORKSPACE_GUEST_PATH)
      .ephemeral(true)
      .security('restricted')
      .maxDuration(maxDurationSecs)
      .volume(EXEC_WORKSPACE_GUEST_PATH, (mount) => mount.bind(spec.memoryRoot))
    if (config.allowNetwork) {
      // Enable networking with explicit public DNS (the guest has no resolver otherwise) and a
      // non-local policy so code can reach the public internet but not the host's private
      // network or cloud metadata endpoints.
      const dnsServers = config.dnsServers.length ? config.dnsServers : DEFAULT_EXEC_DNS_SERVERS
      builder = builder.network((network) =>
        network
          .enabled(true)
          .dns((dns) => dns.nameservers(dnsServers))
          .policy(nonLocalNetworkPolicy(sdk)),
      )
    } else {
      builder = builder.disableNetwork()
    }
    sandbox = await builder.create()
  } catch (error) {
    throw new CodeExecError(
      502,
      `Could not start the code sandbox: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  const bootMs = Date.now() - bootStartedAt
  recordPerf('exec.boot', bootMs)
  return {sandbox, bootMs}
}

/** The default source: one fresh ephemeral microVM per lease, torn down on release. */
export const createBootPerCallSource: SandboxSourceFactory = (config, getSdk) => {
  return {
    // Teardown here is awaited inside release, so there is never an async disposal to drain.
    drain: async () => {},
    async acquire(spec) {
      // The VM exists for exactly one call, so its lifetime derives from that call's timeout.
      const {sandbox, bootMs} = await bootSandboxVm(config, getSdk, spec, spec.timeoutSecs + 30)
      return {
        sandbox,
        bootMs,
        reused: false,
        async release() {
          // Fresh-per-call disposes unconditionally; only a pooling source acts on `healthy`.
          const teardownStartedAt = Date.now()
          await teardownSandbox(sandbox, config.teardownTimeoutMs ?? EXEC_TEARDOWN_TIMEOUT_MS)
          recordPerf('exec.teardown', Date.now() - teardownStartedAt)
        },
      }
    },
  }
}

/** How long a guest health probe may take before the VM is judged wedged and disposed. */
export const POOL_GUEST_EXEC_TIMEOUT_MS = 2_000

/**
 * How long the park reset may take. Its own, larger budget: the reset is a bounded FIVE-pass
 * /proc sweep whose passes slow down exactly when a guest is crowded — observed live: a 3-chain
 * respawn storm pushed the sweep past a 2s budget, so the deadline fired before the script could
 * deliver its designated exit-1 verdict and the disposal was misattributed to a transport error.
 * The budget must comfortably contain a worst-case full sweep so 'fail' (the guest's own verdict)
 * and 'error' (a genuinely broken exchange) stay distinguishable.
 */
export const POOL_GUEST_RESET_TIMEOUT_MS = 15_000

/**
 * SDK max duration handed to pooled VMs: a last-resort backstop against pool-bookkeeping bugs (a
 * lost entry or timer), far beyond anything age/TTL policy allows, so the hypervisor can never
 * kill a VM that is actually in use.
 */
export const POOL_VM_SDK_MAX_DURATION_SECS = 24 * 3600

/**
 * The warm pool (hypermedia/agent-exec-warm-pool.md): keeps one VM alive per (principal, image) between
 * executions so repeat calls skip the boot entirely and the guest keeps its warm state.
 *
 * Invariants, per the reviewed seam contract:
 * - Reuse is keyed on typed principal identity plus image; a VM never crosses that key. The
 *   principal includes the sessionId, so reuse is session-scoped: agent isolation is the security
 *   boundary, session isolation is the predictability boundary — a conversation only ever sees
 *   warm state its own calls created.
 * - A VM is on loan to at most one lease. The parked entry is locked (`leased = true`)
 *   synchronously — before any await — so interleaved acquires cannot double-lease it; a
 *   same-key acquire while the VM is out gets a single-use overflow VM instead.
 * - Reset before park: release runs the fail-closed multi-pass /proc sweep (GUEST_RESET_SCRIPT
 *   below) until a full pass proves the guest empty; a failed reset disposes the VM. Reuse is
 *   additionally gated on a health probe, so a VM that died while parked is replaced, not handed out.
 * - An unhealthy release always disposes; a wedged VM is never parked.
 * - Pooled VM lifetime is pool policy (`poolVmMaxAgeMs`, idle TTL, LRU cap eviction) — never
 *   derived from any single call's timeout, and never enforced mid-use: age is checked only at
 *   park time, so an over-age VM always finishes its call and is then recycled. The SDK max
 *   duration is a distant backstop (POOL_VM_SDK_MAX_DURATION_SECS) no real workload reaches.
 * - Disposal is asynchronous (off the tool call's critical path); `drain` settles it.
 *
 * The `poolMaxVms` cap bounds pooled VMs; overflow VMs are transient extras, exactly as costly as
 * today's boot-per-call behavior, so the cap can never make a call fail.
 */
export const createWarmPoolSource: SandboxSourceFactory = (config, getSdk) => {
  type PoolEntry = {
    key: string
    sandbox: SandboxLike
    bootedAt: number
    lastParkedAt: number
    leased: boolean
    idleTimer?: ReturnType<typeof setTimeout>
  }
  const entries = new Map<string, PoolEntry>()
  const disposals = new Set<Promise<void>>()
  const teardownMs = config.teardownTimeoutMs ?? EXEC_TEARDOWN_TIMEOUT_MS

  // JSON keeps the parts unambiguous no matter what characters ids ever contain. sessionId is in
  // the key on purpose: reuse is confined to one session (see ExecPrincipal), so a session's VM
  // is its own and a new session always boots clean.
  const keyOf = (spec: SandboxSpec): string =>
    JSON.stringify([spec.principal.accountId, spec.principal.agentId, spec.principal.sessionId, spec.image])

  /**
   * SECURITY: the pool key is only sound when every part is a real identifier. Types promise
   * that, but a plain-JavaScript caller can pass undefined/null/'' — and JSON.stringify maps
   * undefined and null to the SAME serialized entry, so two malformed "identities" would collide
   * into one retained-VM key (found by ion's session-delta review). A malformed principal
   * therefore never touches the pool at all: the execution falls back to a single-use VM, which
   * cannot be shared with anyone.
   */
  const validId = (value: unknown): boolean => typeof value === 'string' && value.length > 0
  const validPrincipal = (spec: SandboxSpec): boolean =>
    validId(spec.principal?.accountId) && validId(spec.principal?.agentId) && validId(spec.principal?.sessionId)

  const disposeSandbox = (sandbox: SandboxLike): void => {
    const teardownStartedAt = Date.now()
    let done: Promise<void>
    done = teardownSandbox(sandbox, teardownMs).finally(() => {
      recordPerf('exec.teardown', Date.now() - teardownStartedAt)
      disposals.delete(done)
    })
    disposals.add(done)
  }

  const disposeEntry = (entry: PoolEntry): void => {
    if (entry.idleTimer) clearTimeout(entry.idleTimer)
    if (entries.get(entry.key) === entry) entries.delete(entry.key)
    disposeSandbox(entry.sandbox)
  }

  /**
   * Runs a short shell script in the guest. `ok` = exit 0; `fail` = the script itself concluded
   * failure (its designated exit 1 — for the reset, pass-budget exhaustion); `error` = the
   * exchange broke (exception, deadline, or any other exit code, e.g. a shell parse error) — so
   * counters can attribute a disposal to the guest's verdict versus transport trouble.
   */
  const guestExec = async (
    sandbox: SandboxLike,
    script: string,
    budgetMs: number,
  ): Promise<'ok' | 'fail' | 'error'> => {
    const deadline = createDeadline(budgetMs + 500)
    try {
      const outcome = await raceDeadline(
        sandbox.execWith('/bin/sh', (builder) => builder.args(['-c', script]).timeout(budgetMs)),
        deadline.promise,
      )
      if (outcome === EXEC_DEADLINE) return 'error'
      if (outcome.success) return 'ok'
      return outcome.code === 1 ? 'fail' : 'error'
    } catch {
      return 'error'
    } finally {
      deadline.clear()
    }
  }
  /**
   * Kills everything a call left running before the VM parks, and PROVES it. An explicit /proc
   * sweep because the broadcast form is not portable: the guest's dash builtin rejects
   * `kill -9 -1` AND `kill -9 -- -1` ("Illegal number") — both observed against a real guest,
   * where the sweep silently killed nothing.
   *
   * A single sweep has a fork race: a process forking after the glob expanded leaves a child the
   * pass never visits. So the sweep repeats, each pass re-expanding /proc, until one full pass
   * proves EVERY snapshot entry is spared, a zombie, or a kernel thread — at that scan there was
   * no non-spared process left to fork, so the VM is verifiably empty. The pass is FAIL-CLOSED:
   * an entry that is unreadable, vanished mid-pass, or unparseable marks the pass dirty (and gets
   * a kill attempt anyway) — a vanished parent may have forked before exiting, so its
   * disappearance is grounds for another pass, never for trust. A guest still dirtying passes
   * after the budget (a fork storm) fails the reset and the VM is disposed instead of parked: the
   * contract is "verified empty or destroyed", never "probably clean".
   *
   * Excluded from dirtiness: pid 1 (the guest supervisor), the sweeping shell and its ancestor
   * chain (the exec session's plumbing), kernel threads (PF_KTHREAD flag in /proc/pid/stat;
   * SIGKILL is a no-op on them), and PROVEN zombies. A zombie is only proven by two snapshots: a
   * process can fork after the glob expanded and die before its stat is read, so a Z on FIRST
   * observation may have children this pass's snapshot never saw — it dirties the pass, and is
   * spared only once it was already a zombie in the prior complete pass (dead at that scan, so it
   * cannot have forked since). The proof binds PROCESS IDENTITY, pid + starttime (stat field 22),
   * not pid alone: a reaped corpse's pid can be reused by a new process between passes, and the
   * impostor must not inherit the corpse's proof. Killed daemons linger as `State: Z` corpses
   * because init.krun reaps lazily (verified against a real guest); a proven zombie runs nothing
   * and cannot fork, and persistent corpses cost one extra pass on their first reset, not one per
   * pass.
   *
   * Parsing is delimiter-safe against hostile process names: stat is flattened (`tr '\n' ' '`)
   * before the greedy comm strip, so a comm containing newlines or ") " cannot truncate or desync
   * the parse — and if anything still fails to parse, the entry is dirty, not skipped.
   */
  const GUEST_RESET_SCRIPT = [
    'keep=" 1 $$ "',
    'p=$$',
    'while :; do',
    '  pp=$(grep "^PPid:" /proc/$p/status 2>/dev/null | cut -f2)',
    '  case "$pp" in ""|0|1|$p) break;; esac',
    '  keep="$keep$pp "',
    '  p=$pp',
    'done',
    'prevz=""',
    'pass=0',
    'while [ $pass -lt 5 ]; do',
    '  pass=$((pass+1))',
    '  dirty=0',
    '  curz=""',
    '  for f in /proc/[0-9]*; do',
    '    pid=${f#/proc/}',
    '    case "$keep" in *" $pid "*) continue;; esac',
    // Flatten, then strip "pid (comm) " greedily to the comm's true closing paren. Fields then:
    // state ppid pgrp session tty tpgid flags …; PF_KTHREAD = 0x00200000.
    '    line=$(tr "\\n" " " < "$f/stat" 2>/dev/null | sed "s/^[0-9]* (.*) //")',
    '    ok=1',
    '    [ -z "$line" ] && ok=0',
    '    if [ "$ok" -eq 1 ]; then',
    '      set -- $line',
    '      state=$1',
    '      flags=$7',
    '      case "$flags" in ""|*[!0-9]*) ok=0;; esac',
    '    fi',
    '    if [ "$ok" -eq 1 ]; then',
    '      if [ "$state" = "Z" ]; then',
    // Two-snapshot zombie proof, keyed by process identity (pid + starttime, stripped field 20 =
    // stat field 22) so a reused pid cannot inherit a reaped corpse's proof. An unreadable
    // starttime falls through to the dirty path like any other ambiguity.
    '        shift 19',
    '        start=$1',
    '        case "$start" in ""|*[!0-9]*) ;; *)',
    '          curz="$curz $pid:$start "',
    '          case "$prevz" in *" $pid:$start "*) continue;; esac',
    '        ;; esac',
    '        dirty=$((dirty+1))',
    '        continue',
    '      fi',
    '      [ $((flags & 2097152)) -ne 0 ] && continue',
    '    fi',
    '    dirty=$((dirty+1))',
    '    kill -9 "$pid" 2>/dev/null',
    '  done',
    '  prevz=$curz',
    '  [ "$dirty" -eq 0 ] && exit 0',
    'done',
    'exit 1',
  ].join('\n')
  const resetGuest = (sandbox: SandboxLike) => guestExec(sandbox, GUEST_RESET_SCRIPT, POOL_GUEST_RESET_TIMEOUT_MS)
  const probeGuest = async (sandbox: SandboxLike) =>
    (await guestExec(sandbox, 'exit 0', POOL_GUEST_EXEC_TIMEOUT_MS)) === 'ok'

  const pooledLease = (entry: PoolEntry, bootMs: number, reused: boolean): SandboxLease => {
    let released = false
    return {
      sandbox: entry.sandbox,
      bootMs,
      reused,
      async release({healthy}) {
        if (released) return
        released = true
        if (!healthy) {
          disposeEntry(entry)
          return
        }
        // Generational recycle, between calls only: an over-age VM is disposed here — after its
        // call completed, never before or during one — so expiry can never interrupt work. This
        // pre-reset check just skips a pointless (up to 15s) reset for a VM already past its age.
        if (Date.now() - entry.bootedAt > config.poolVmMaxAgeMs) {
          recordPerfCount('exec.pool_recycled')
          disposeEntry(entry)
          return
        }
        // Reset before park: nothing from this call may still be running when the VM is next
        // handed out. A guest that cannot prove itself empty (or run the reset at all) is
        // disposed; the split counters attribute the disposal — pass-budget exhaustion (the
        // guest's own verdict) versus a broken exchange — distinguishable from every other path.
        const resetOutcome = await resetGuest(entry.sandbox)
        if (resetOutcome !== 'ok') {
          recordPerfCount(resetOutcome === 'fail' ? 'exec.pool_reset_exhausted' : 'exec.pool_reset_error')
          disposeEntry(entry)
          return
        }
        // Age is THE park gate, so it is rechecked after the reset (ion's park-boundary finding):
        // the reset itself can run long enough for a just-under-age VM to cross the limit, and
        // with the acquire-time gate intentionally gone, parking here would let an over-age VM
        // serve one more full call before recycling.
        if (Date.now() - entry.bootedAt > config.poolVmMaxAgeMs) {
          recordPerfCount('exec.pool_recycled')
          disposeEntry(entry)
          return
        }
        entry.leased = false
        entry.lastParkedAt = Date.now()
        entry.idleTimer = setTimeout(() => {
          if (!entry.leased && entries.get(entry.key) === entry) disposeEntry(entry)
        }, config.poolIdleTtlMs)
        entry.idleTimer.unref?.()
      },
    }
  }

  const overflowLease = (sandbox: SandboxLike, bootMs: number): SandboxLease => {
    let released = false
    return {
      sandbox,
      bootMs,
      reused: false,
      async release() {
        if (released) return
        released = true
        disposeSandbox(sandbox)
      },
    }
  }

  return {
    async acquire(spec) {
      if (!validPrincipal(spec)) {
        // Fail closed: no pooling for an identity we cannot trust — single-use VM, never parked.
        recordPerfCount('exec.pool_invalid_principal')
        const {sandbox, bootMs} = await bootSandboxVm(config, getSdk, spec, spec.timeoutSecs + 30)
        return overflowLease(sandbox, bootMs)
      }
      const key = keyOf(spec)
      const existing = entries.get(key)
      if (existing && !existing.leased) {
        // Lock before the first await so an interleaved same-key acquire can never double-lease.
        existing.leased = true
        if (existing.idleTimer) clearTimeout(existing.idleTimer)
        if (await probeGuest(existing.sandbox)) {
          recordPerfCount('exec.pool_hit')
          return pooledLease(existing, 0, true)
        }
        recordPerfCount('exec.pool_probe_failed')
        disposeEntry(existing)
      }
      if (entries.get(key)?.leased === true) {
        // The key's VM is out on another call: single-use VM, today's boot-per-call economics.
        recordPerfCount('exec.pool_overflow')
        const {sandbox, bootMs} = await bootSandboxVm(config, getSdk, spec, spec.timeoutSecs + 30)
        return overflowLease(sandbox, bootMs)
      }
      // Make room under the cap by evicting the least-recently parked idle VM.
      while (entries.size >= config.poolMaxVms) {
        let oldest: PoolEntry | undefined
        for (const entry of entries.values()) {
          if (!entry.leased && (oldest === undefined || entry.lastParkedAt < oldest.lastParkedAt)) oldest = entry
        }
        if (!oldest) break
        disposeEntry(oldest)
      }
      const {sandbox, bootMs} = await bootSandboxVm(config, getSdk, spec, POOL_VM_SDK_MAX_DURATION_SECS)
      if (entries.has(key) || entries.size >= config.poolMaxVms) {
        // Lost a boot race for this key, or every slot filled while booting: stay single-use.
        // Counted as overflow — the counters classify what a VM BECAME, not what was hoped for.
        recordPerfCount('exec.pool_overflow')
        return overflowLease(sandbox, bootMs)
      }
      recordPerfCount('exec.pool_miss')
      const entry: PoolEntry = {key, sandbox, bootedAt: Date.now(), lastParkedAt: 0, leased: true}
      entries.set(key, entry)
      return pooledLease(entry, bootMs, false)
    },
    async drain() {
      while (disposals.size > 0) await Promise.allSettled([...disposals])
    },
  }
}

/** Selects the sandbox source the configuration asks for. */
export const createConfiguredSandboxSource: SandboxSourceFactory = (config, getSdk) =>
  config.warmPool ? createWarmPoolSource(config, getSdk) : createBootPerCallSource(config, getSdk)

/**
 * Creates the code executor for a service. `loadSdk` is injectable for tests; the real SDK is
 * imported lazily on first execution so unsupported hosts only fail when the tool is used.
 */
export function createCodeExecutor(
  config: CodeExecConfig,
  loadSdk: () => Promise<SandboxSdk> = loadMicrosandbox,
  createSource: SandboxSourceFactory = createConfiguredSandboxSource,
): CodeExecutor {
  let sdkPromise: Promise<SandboxSdk> | undefined
  const getSdk = () => {
    sdkPromise ??= loadSdk().catch((error: unknown) => {
      sdkPromise = undefined
      throw new CodeExecError(
        502,
        `Code execution backend is unavailable on this server: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    })
    return sdkPromise
  }

  const source = createSource(config, getSdk)

  // Availability cannot change during the process lifetime (platform, staged runtime, config are
  // all fixed at startup), so the probe result is memoized including failures.
  let availabilityPromise: Promise<CodeExecAvailability> | undefined
  const configuredRuntimes: CodeExecRuntime[] =
    config.backend === 'microsandbox'
      ? CODE_EXEC_RUNTIMES.filter((runtime) => runtime !== 'ts' || !!config.tsImage)
      : []
  const unavailable = (code: CodeExecUnavailableCode, reason: string): CodeExecAvailability => ({
    available: false,
    code,
    reason,
    runtimes: [],
  })
  const probeAvailability = async (): Promise<CodeExecAvailability> => {
    if (config.backend !== 'microsandbox') {
      return unavailable('config-disabled', 'Code execution is disabled by configuration')
    }
    if (process.platform === 'darwin' && process.arch !== 'arm64') {
      return unavailable('unsupported-platform', 'microsandbox has no native build for Intel macOS')
    }
    if (process.platform === 'win32') {
      // WinHvPlatform.dll is installed with the "Windows Hypervisor Platform" optional feature,
      // which microVMs require. Its absence is the actionable signal the desktop UI explains.
      const winHv = `${process.env.SystemRoot ?? 'C:\\Windows'}\\System32\\WinHvPlatform.dll`
      if (!fs.existsSync(winHv)) {
        return unavailable('whp-disabled', 'The Windows Hypervisor Platform feature is turned off on this PC')
      }
    }
    if (process.platform === 'linux') {
      if (!fs.existsSync('/dev/kvm')) {
        return unavailable('kvm-missing', 'KVM (/dev/kvm) is not available on this host')
      }
      try {
        fs.accessSync('/dev/kvm', fs.constants.R_OK | fs.constants.W_OK)
      } catch {
        return unavailable(
          'kvm-forbidden',
          'No permission to use /dev/kvm — add this user to the kvm group and log in again',
        )
      }
    }
    try {
      await getSdk()
      return {available: true, runtimes: configuredRuntimes}
    } catch (error) {
      return unavailable('runtime-error', error instanceof Error ? error.message : String(error))
    }
  }

  return {
    enabled: config.backend === 'microsandbox',
    runtimes: configuredRuntimes,
    availability: () => (availabilityPromise ??= probeAvailability()),
    drain: () => source.drain(),
    async execute(request) {
      if (config.backend !== 'microsandbox') {
        throw new CodeExecError(400, 'Code execution is not enabled on this server')
      }
      const code = typeof request.code === 'string' ? request.code : ''
      if (!code.trim()) throw new CodeExecError(400, 'Code is required')
      if (!configuredRuntimes.includes(request.runtime)) {
        throw new CodeExecError(
          400,
          request.runtime === 'ts'
            ? 'The ts runtime needs a sandbox image with bun on PATH; this server has none configured'
            : `Runtime must be one of: ${configuredRuntimes.join(', ')}`,
        )
      }
      const timeoutSecs = Math.max(1, Math.min(MAX_EXEC_TIMEOUT_SECS, request.timeoutSecs ?? config.timeoutSecs))

      const memoryRoot = memoryRootPath(request.stateDir)
      fs.mkdirSync(memoryRoot, {recursive: true})
      const before = snapshotMemory(request.stateDir)

      const startedAt = Date.now()
      request.onProgress?.({stage: 'starting'})
      const lease = await source.acquire({
        principal: request.principal,
        // TypeScript runs in its own image: the default rootfs carries python and a shell, not bun.
        image: request.runtime === 'ts' ? config.tsImage : config.image,
        memoryRoot,
        timeoutSecs,
      })

      // Assume wedged until the exchange completes normally, so every early exit (SDK error,
      // watchdog kill) disposes the sandbox instead of ever letting a pool source reuse it.
      let healthy = false
      try {
        const command = runtimeCommand(request.runtime, code)
        request.onProgress?.({stage: 'running'})
        const runStartedAt = Date.now()
        // The SDK gets the timeout too, but a wedged guest can outlive it; this deadline is the
        // host-side backstop that always fires.
        const deadlineMs = timeoutSecs * 1000 + (config.timeoutGraceMs ?? EXEC_TIMEOUT_GRACE_MS)
        let output: RawExecResult
        try {
          output = lease.sandbox.execStreamWith
            ? await runStreamingExec(lease.sandbox, command, timeoutSecs, deadlineMs, request.onProgress)
            : await runBufferedExec(lease.sandbox, command, timeoutSecs, deadlineMs)
        } catch (error) {
          throw new CodeExecError(
            502,
            `Code execution failed: ${error instanceof Error ? error.message : String(error)}`,
          )
        }
        // Synthesized -1 means the exchange never got a real exit status (watchdog kill, vanished
        // stream) — the guest may be wedged. Any genuine exit code, zero or not, is a healthy VM.
        healthy = output.code >= 0
        recordPerf('exec.run', Date.now() - runStartedAt)
        const stdout = boundOutput(output.stdout)
        const stderr = boundOutput(output.stderr)
        const after = snapshotMemory(request.stateDir)
        const durationMs = Date.now() - startedAt
        recordPerf('exec.total', durationMs)
        return {
          exitCode: output.code,
          success: output.success,
          stdout: stdout.text,
          stderr: stderr.text,
          truncated: stdout.truncated || stderr.truncated,
          durationMs,
          bootMs: lease.bootMs,
          ...diffMemory(before.files, after.files),
        }
      } finally {
        await lease.release({healthy})
      }
    },
  }
}

type RawExecResult = {code: number; success: boolean; stdout: string; stderr: string}

type ExecCommand = {cmd: string; args: string[]}

/**
 * How each runtime runs a program. Nothing goes through a shell unless the runtime IS the shell —
 * the sandbox takes an argv array, so code with quotes, newlines, or `$` needs no escaping.
 */
function runtimeCommand(runtime: CodeExecRuntime, code: string): ExecCommand {
  if (runtime === 'python') return {cmd: 'python', args: ['-c', code]}
  if (runtime === 'ts') return {cmd: 'bun', args: ['-e', code]}
  return {cmd: '/bin/sh', args: ['-c', code]}
}

// ------------------------------------------------------------------------------------------------
// Lambda tools
// ------------------------------------------------------------------------------------------------

/**
 * Marks the line carrying a lambda's return value.
 *
 * The result travels on stdout rather than in a file because a file would have to live somewhere:
 * `/workspace` IS the agent's memory (a tool call would litter it, and show up in `changedFiles`),
 * and anywhere else vanishes with the ephemeral sandbox before a second exec could read it. A
 * marked line keeps ordinary `print`/`console.log` debugging working — everything unmarked comes
 * back as the call's logs.
 */
export const LAMBDA_RESULT_PREFIX = '__SEED_TOOL_RESULT__'

/** Runtimes an authored lambda tool can be written in. */
export type LambdaRuntime = 'ts' | 'python'

/**
 * Wraps a lambda tool's source into a self-contained program for its runtime, with the call's
 * input baked in as a literal. See tool-documents.ts for the ABI this implements.
 *
 * TypeScript is loaded as a module from a `data:` URL so the source keeps its natural
 * `export default` shape (and its type annotations) without ever touching the filesystem; Python
 * is concatenated ahead of an epilogue that calls its `main`.
 */
export function buildLambdaProgram(runtime: LambdaRuntime, source: string, input: unknown): string {
  // JSON.stringify twice: the inner call renders the value, the outer makes it a string literal
  // that is valid in both languages, so no interpolation can escape into code.
  const inputLiteral = JSON.stringify(JSON.stringify(input ?? null))
  if (runtime === 'python') {
    return [
      source,
      '',
      'import json as __seed_json',
      `__seed_input = __seed_json.loads(${inputLiteral})`,
      'if not callable(globals().get("main")):',
      '    raise SystemExit("This python tool must define a top-level main(input) function")',
      '__seed_result = main(__seed_input)',
      // `async def main` is a natural thing to write, and awaiting it here costs one import.
      'import inspect as __seed_inspect',
      'if __seed_inspect.iscoroutine(__seed_result):',
      '    import asyncio as __seed_asyncio',
      '    __seed_result = __seed_asyncio.run(__seed_result)',
      `print("${LAMBDA_RESULT_PREFIX}" + __seed_json.dumps(__seed_result))`,
      '',
    ].join('\n')
  }
  const sourceUrl = `data:text/typescript;base64,${Buffer.from(source, 'utf8').toString('base64')}`
  return [
    `const __seedInput = JSON.parse(${inputLiteral})`,
    `const __seedModule = await import(${JSON.stringify(sourceUrl)})`,
    'const __seedEntry = __seedModule.default',
    'if (typeof __seedEntry !== "function") {',
    '  throw new Error("This TypeScript tool must `export default` a function taking its input")',
    '}',
    'const __seedResult = await __seedEntry(__seedInput)',
    `console.log(${JSON.stringify(LAMBDA_RESULT_PREFIX)} + JSON.stringify(__seedResult ?? null))`,
    '',
  ].join('\n')
}

/**
 * Splits a lambda run's stdout into its returned value and everything it printed along the way.
 * `result` is absent when the program never marked a result line — a tool that exited cleanly
 * without returning, which the caller reports rather than guessing at.
 */
export function parseLambdaResult(stdout: string): {result?: unknown; hasResult: boolean; logs: string} {
  const lines = stdout.split('\n')
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]!
    if (!line.startsWith(LAMBDA_RESULT_PREFIX)) continue
    const payload = line.slice(LAMBDA_RESULT_PREFIX.length)
    const logs = [...lines.slice(0, index), ...lines.slice(index + 1)].join('\n').trim()
    try {
      return {result: JSON.parse(payload) as unknown, hasResult: true, logs}
    } catch {
      // A result line that is not JSON means the tool printed something past the marker; treat the
      // run as resultless rather than silently handing the model a mangled value.
      return {hasResult: false, logs: stdout.trim()}
    }
  }
  return {hasResult: false, logs: stdout.trim()}
}

/**
 * A deadline the exec runners race against. `promise` resolves to the sentinel when the timer
 * fires; `clear` stops the timer so a finished exec does not hold the process open.
 */
const EXEC_DEADLINE = Symbol('exec-deadline')

function createDeadline(ms: number): {promise: Promise<typeof EXEC_DEADLINE>; clear: () => void} {
  let timer: ReturnType<typeof setTimeout> | undefined
  const promise = new Promise<typeof EXEC_DEADLINE>((resolve) => {
    timer = setTimeout(() => resolve(EXEC_DEADLINE), ms)
  })
  return {promise, clear: () => clearTimeout(timer)}
}

/**
 * Races a pending SDK call against the deadline. The loser is left to settle on its own; its
 * rejection (if any) is marked handled so an already-abandoned exec cannot crash the process.
 */
function raceDeadline<T>(
  pending: Promise<T>,
  deadline: Promise<typeof EXEC_DEADLINE>,
): Promise<T | typeof EXEC_DEADLINE> {
  pending.catch(() => {})
  return Promise.race([pending, deadline])
}

/** The result handed back when the host watchdog had to kill an execution. */
function timedOutResult(timeoutSecs: number, stdout: string, stderr: string): RawExecResult {
  const note = `[execution killed by the server: it exceeded its ${timeoutSecs}s timeout and the sandbox did not stop it]`
  return {code: -1, success: false, stdout, stderr: stderr ? `${stderr}\n${note}` : note}
}

async function runBufferedExec(
  sandbox: SandboxLike,
  command: ExecCommand,
  timeoutSecs: number,
  deadlineMs: number,
): Promise<RawExecResult> {
  const deadline = createDeadline(deadlineMs)
  try {
    const output = await raceDeadline(
      sandbox.execWith(command.cmd, (builder) => builder.args(command.args).timeout(timeoutSecs * 1000)),
      deadline.promise,
    )
    if (output === EXEC_DEADLINE) return timedOutResult(timeoutSecs, '', '')
    return {code: output.code, success: output.success, stdout: output.stdout(), stderr: output.stderr()}
  } finally {
    deadline.clear()
  }
}

/**
 * Runs the command through the streaming exec API, reporting a throttled tail of combined output
 * through `onProgress` as chunks arrive. The whole exchange — handle creation included — races the
 * host-side deadline; when it fires the execution is killed and the collected output returned.
 */
async function runStreamingExec(
  sandbox: SandboxLike,
  command: ExecCommand,
  timeoutSecs: number,
  deadlineMs: number,
  onProgress?: (progress: CodeExecProgress) => void,
): Promise<RawExecResult> {
  const deadline = createDeadline(deadlineMs)
  try {
    const handle = await raceDeadline(
      sandbox.execStreamWith!(command.cmd, (builder) => builder.args(command.args).timeout(timeoutSecs * 1000)),
      deadline.promise,
    )
    if (handle === EXEC_DEADLINE) return timedOutResult(timeoutSecs, '', '')
    const stdout = createOutputCollector()
    const stderr = createOutputCollector()
    const tailDecoders = {stdout: new TextDecoder(), stderr: new TextDecoder()}
    let tail = ''
    let exitCode: number | null = null
    let lastProgressAt = 0
    for (;;) {
      const event = await raceDeadline(handle.recv(), deadline.promise)
      if (event === EXEC_DEADLINE) {
        // The kill is bounded too: it talks to the same wedged SDK the deadline just caught.
        await settlesWithin(handle.kill(), EXEC_TEARDOWN_TIMEOUT_MS)
        return timedOutResult(timeoutSecs, stdout.text(), stderr.text())
      }
      if (event === null) break
      if (event.kind === 'stdout' || event.kind === 'stderr') {
        ;(event.kind === 'stdout' ? stdout : stderr).push(event.data)
        tail = (tail + tailDecoders[event.kind].decode(event.data, {stream: true})).slice(-EXEC_OUTPUT_TAIL_CHARS)
        const now = Date.now()
        if (onProgress && now - lastProgressAt >= EXEC_PROGRESS_INTERVAL_MS) {
          lastProgressAt = now
          onProgress({stage: 'running', outputTail: tail})
        }
      } else if (event.kind === 'exited') {
        exitCode = event.code
      }
    }
    if (exitCode === null) {
      // The stream ended without an exit status, e.g. the exec timeout killed the process.
      const note = '[execution ended without an exit status — likely timed out]'
      const stderrText = stderr.text()
      return {code: -1, success: false, stdout: stdout.text(), stderr: stderrText ? `${stderrText}\n${note}` : note}
    }
    return {code: exitCode, success: exitCode === 0, stdout: stdout.text(), stderr: stderr.text()}
  } finally {
    deadline.clear()
  }
}

/**
 * Stops the sandbox without letting teardown block the tool call: a graceful stop gets
 * EXEC_TEARDOWN_TIMEOUT_MS, then the VM is killed outright. A kill that itself hangs is abandoned
 * — the result must reach the model even if the SDK has wedged.
 */
async function teardownSandbox(sandbox: SandboxLike, timeoutMs: number): Promise<void> {
  if (await settlesWithin(sandbox.stop(), timeoutMs)) return
  await settlesWithin(sandbox.kill(), timeoutMs)
}

/** True when the promise fulfills within the window; false on rejection or timeout. Never throws. */
async function settlesWithin(pending: Promise<unknown>, ms: number): Promise<boolean> {
  const deadline = createDeadline(ms)
  try {
    const outcome = await raceDeadline(
      pending.then(
        () => true,
        () => false,
      ),
      deadline.promise,
    )
    return outcome === true
  } finally {
    deadline.clear()
  }
}

type OutputCollector = {push(data: Uint8Array): void; text(): string}

/** Accumulates stream chunks, keeping just past the return limit so boundOutput flags the overflow. */
function createOutputCollector(): OutputCollector {
  const chunks: Uint8Array[] = []
  let total = 0
  return {
    push(data) {
      const room = MAX_EXEC_OUTPUT_BYTES + 1 - total
      if (room <= 0) return
      const slice = data.byteLength > room ? data.slice(0, room) : data
      chunks.push(slice)
      total += slice.byteLength
    },
    text() {
      const merged = new Uint8Array(total)
      let offset = 0
      for (const chunk of chunks) {
        merged.set(chunk, offset)
        offset += chunk.byteLength
      }
      return new TextDecoder().decode(merged)
    },
  }
}

type MemorySnapshot = {files: Map<string, string>; totalBytes: number}

/**
 * Bounds the before/after snapshot walks so a pathological memory (one agent imported a 192k-file
 * source tree) cannot freeze the event loop around every code execution. Past the cap the reported
 * file-change list is best-effort: both snapshots truncate at the same walk order, so changes
 * within the visited prefix still diff correctly.
 */
const MAX_SNAPSHOT_ENTRIES = 20_000

function snapshotMemory(stateDir: string): MemorySnapshot {
  const {entries, totalBytes} = listMemory(stateDir, {maxEntries: MAX_SNAPSHOT_ENTRIES})
  const files = new Map<string, string>()
  for (const entry of entries) {
    if (entry.type === 'file') files.set(entry.path, `${entry.size}:${entry.updatedAt}`)
  }
  return {files, totalBytes}
}

/**
 * Entry cap on the reported change list. An execution that rewrites a huge tree (a package
 * install, a build) once produced a 64k-entry list that became a 10MB durable session event; past
 * the cap the count in `changedFilesTotal` tells the whole story and the list is a sample.
 */
const MAX_REPORTED_CHANGED_FILES = 200

function diffMemory(
  before: Map<string, string>,
  after: Map<string, string>,
): {changedFiles: CodeExecFileChange[]; changedFilesTotal: number} {
  const changes: CodeExecFileChange[] = []
  for (const [path, stamp] of after) {
    const previous = before.get(path)
    if (previous === undefined) changes.push({path, change: 'added'})
    else if (previous !== stamp) changes.push({path, change: 'modified'})
  }
  for (const path of before.keys()) {
    if (!after.has(path)) changes.push({path, change: 'removed'})
  }
  changes.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  return {changedFiles: changes.slice(0, MAX_REPORTED_CHANGED_FILES), changedFilesTotal: changes.length}
}

function boundOutput(text: string): {text: string; truncated: boolean} {
  const bytes = new TextEncoder().encode(text)
  if (bytes.byteLength <= MAX_EXEC_OUTPUT_BYTES) return {text, truncated: false}
  let end = text.length
  while (end > 0 && new TextEncoder().encode(text.slice(0, end)).byteLength > MAX_EXEC_OUTPUT_BYTES) {
    end = Math.floor(end * 0.9)
  }
  return {text: `${text.slice(0, end)}\n… [output truncated]`, truncated: true}
}
