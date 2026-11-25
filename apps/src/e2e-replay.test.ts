/**
 * Runs the Tier-3 gate scenarios (e2e/run.ts) against the recorded gpt-5-mini cassettes in
 * e2e/recordings/ — full service, real tool loop, no network and no API key. To refresh the
 * cassettes after a prompt or tool change: `bun e2e/run.ts all --record` with OPENAI_API_KEY set.
 */
import {expect, test} from 'bun:test'
import {join} from 'node:path'

test(
  'gate scenarios pass when replayed from recorded model responses',
  async () => {
    const agentsDir = join(import.meta.dir, '..')
    const proc = Bun.spawn(['bun', 'e2e/run.ts', 'all'], {
      cwd: agentsDir,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {...process.env, OPENAI_API_KEY: ''},
    })
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    if (exitCode !== 0) {
      console.error(stdout)
      console.error(stderr)
    }
    expect(exitCode).toBe(0)
    expect(stdout).toContain('0 fail')
  },
  {timeout: 120_000},
)
