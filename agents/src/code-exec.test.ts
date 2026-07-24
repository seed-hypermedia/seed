import {describe, expect, test} from 'bun:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {writeMemoryFile, memoryRootPath} from '@/agent-memory'
import {
  CodeExecError,
  EXEC_WORKSPACE_GUEST_PATH,
  MAX_EXEC_OUTPUT_BYTES,
  createCodeExecutor,
  defaultCodeExecConfig,
  type ExecOutputLike,
  type SandboxSdk,
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
  maxDurationSecs?: number
  mounts: {guest: string; host?: string; quotaMib?: number}[]
  exec?: {cmd: string; args: string[]; timeoutMs?: number}
  stopped?: boolean
  killed?: boolean
}

/** Fake microsandbox SDK capturing builder configuration and returning a canned exec output. */
function fakeSdk(
  call: FakeCall,
  behavior: {
    output?: Partial<ExecOutputLike> & {stdoutText?: string; stderrText?: string}
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
            return {
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
                return {
                  code: behavior.output?.code ?? 0,
                  success: behavior.output?.success ?? true,
                  stdout: () => behavior.output?.stdoutText ?? 'ok\n',
                  stderr: () => behavior.output?.stderrText ?? '',
                }
              },
              stop: async () => {
                call.stopped = true
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
  }
}

describe('code exec', () => {
  test('runs python inside an ephemeral restricted sandbox with memory bind-mounted', async () => {
    await withStateDir(async (stateDir) => {
      writeMemoryFile(stateDir, 'notes.md', 'hello')
      const call: FakeCall = {mounts: []}
      const executor = createCodeExecutor(defaultCodeExecConfig(), async () => fakeSdk(call))

      const result = await executor.execute({stateDir, language: 'python', code: 'print("hi")'})
      expect(result).toMatchObject({exitCode: 0, success: true, stdout: 'ok\n', truncated: false, changedFiles: []})

      expect(call.image).toBe('python')
      expect(call.ephemeral).toBe(true)
      expect(call.security).toBe('restricted')
      expect(call.networkDisabled).toBe(true)
      expect(call.workdir).toBe(EXEC_WORKSPACE_GUEST_PATH)
      expect(call.maxDurationSecs).toBe(90)
      expect(call.mounts).toEqual([{guest: EXEC_WORKSPACE_GUEST_PATH, host: memoryRootPath(stateDir), quotaMib: 1024}])
      expect(call.exec).toEqual({cmd: 'python', args: ['-c', 'print("hi")'], timeoutMs: 60_000})
      expect(call.stopped).toBe(true)
    })
  })

  test('runs shell code through sh -c with a clamped timeout override', async () => {
    await withStateDir(async (stateDir) => {
      const call: FakeCall = {mounts: []}
      const executor = createCodeExecutor(defaultCodeExecConfig(), async () => fakeSdk(call))
      await executor.execute({stateDir, language: 'shell', code: 'ls -la', timeoutSecs: 10_000})
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
      const result = await executor.execute({stateDir, language: 'python', code: 'x'})
      expect(result.changedFiles).toEqual([
        {path: 'edit.md', change: 'modified'},
        {path: 'gone.md', change: 'removed'},
        {path: 'new.md', change: 'added'},
      ])
    })
  })

  test('truncates oversized output and preserves exit codes', async () => {
    await withStateDir(async (stateDir) => {
      const call: FakeCall = {mounts: []}
      const executor = createCodeExecutor(defaultCodeExecConfig(), async () =>
        fakeSdk(call, {output: {code: 3, success: false, stdoutText: 'x'.repeat(MAX_EXEC_OUTPUT_BYTES + 100)}}),
      )
      const result = await executor.execute({stateDir, language: 'python', code: 'x'})
      expect(result.exitCode).toBe(3)
      expect(result.success).toBe(false)
      expect(result.truncated).toBe(true)
      expect(result.stdout.endsWith('[output truncated]')).toBe(true)
    })
  })

  test('sandbox is stopped even when execution throws', async () => {
    await withStateDir(async (stateDir) => {
      const call: FakeCall = {mounts: []}
      const executor = createCodeExecutor(defaultCodeExecConfig(), async () =>
        fakeSdk(call, {execError: new Error('boom')}),
      )
      await expect(executor.execute({stateDir, language: 'shell', code: 'x'})).rejects.toThrow('boom')
      expect(call.stopped).toBe(true)
    })
  })

  test('rejects when disabled, empty code, bad language, or SDK unavailable', async () => {
    await withStateDir(async (stateDir) => {
      const disabled = createCodeExecutor({...defaultCodeExecConfig(), backend: ''}, async () => fakeSdk({mounts: []}))
      expect(disabled.enabled).toBe(false)
      await expect(disabled.execute({stateDir, language: 'python', code: 'x'})).rejects.toThrow('not enabled')

      const executor = createCodeExecutor(defaultCodeExecConfig(), async () => fakeSdk({mounts: []}))
      expect(executor.enabled).toBe(true)
      await expect(executor.execute({stateDir, language: 'python', code: '  '})).rejects.toThrow('Code is required')
      await expect(executor.execute({stateDir, language: 'ruby' as never, code: 'x'})).rejects.toThrow(
        'Language must be',
      )

      const broken = createCodeExecutor(defaultCodeExecConfig(), async () => {
        throw new Error('no virtualization')
      })
      await expect(broken.execute({stateDir, language: 'python', code: 'x'})).rejects.toThrow(
        'unavailable on this server',
      )
      expect(await broken.execute({stateDir, language: 'python', code: 'x'}).catch((error) => error)).toBeInstanceOf(
        CodeExecError,
      )
    })
  })
})
