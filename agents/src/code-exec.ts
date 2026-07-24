/**
 * Sandboxed code execution inside an agent's memory workspace.
 *
 * Runs model-written code in a hardware-isolated microVM (the embedded `microsandbox` runtime:
 * libkrun on macOS/Linux, WHP on Windows) with the agent's memory directory bind-mounted at
 * `/workspace` as the working directory. Code therefore reads and writes the same files the
 * `memory_*` tools and the desktop Memory tab see, while the VM boundary keeps it away from the
 * host. Each execution uses a fresh ephemeral sandbox with capped CPU, memory, write quota, and
 * wall-clock duration; networking is disabled unless explicitly allowed.
 *
 * The SDK is loaded lazily and injected in tests, so the service runs fine on hosts without
 * virtualization support — the tool then fails with a clear error instead of breaking the server.
 */

import {MAX_MEMORY_TOTAL_BYTES, listMemory, memoryRootPath} from '@/agent-memory'
import * as fs from 'node:fs'

/** Guest path where the agent's memory directory is mounted. */
export const EXEC_WORKSPACE_GUEST_PATH = '/workspace'
/** Maximum bytes of stdout/stderr each returned to the model. */
export const MAX_EXEC_OUTPUT_BYTES = 64 * 1024
/** Upper bound for a single execution timeout. */
export const MAX_EXEC_TIMEOUT_SECS = 300

/** Code-execution backend configuration. */
export type CodeExecConfig = {
  /** Execution backend. Empty string disables code execution. */
  backend: '' | 'microsandbox'
  /** OCI image for the sandbox rootfs. */
  image: string
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
}

/** Languages the execute_code tool accepts. */
export type CodeExecLanguage = 'python' | 'shell'

/** One code execution request against an agent's memory workspace. */
export type CodeExecRequest = {
  stateDir: string
  language: CodeExecLanguage
  code: string
  /** Optional timeout override in seconds, clamped to [1, MAX_EXEC_TIMEOUT_SECS]. */
  timeoutSecs?: number
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
  /** Memory files added/modified/removed by the execution, from a before/after listing diff. */
  changedFiles: CodeExecFileChange[]
}

/** Structural slice of the microsandbox SDK used here, so tests can inject a fake. */
export type SandboxSdk = {
  Sandbox: {
    builder(name: string): SandboxBuilderLike
  }
  /** Network policy factories; `nonLocal` permits public internet but not private/link-local ranges. */
  NetworkPolicy: {
    nonLocal(): unknown
  }
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

export type SandboxLike = {
  execWith(cmd: string, configure: (builder: ExecOptionsBuilderLike) => ExecOptionsBuilderLike): Promise<ExecOutputLike>
  stop(): Promise<void>
  kill(): Promise<void>
}

/** Executes code in sandboxes for agent memory workspaces. */
export type CodeExecutor = {
  /** Whether this server is configured to offer code execution. */
  enabled: boolean
  execute(request: CodeExecRequest): Promise<CodeExecResult>
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

/** Default configuration: microsandbox backend, python image, network enabled with public DNS. */
export function defaultCodeExecConfig(): CodeExecConfig {
  return {
    backend: 'microsandbox',
    image: 'python',
    cpus: 1,
    memoryMib: 512,
    timeoutSecs: 60,
    allowNetwork: true,
    dnsServers: DEFAULT_EXEC_DNS_SERVERS,
  }
}

const loadMicrosandbox = async (): Promise<SandboxSdk> => (await import('microsandbox')) as unknown as SandboxSdk

/**
 * Creates the code executor for a service. `loadSdk` is injectable for tests; the real SDK is
 * imported lazily on first execution so unsupported hosts only fail when the tool is used.
 */
export function createCodeExecutor(
  config: CodeExecConfig,
  loadSdk: () => Promise<SandboxSdk> = loadMicrosandbox,
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

  return {
    enabled: config.backend === 'microsandbox',
    async execute(request) {
      if (config.backend !== 'microsandbox') {
        throw new CodeExecError(400, 'Code execution is not enabled on this server')
      }
      const code = typeof request.code === 'string' ? request.code : ''
      if (!code.trim()) throw new CodeExecError(400, 'Code is required')
      if (request.language !== 'python' && request.language !== 'shell') {
        throw new CodeExecError(400, 'Language must be "python" or "shell"')
      }
      const timeoutSecs = Math.max(1, Math.min(MAX_EXEC_TIMEOUT_SECS, request.timeoutSecs ?? config.timeoutSecs))

      const memoryRoot = memoryRootPath(request.stateDir)
      fs.mkdirSync(memoryRoot, {recursive: true})
      const before = snapshotMemory(request.stateDir)
      const quotaMib = writeQuotaMib(before.totalBytes)

      const sdk = await getSdk()
      const startedAt = Date.now()
      let sandbox: SandboxLike
      try {
        let builder = sdk.Sandbox.builder(`seed-exec-${crypto.randomUUID().slice(0, 13)}`)
          .image(config.image)
          .cpus(config.cpus)
          .memory(config.memoryMib)
          .workdir(EXEC_WORKSPACE_GUEST_PATH)
          .ephemeral(true)
          .security('restricted')
          .maxDuration(timeoutSecs + 30)
          .volume(EXEC_WORKSPACE_GUEST_PATH, (mount) => mount.bind(memoryRoot).quota(quotaMib))
        if (config.allowNetwork) {
          // Enable networking with explicit public DNS (the guest has no resolver otherwise) and a
          // non-local policy so code can reach the public internet but not the host's private
          // network or cloud metadata endpoints.
          const dnsServers = config.dnsServers.length ? config.dnsServers : DEFAULT_EXEC_DNS_SERVERS
          builder = builder.network((network) =>
            network
              .enabled(true)
              .dns((dns) => dns.nameservers(dnsServers))
              .policy(sdk.NetworkPolicy.nonLocal()),
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

      try {
        const command =
          request.language === 'python' ? {cmd: 'python', args: ['-c', code]} : {cmd: '/bin/sh', args: ['-c', code]}
        let output: ExecOutputLike
        try {
          output = await sandbox.execWith(command.cmd, (builder) =>
            builder.args(command.args).timeout(timeoutSecs * 1000),
          )
        } catch (error) {
          throw new CodeExecError(
            502,
            `Code execution failed: ${error instanceof Error ? error.message : String(error)}`,
          )
        }
        const stdout = boundOutput(output.stdout())
        const stderr = boundOutput(output.stderr())
        const after = snapshotMemory(request.stateDir)
        return {
          exitCode: output.code,
          success: output.success,
          stdout: stdout.text,
          stderr: stderr.text,
          truncated: stdout.truncated || stderr.truncated,
          durationMs: Date.now() - startedAt,
          changedFiles: diffMemory(before.files, after.files),
        }
      } finally {
        try {
          await sandbox.stop()
        } catch {
          await sandbox.kill().catch(() => {})
        }
      }
    },
  }
}

/** Guest write quota: the remaining memory budget, clamped to a sane range. */
function writeQuotaMib(usedBytes: number): number {
  const remainingMib = Math.ceil((MAX_MEMORY_TOTAL_BYTES - usedBytes) / (1024 * 1024))
  return Math.max(1, Math.min(1024, remainingMib))
}

type MemorySnapshot = {files: Map<string, string>; totalBytes: number}

function snapshotMemory(stateDir: string): MemorySnapshot {
  const {entries, totalBytes} = listMemory(stateDir)
  const files = new Map<string, string>()
  for (const entry of entries) {
    if (entry.type === 'file') files.set(entry.path, `${entry.size}:${entry.updatedAt}`)
  }
  return {files, totalBytes}
}

function diffMemory(before: Map<string, string>, after: Map<string, string>): CodeExecFileChange[] {
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
  return changes
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
