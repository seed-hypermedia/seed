import {mkdtemp, cp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import * as path from 'node:path'
import process from 'node:process'

const repoDir = path.resolve(import.meta.dirname, '..')
const appDir = await mkdtemp(path.join(tmpdir(), 'seed-agents-app-'))
const dataDir = await mkdtemp(path.join(tmpdir(), 'seed-agents-data-'))
const port = 41_000 + Math.floor(Math.random() * 1_000)

try {
  await cp(path.join(repoDir, 'dist'), appDir, {recursive: true})
  await cp(path.join(repoDir, 'package.json'), path.join(appDir, 'package.json'))

  const server = Bun.spawn(['bun', 'run', '--no-install', 'main.js'], {
    cwd: appDir,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      NODE_ENV: 'production',
      SEED_AGENTS_DB_PATH: path.join(dataDir, 'agents.sqlite'),
      SEED_AGENTS_DATA_DIR: dataDir,
      SEED_AGENTS_HTTP_HOSTNAME: '127.0.0.1',
      SEED_AGENTS_HTTP_PORT: String(port),
    },
  })

  try {
    await waitForHealth(port)
    console.log(`Built agents server smoke test passed on port ${port}`)
  } finally {
    server.kill('SIGTERM')
    await Promise.race([server.exited, Bun.sleep(2_000).then(() => server.kill('SIGKILL'))])

    const [stdout, stderr] = await Promise.all([new Response(server.stdout).text(), new Response(server.stderr).text()])
    if (stdout.trim()) console.log(stdout.trim())
    if (stderr.trim()) console.error(stderr.trim())
  }
} finally {
  await Promise.all([rm(appDir, {recursive: true, force: true}), rm(dataDir, {recursive: true, force: true})])
}

async function waitForHealth(port: number): Promise<void> {
  const url = `http://127.0.0.1:${port}/agents/api/health`
  let lastError: unknown
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(url)
      if (response.ok) {
        const body = await response.json()
        if (body?.status === 'ok') return
        throw new Error(`Unexpected health body: ${JSON.stringify(body)}`)
      }
      lastError = new Error(`Health returned ${response.status}`)
    } catch (error) {
      lastError = error
    }
    await Bun.sleep(250)
  }
  throw new Error(
    `Built agents server did not become healthy: ${lastError instanceof Error ? lastError.message : lastError}`,
  )
}
