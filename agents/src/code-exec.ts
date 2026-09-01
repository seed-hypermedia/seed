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
import {recordPerf} from '@/perf'
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
 * The security identity an execution runs for. Carried explicitly across the sandbox seam so a
 * pooling source keys VMs on typed identity — never inferred from a filesystem path, which is a
 * representation detail and not a security boundary.
 */
export type ExecPrincipal = {accountId: string; agentId: string}

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
 * (docs/exec-warm-pool.md). The default source boots a fresh microVM per lease and tears it down
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

/** The default source: one fresh ephemeral microVM per lease, torn down on release. */
export const createBootPerCallSource: SandboxSourceFactory = (config, getSdk) => {
  return {
    // Teardown here is awaited inside release, so there is never an async disposal to drain.
    drain: async () => {},
    async acquire(spec) {
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
          .maxDuration(spec.timeoutSecs + 30)
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

/**
 * Creates the code executor for a service. `loadSdk` is injectable for tests; the real SDK is
 * imported lazily on first execution so unsupported hosts only fail when the tool is used.
 */
export function createCodeExecutor(
  config: CodeExecConfig,
  loadSdk: () => Promise<SandboxSdk> = loadMicrosandbox,
  createSource: SandboxSourceFactory = createBootPerCallSource,
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
