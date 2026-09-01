import {describe, expect, test} from 'bun:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {writeMemoryFile, memoryRootPath} from '@/agent-memory'
import {
  buildLambdaProgram,
  CodeExecError,
  EXEC_WORKSPACE_GUEST_PATH,
  LAMBDA_RESULT_PREFIX,
  parseLambdaResult,
  MAX_EXEC_OUTPUT_BYTES,
  createCodeExecutor,
  defaultCodeExecConfig,
  type CodeExecProgress,
  type ExecOutputLike,
  type ExecStreamEventLike,
  type SandboxSdk,
  type SandboxLease,
  type SandboxLike,
  type SandboxSourceFactory,
  type SandboxSpec,
} from '@/code-exec'

function withStateDir(run: (stateDir: string) => Promise<void>): Promise<void> {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'code-exec-test-'))
  return run(stateDir).finally(() => fs.rmSync(stateDir, {recursive: true, force: true}))
}

type FakeCall = {
  name?: string
  image?: string
  cpus?: number
  memoryMib?: number
  workdir?: string
  ephemeral?: boolean
  security?: string
  networkDisabled?: boolean
  networkEnabled?: boolean
  dnsServers?: string[]
  networkPolicy?: string
  maxDurationSecs?: number
  mounts: {guest: string; host?: string; quotaMib?: number}[]
  exec?: {cmd: string; args: string[]; timeoutMs?: number}
  stopped?: boolean
  killed?: boolean
  streamKilled?: boolean
}

/** Fake microsandbox SDK capturing builder configuration and returning a canned exec output. */
function fakeSdk(
  call: FakeCall,
  behavior: {
    output?: Partial<ExecOutputLike> & {stdoutText?: string; stderrText?: string}
    /** When set, the sandbox also offers execStreamWith replaying these events. */
    stream?: ExecStreamEventLike[]
    /** After replaying `stream`, recv hangs forever instead of ending — a wedged guest. */
    streamHangs?: boolean
    /** Buffered execWith never resolves — a wedged guest with no streaming API. */
    execHangs?: boolean
    /** Graceful stop never resolves, forcing the kill escalation. */
    stopHangs?: boolean
    onExec?: () => void
    createError?: Error
    execError?: Error
  } = {},
): SandboxSdk {
  return {
    Sandbox: {
      builder(name: string) {
        call.name = name
        const builder = {
          image: (image: string) => ((call.image = image), builder),
          cpus: (count: number) => ((call.cpus = count), builder),
          memory: (mib: number) => ((call.memoryMib = mib), builder),
          workdir: (workdir: string) => ((call.workdir = workdir), builder),
          ephemeral: (ephemeral: boolean) => ((call.ephemeral = ephemeral), builder),
          security: (profile: string) => ((call.security = profile), builder),
          disableNetwork: () => ((call.networkDisabled = true), builder),
          network: (configure: (n: any) => any) => {
            const networkBuilder = {
              enabled: (enabled: boolean) => ((call.networkEnabled = enabled), networkBuilder),
              dns: (dnsConfigure: (d: any) => any) => {
                const dnsBuilder = {
                  nameservers: (servers: string[]) => ((call.dnsServers = servers), dnsBuilder),
                }
                dnsConfigure(dnsBuilder)
                return networkBuilder
              },
              policy: (policy: unknown) => ((call.networkPolicy = policy as string), networkBuilder),
            }
            configure(networkBuilder)
            return builder
          },
          maxDuration: (secs: number) => ((call.maxDurationSecs = secs), builder),
          volume: (guest: string, configure: (mount: any) => any) => {
            const mount: {guest: string; host?: string; quotaMib?: number} = {guest}
            const mountBuilder = {
              bind: (host: string) => ((mount.host = host), mountBuilder),
              quota: (mib: number) => ((mount.quotaMib = mib), mountBuilder),
            }
            configure(mountBuilder)
            call.mounts.push(mount)
            return builder
          },
          create: async () => {
            if (behavior.createError) throw behavior.createError
            const captureExec = (cmd: string, configure: (b: any) => any) => {
              const exec: {cmd: string; args: string[]; timeoutMs?: number} = {cmd, args: []}
              const optionsBuilder = {
                args: (args: string[]) => ((exec.args = args), optionsBuilder),
                timeout: (ms: number) => ((exec.timeoutMs = ms), optionsBuilder),
              }
              configure(optionsBuilder)
              call.exec = exec
            }
            const streaming = behavior.stream
              ? {
                  execStreamWith: async (cmd: string, configure: (b: any) => any) => {
                    captureExec(cmd, configure)
                    behavior.onExec?.()
                    if (behavior.execError) throw behavior.execError
                    const events = [...behavior.stream!]
                    return {
                      recv: () => {
                        const next = events.shift()
                        if (next) return Promise.resolve(next)
                        if (behavior.streamHangs) return new Promise<never>(() => {})
                        return Promise.resolve(null)
                      },
                      kill: async () => {
                        call.streamKilled = true
                      },
                    }
                  },
                }
              : {}
            return {
              ...streaming,
              execWith: async (cmd: string, configure: (b: any) => any) => {
                const exec: {cmd: string; args: string[]; timeoutMs?: number} = {cmd, args: []}
                const optionsBuilder = {
                  args: (args: string[]) => ((exec.args = args), optionsBuilder),
                  timeout: (ms: number) => ((exec.timeoutMs = ms), optionsBuilder),
                }
                configure(optionsBuilder)
                call.exec = exec
                behavior.onExec?.()
                if (behavior.execError) throw behavior.execError
                if (behavior.execHangs) return new Promise<never>(() => {})
                return {
                  code: behavior.output?.code ?? 0,
                  success: behavior.output?.success ?? true,
                  stdout: () => behavior.output?.stdoutText ?? 'ok\n',
                  stderr: () => behavior.output?.stderrText ?? '',
                }
              },
              stop: () => {
                if (behavior.stopHangs) return new Promise<never>(() => {})
                call.stopped = true
                return Promise.resolve()
              },
              kill: async () => {
                call.killed = true
              },
            }
          },
        }
        return builder as never
      },
    },
    NetworkPolicy: {fromProfiles: (profiles: Iterable<string>) => `profiles:${[...profiles].join(',')}`},
  }
}

const principal = {accountId: 'test-account', agentId: 'test-agent', sessionId: 'test-session'}

describe('code exec', () => {
  test('runs python inside an ephemeral restricted sandbox with memory bind-mounted', async () => {
    await withStateDir(async (stateDir) => {
      writeMemoryFile(stateDir, 'notes.md', 'hello')
      const call: FakeCall = {mounts: []}
      const executor = createCodeExecutor(defaultCodeExecConfig(), async () => fakeSdk(call))

      const result = await executor.execute({principal, stateDir, runtime: 'python', code: 'print("hi")'})
      expect(result).toMatchObject({exitCode: 0, success: true, stdout: 'ok\n', truncated: false, changedFiles: []})

      expect(call.image).toBe('python')
      expect(call.ephemeral).toBe(true)
      expect(call.security).toBe('restricted')
      // Network is on by default, with public DNS and a non-local (SSRF-safe) policy.
      expect(call.networkDisabled).toBeUndefined()
      expect(call.networkEnabled).toBe(true)
      expect(call.dnsServers).toEqual(['1.1.1.1', '8.8.8.8'])
      expect(call.networkPolicy).toBe('profiles:public')
      expect(call.workdir).toBe(EXEC_WORKSPACE_GUEST_PATH)
      expect(call.maxDurationSecs).toBe(90)
      expect(call.mounts).toEqual([{guest: EXEC_WORKSPACE_GUEST_PATH, host: memoryRootPath(stateDir)}])
      expect(call.exec).toEqual({cmd: 'python', args: ['-c', 'print("hi")'], timeoutMs: 60_000})
      expect(call.stopped).toBe(true)
    })
  })

  test('offers ts only when an image with bun is configured, and runs it there with bun -e', async () => {
    await withStateDir(async (stateDir) => {
      // An operator can withhold the ts image; the runtime is then simply not offered…
      const withoutBun = createCodeExecutor({...defaultCodeExecConfig(), tsImage: ''}, async () =>
        fakeSdk({mounts: []}),
      )
      expect(withoutBun.runtimes).toEqual(['python', 'shell'])
      // `availability()` probes the real host before it reports runtimes, so its exact set is not
      // ours to assert here: a machine without virtualization answers `[]` however this executor is
      // configured (that case has its own test below, and CI runners have no /dev/kvm). What holds
      // on every host is the claim this test is named for — withhold the image, and ts is not on
      // offer. The configured set itself is asserted through `runtimes` above.
      expect((await withoutBun.availability()).runtimes).not.toContain('ts')
      await expect(withoutBun.execute({principal, stateDir, runtime: 'ts', code: 'console.log(1)'})).rejects.toThrow(
        'needs a sandbox image with bun',
      )

      // …and when the operator configures one, ts runs in THAT image, not the python one.
      const call: FakeCall = {mounts: []}
      const withBun = createCodeExecutor({...defaultCodeExecConfig(), tsImage: 'oven/bun'}, async () => fakeSdk(call))
      expect(withBun.runtimes).toEqual(['ts', 'python', 'shell'])
      await withBun.execute({principal, stateDir, runtime: 'ts', code: 'console.log(1)'})
      expect(call.image).toBe('oven/bun')
      expect(call.exec).toEqual({cmd: 'bun', args: ['-e', 'console.log(1)'], timeoutMs: 60_000})
    })
  })

  test('an unavailable host offers no runtimes at all', async () => {
    const broken = createCodeExecutor({...defaultCodeExecConfig(), tsImage: 'oven/bun'}, async () => {
      throw new Error('no virtualization')
    })
    const availability = await broken.availability()
    expect(availability.available).toBe(false)
    expect(availability.runtimes).toEqual([])
  })

  test('disables networking when allowNetwork is false and honors custom DNS servers', async () => {
    await withStateDir(async (stateDir) => {
      const offCall: FakeCall = {mounts: []}
      const off = createCodeExecutor({...defaultCodeExecConfig(), allowNetwork: false}, async () => fakeSdk(offCall))
      await off.execute({principal, stateDir, runtime: 'python', code: 'x'})
      expect(offCall.networkDisabled).toBe(true)
      expect(offCall.networkEnabled).toBeUndefined()

      const dnsCall: FakeCall = {mounts: []}
      const custom = createCodeExecutor({...defaultCodeExecConfig(), dnsServers: ['9.9.9.9']}, async () =>
        fakeSdk(dnsCall),
      )
      await custom.execute({principal, stateDir, runtime: 'python', code: 'x'})
      expect(dnsCall.dnsServers).toEqual(['9.9.9.9'])
    })
  })

  test('falls back to the older nonLocal policy dialect when the staged SDK lacks fromProfiles', async () => {
    await withStateDir(async (stateDir) => {
      const call: FakeCall = {mounts: []}
      const oldSdk = {...fakeSdk(call), NetworkPolicy: {nonLocal: () => 'nonLocal'}}
      const executor = createCodeExecutor(defaultCodeExecConfig(), async () => oldSdk)
      await executor.execute({principal, stateDir, runtime: 'python', code: 'x'})
      expect(call.networkPolicy).toBe('nonLocal')
    })
  })

  test('runs shell code through sh -c with a clamped timeout override', async () => {
    await withStateDir(async (stateDir) => {
      const call: FakeCall = {mounts: []}
      const executor = createCodeExecutor(defaultCodeExecConfig(), async () => fakeSdk(call))
      await executor.execute({principal, stateDir, runtime: 'shell', code: 'ls -la', timeoutSecs: 10_000})
      expect(call.exec).toEqual({cmd: '/bin/sh', args: ['-c', 'ls -la'], timeoutMs: 300_000})
    })
  })

  test('reports memory files changed by the execution', async () => {
    await withStateDir(async (stateDir) => {
      writeMemoryFile(stateDir, 'keep.md', 'same')
      writeMemoryFile(stateDir, 'gone.md', 'bye')
      writeMemoryFile(stateDir, 'edit.md', 'v1')
      const call: FakeCall = {mounts: []}
      const executor = createCodeExecutor(defaultCodeExecConfig(), async () =>
        fakeSdk(call, {
          onExec: () => {
            // Simulate what sandboxed code did to the mounted workspace.
            writeMemoryFile(stateDir, 'new.md', 'created')
            fs.rmSync(path.join(memoryRootPath(stateDir), 'gone.md'))
            fs.writeFileSync(path.join(memoryRootPath(stateDir), 'edit.md'), 'v2 with more text')
          },
        }),
      )
      const result = await executor.execute({principal, stateDir, runtime: 'python', code: 'x'})
      expect(result.changedFiles).toEqual([
        {path: 'edit.md', change: 'modified'},
        {path: 'gone.md', change: 'removed'},
        {path: 'new.md', change: 'added'},
      ])
      expect(result.changedFilesTotal).toBe(3)
    })
  })

  test('caps the reported change list while keeping the true total', async () => {
    await withStateDir(async (stateDir) => {
      const call: FakeCall = {mounts: []}
      const executor = createCodeExecutor(defaultCodeExecConfig(), async () =>
        fakeSdk(call, {
          onExec: () => {
            for (let i = 0; i < 250; i++) writeMemoryFile(stateDir, `bulk-${String(i).padStart(3, '0')}.md`, 'x')
          },
        }),
      )
      const result = await executor.execute({principal, stateDir, runtime: 'python', code: 'x'})
      expect(result.changedFiles).toHaveLength(200)
      expect(result.changedFilesTotal).toBe(250)
      expect(result.changedFiles[0]).toEqual({path: 'bulk-000.md', change: 'added'})
    })
  })

  test('truncates oversized output and preserves exit codes', async () => {
    await withStateDir(async (stateDir) => {
      const call: FakeCall = {mounts: []}
      const executor = createCodeExecutor(defaultCodeExecConfig(), async () =>
        fakeSdk(call, {output: {code: 3, success: false, stdoutText: 'x'.repeat(MAX_EXEC_OUTPUT_BYTES + 100)}}),
      )
      const result = await executor.execute({principal, stateDir, runtime: 'python', code: 'x'})
      expect(result.exitCode).toBe(3)
      expect(result.success).toBe(false)
      expect(result.truncated).toBe(true)
      expect(result.stdout.endsWith('[output truncated]')).toBe(true)
    })
  })

  test('streams output with live progress when the backend supports streaming exec', async () => {
    await withStateDir(async (stateDir) => {
      const encode = (text: string) => new TextEncoder().encode(text)
      const call: FakeCall = {mounts: []}
      const executor = createCodeExecutor(defaultCodeExecConfig(), async () =>
        fakeSdk(call, {
          stream: [
            {kind: 'started', pid: 42},
            {kind: 'stdout', data: encode('hello\n')},
            {kind: 'stderr', data: encode('warn\n')},
            {kind: 'stdout', data: encode('done\n')},
            {kind: 'exited', code: 0},
          ],
        }),
      )
      const progress: CodeExecProgress[] = []
      const result = await executor.execute({
        principal,
        stateDir,
        runtime: 'python',
        code: 'print("hi")',
        onProgress: (update) => progress.push(update),
      })
      expect(result).toMatchObject({exitCode: 0, success: true, stdout: 'hello\ndone\n', stderr: 'warn\n'})
      expect(call.exec).toEqual({cmd: 'python', args: ['-c', 'print("hi")'], timeoutMs: 60_000})
      // Stage progression: starting (sandbox boot), running (exec begins), then output-driven updates.
      expect(progress[0]).toEqual({stage: 'starting'})
      expect(progress[1]).toEqual({stage: 'running'})
      const withTail = progress.filter((update) => update.outputTail)
      expect(withTail.length).toBeGreaterThan(0)
      expect(withTail[0]!.outputTail).toContain('hello')
    })
  })

  test('reports a failed execution when the stream ends without an exit status', async () => {
    await withStateDir(async (stateDir) => {
      const call: FakeCall = {mounts: []}
      const executor = createCodeExecutor(defaultCodeExecConfig(), async () =>
        fakeSdk(call, {
          stream: [
            {kind: 'started', pid: 42},
            {kind: 'stdout', data: new TextEncoder().encode('partial\n')},
          ],
        }),
      )
      const result = await executor.execute({principal, stateDir, runtime: 'shell', code: 'sleep 999'})
      expect(result.exitCode).toBe(-1)
      expect(result.success).toBe(false)
      expect(result.stdout).toBe('partial\n')
      expect(result.stderr).toContain('without an exit status')
      expect(call.stopped).toBe(true)
    })
  })

  test('the host watchdog kills a streaming execution the sandbox fails to stop', async () => {
    await withStateDir(async (stateDir) => {
      const call: FakeCall = {mounts: []}
      // The guest wedges: it emits some output, then the SDK's own timeout never fires and recv
      // hangs forever — exactly the production failure this watchdog exists for.
      const executor = createCodeExecutor({...defaultCodeExecConfig(), timeoutGraceMs: 50}, async () =>
        fakeSdk(call, {
          stream: [
            {kind: 'started', pid: 42},
            {kind: 'stdout', data: new TextEncoder().encode('compiling…\n')},
          ],
          streamHangs: true,
        }),
      )
      const startedAt = Date.now()
      const result = await executor.execute({principal, stateDir, runtime: 'shell', code: 'sleep 999', timeoutSecs: 1})
      expect(Date.now() - startedAt).toBeLessThan(5_000)
      expect(result.exitCode).toBe(-1)
      expect(result.success).toBe(false)
      // The model still sees what ran before the kill, and why it ended.
      expect(result.stdout).toBe('compiling…\n')
      expect(result.stderr).toContain('killed by the server')
      expect(call.streamKilled).toBe(true)
      expect(call.stopped).toBe(true)
    })
  })

  test('the host watchdog also bounds a buffered execution with no streaming API', async () => {
    await withStateDir(async (stateDir) => {
      const call: FakeCall = {mounts: []}
      const executor = createCodeExecutor({...defaultCodeExecConfig(), timeoutGraceMs: 50}, async () =>
        fakeSdk(call, {execHangs: true}),
      )
      const result = await executor.execute({principal, stateDir, runtime: 'shell', code: 'sleep 999', timeoutSecs: 1})
      expect(result.exitCode).toBe(-1)
      expect(result.success).toBe(false)
      expect(result.stderr).toContain('killed by the server')
      expect(call.stopped).toBe(true)
    })
  })

  test('teardown escalates to kill when the graceful stop hangs', async () => {
    await withStateDir(async (stateDir) => {
      const call: FakeCall = {mounts: []}
      const executor = createCodeExecutor({...defaultCodeExecConfig(), teardownTimeoutMs: 50}, async () =>
        fakeSdk(call, {stopHangs: true}),
      )
      const result = await executor.execute({principal, stateDir, runtime: 'python', code: 'print("hi")'})
      // The execution itself succeeded; a wedged stop must not lose the result or leak the VM.
      expect(result.success).toBe(true)
      expect(call.stopped).toBeUndefined()
      expect(call.killed).toBe(true)
    })
  })

  test('sandbox is stopped even when execution throws', async () => {
    await withStateDir(async (stateDir) => {
      const call: FakeCall = {mounts: []}
      const executor = createCodeExecutor(defaultCodeExecConfig(), async () =>
        fakeSdk(call, {execError: new Error('boom')}),
      )
      await expect(executor.execute({principal, stateDir, runtime: 'shell', code: 'x'})).rejects.toThrow('boom')
      expect(call.stopped).toBe(true)
    })
  })

  test('wraps a lambda into a program that hands it the input and marks the value it returns', async () => {
    const tsProgram = buildLambdaProgram('ts', 'export default (input) => ({hi: input.name})', {name: 'Ada'})
    // The input is a literal, never interpolated code, and the source is imported as a module so
    // it keeps its natural `export default` shape.
    expect(tsProgram).toContain('JSON.parse("{\\"name\\":\\"Ada\\"}")')
    expect(tsProgram).toContain('data:text/typescript;base64,')
    expect(tsProgram).toContain(LAMBDA_RESULT_PREFIX)

    const pyProgram = buildLambdaProgram('python', 'def main(input):\n    return {"hi": input["name"]}', {name: 'Ada'})
    expect(pyProgram.startsWith('def main(input):')).toBe(true)
    expect(pyProgram).toContain('__seed_json.loads("{\\"name\\":\\"Ada\\"}")')
    expect(pyProgram).toContain(`print("${LAMBDA_RESULT_PREFIX}"`)
  })

  test('the TypeScript wrapper really runs a lambda under bun, end to end', async () => {
    // The sandbox is not available in tests, but the PROGRAM is just bun input — so run it with the
    // same runtime the sandbox would, and prove the ABI (input in, return value out) holds.
    const program = buildLambdaProgram(
      'ts',
      'export default async function (input: {name: string}) {\n  console.log("working")\n  return {greeting: `hi ${input.name}`}\n}',
      {name: 'Ada'},
    )
    const run = Bun.spawnSync(['bun', '-e', program])
    const parsed = parseLambdaResult(run.stdout.toString())
    expect(run.exitCode).toBe(0)
    expect(parsed.result).toEqual({greeting: 'hi Ada'})
    // What the tool printed stays separate from what it returned.
    expect(parsed.logs).toBe('working')
  })

  test('the python wrapper runs a lambda, sync or async, end to end', () => {
    // Same idea as the bun case: the program is just python input, so run it with python and prove
    // the ABI holds. Skipped where the test host has no python — the sandbox image always does.
    const hasPython = Bun.spawnSync(['python3', '-c', 'print(1)']).exitCode === 0
    if (!hasPython) return

    for (const source of [
      'def main(input):\n    print("working")\n    return {"greeting": "hi " + input["name"]}',
      'async def main(input):\n    print("working")\n    return {"greeting": "hi " + input["name"]}',
    ]) {
      const run = Bun.spawnSync(['python3', '-c', buildLambdaProgram('python', source, {name: 'Ada'})])
      const parsed = parseLambdaResult(run.stdout.toString())
      expect(run.exitCode).toBe(0)
      expect(parsed.result).toEqual({greeting: 'hi Ada'})
      expect(parsed.logs).toBe('working')
    }

    // A module with no main is a broken tool, and says so instead of failing obscurely.
    const noMain = Bun.spawnSync(['python3', '-c', buildLambdaProgram('python', 'x = 1', {})])
    expect(noMain.exitCode).not.toBe(0)
    expect(noMain.stderr.toString()).toContain('must define a top-level main(input) function')
  })

  test('reads back the marked result, and reports its absence rather than guessing', () => {
    expect(parseLambdaResult(`noise\n${LAMBDA_RESULT_PREFIX}{"ok":true}\n`)).toMatchObject({
      hasResult: true,
      result: {ok: true},
      logs: 'noise',
    })
    // A tool that printed but never returned is a broken tool, not an empty result.
    expect(parseLambdaResult('just logs\n')).toMatchObject({hasResult: false, logs: 'just logs'})
    expect(parseLambdaResult(`${LAMBDA_RESULT_PREFIX}not-json\n`).hasResult).toBe(false)
  })

  test('rejects when disabled, empty code, an unknown runtime, or SDK unavailable', async () => {
    await withStateDir(async (stateDir) => {
      const disabled = createCodeExecutor({...defaultCodeExecConfig(), backend: ''}, async () => fakeSdk({mounts: []}))
      expect(disabled.enabled).toBe(false)
      await expect(disabled.execute({principal, stateDir, runtime: 'python', code: 'x'})).rejects.toThrow('not enabled')

      const executor = createCodeExecutor(defaultCodeExecConfig(), async () => fakeSdk({mounts: []}))
      expect(executor.enabled).toBe(true)
      await expect(executor.execute({principal, stateDir, runtime: 'python', code: '  '})).rejects.toThrow(
        'Code is required',
      )
      await expect(executor.execute({principal, stateDir, runtime: 'ruby' as never, code: 'x'})).rejects.toThrow(
        'Runtime must be one of: ts, python, shell',
      )

      const broken = createCodeExecutor(defaultCodeExecConfig(), async () => {
        throw new Error('no virtualization')
      })
      await expect(broken.execute({principal, stateDir, runtime: 'python', code: 'x'})).rejects.toThrow(
        'unavailable on this server',
      )
      expect(
        await broken.execute({principal, stateDir, runtime: 'python', code: 'x'}).catch((error) => error),
      ).toBeInstanceOf(CodeExecError)
    })
  })
})

// ------------------------------------------------------------------------------------------------
// SandboxSource seam contract (the seam the warm pool implements; see docs/exec-warm-pool.md)
// ------------------------------------------------------------------------------------------------

/** Minimal healthy sandbox: buffered exec returning the given exit code. */
function fakeSandbox(behavior: {code?: number; execError?: Error; stream?: ExecStreamEventLike[]}): SandboxLike {
  const optionsBuilder = {args: () => optionsBuilder, timeout: () => optionsBuilder} as never
  const base: SandboxLike = {
    async execWith(_cmd, configure) {
      configure(optionsBuilder)
      if (behavior.execError) throw behavior.execError
      const code = behavior.code ?? 0
      return {code, success: code === 0, stdout: () => 'out', stderr: () => ''}
    },
    stop: async () => {},
    kill: async () => {},
  }
  if (behavior.stream) {
    const events = [...behavior.stream]
    base.execStreamWith = async (_cmd, configure) => {
      configure(optionsBuilder)
      return {recv: async () => events.shift() ?? null, kill: async () => {}}
    }
  }
  return base
}

/** A source handing out one canned lease, recording the spec it saw and every release. */
function fakeSource(sandbox: SandboxLike, opts: {bootMs?: number; reused?: boolean} = {}) {
  const releases: Array<{healthy: boolean}> = []
  const specs: SandboxSpec[] = []
  const factory: SandboxSourceFactory = () => ({
    drain: async () => {},
    async acquire(spec) {
      specs.push(spec)
      const lease: SandboxLease = {
        sandbox,
        bootMs: opts.bootMs ?? 0,
        reused: opts.reused ?? false,
        release: async (o) => {
          releases.push(o)
        },
      }
      return lease
    },
  })
  return {factory, releases, specs}
}

const unusedSdk = async (): Promise<SandboxSdk> => {
  throw new Error('the injected source never loads the SDK')
}

describe('sandbox source seam', () => {
  test('a normal exit releases the lease healthy, exactly once, with bootMs passed through', async () => {
    await withStateDir(async (stateDir) => {
      const {factory, releases, specs} = fakeSource(fakeSandbox({code: 0}), {bootMs: 123})
      const executor = createCodeExecutor(defaultCodeExecConfig(), unusedSdk, factory)
      const result = await executor.execute({principal, stateDir, runtime: 'shell', code: 'echo hi'})
      expect(result.exitCode).toBe(0)
      expect(result.bootMs).toBe(123)
      expect(releases).toEqual([{healthy: true}])
      // The spec carries typed identity and the runtime-resolved image — the pool's security key.
      expect(specs[0]!.principal).toEqual(principal)
      expect(specs[0]!.image).toBe(defaultCodeExecConfig().image)
    })
  })

  test('a non-zero exit is still a healthy VM', async () => {
    await withStateDir(async (stateDir) => {
      const {factory, releases} = fakeSource(fakeSandbox({code: 2}))
      const executor = createCodeExecutor(defaultCodeExecConfig(), unusedSdk, factory)
      const result = await executor.execute({principal, stateDir, runtime: 'shell', code: 'exit 2'})
      expect(result.exitCode).toBe(2)
      expect(result.success).toBe(false)
      expect(releases).toEqual([{healthy: true}])
    })
  })

  test('a stream that vanishes without an exit status releases unhealthy', async () => {
    await withStateDir(async (stateDir) => {
      const sandbox = fakeSandbox({stream: [{kind: 'stdout', data: new TextEncoder().encode('partial')}]})
      const {factory, releases} = fakeSource(sandbox)
      const executor = createCodeExecutor(defaultCodeExecConfig(), unusedSdk, factory)
      const result = await executor.execute({principal, stateDir, runtime: 'shell', code: 'x'})
      expect(result.exitCode).toBe(-1)
      expect(releases).toEqual([{healthy: false}])
    })
  })

  test('an exec error releases unhealthy, exactly once, and surfaces as CodeExecError', async () => {
    await withStateDir(async (stateDir) => {
      const {factory, releases} = fakeSource(fakeSandbox({execError: new Error('sdk wedged')}))
      const executor = createCodeExecutor(defaultCodeExecConfig(), unusedSdk, factory)
      const error = await executor
        .execute({principal, stateDir, runtime: 'shell', code: 'x'})
        .catch((thrown: unknown) => thrown)
      expect(error).toBeInstanceOf(CodeExecError)
      expect(releases).toEqual([{healthy: false}])
    })
  })

  test('a reused lease reports bootMs 0 on the result', async () => {
    await withStateDir(async (stateDir) => {
      const {factory} = fakeSource(fakeSandbox({code: 0}), {bootMs: 0, reused: true})
      const executor = createCodeExecutor(defaultCodeExecConfig(), unusedSdk, factory)
      const result = await executor.execute({principal, stateDir, runtime: 'shell', code: 'echo hi'})
      expect(result.bootMs).toBe(0)
    })
  })

  test('executor drain settles through the source', async () => {
    let drained = false
    const factory: SandboxSourceFactory = () => ({
      drain: async () => {
        drained = true
      },
      acquire: async () => {
        throw new Error('unused')
      },
    })
    const executor = createCodeExecutor(defaultCodeExecConfig(), unusedSdk, factory)
    await executor.drain()
    expect(drained).toBe(true)
  })
})
