import {mkdtemp, rm} from 'node:fs/promises'
import {existsSync} from 'node:fs'
import {tmpdir} from 'node:os'
import * as path from 'node:path'
import process from 'node:process'

const repoDir = path.resolve(import.meta.dirname, '..', '..')
const tag = process.env.SEED_AGENTS_DOCKER_TAG || 'seedhypermedia/agents:dev'
const name = `seed-agents-smoke-${process.pid}`
const dataDir = await mkdtemp(path.join(tmpdir(), 'seed-agents-docker-data-'))
const port = 42_000 + Math.floor(Math.random() * 1_000)
let containerStarted = false

try {
  await run(['docker', 'build', '-t', tag, '.', '-f', 'agents/Dockerfile'], {cwd: repoDir})
  await run(['docker', 'run', '-d', '--rm', '--name', name, '-p', `${port}:3050`, '-v', `${dataDir}:/data`, tag], {
    cwd: repoDir,
  })
  containerStarted = true

  await waitForHealth(port)

  const status = await fetchJSON(`http://127.0.0.1:${port}/agents/api/status`)
  if (!Array.isArray(status.agents) || !Array.isArray(status.watermarks)) {
    throw new Error(`Unexpected status response: ${JSON.stringify(status)}`)
  }

  const inspector = await fetch(`http://127.0.0.1:${port}/agents`)
  if (!inspector.ok || !(await inspector.text()).includes('<!doctype html>')) {
    throw new Error(`Unexpected inspector response: ${inspector.status}`)
  }

  if (!existsSync(path.join(dataDir, 'agents.sqlite'))) {
    throw new Error('Docker container did not create /data/agents.sqlite')
  }

  console.log(`Docker agents smoke test passed for ${tag} on port ${port}`)
} finally {
  if (containerStarted) await run(['docker', 'stop', name], {cwd: repoDir, allowFailure: true})
  await rm(dataDir, {recursive: true, force: true})
}

async function waitForHealth(port: number): Promise<void> {
  const url = `http://127.0.0.1:${port}/agents/api/health`
  let lastError: unknown
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const body = await fetchJSON(url)
      if (body?.status === 'ok') return
      lastError = new Error(`Unexpected health body: ${JSON.stringify(body)}`)
    } catch (error) {
      lastError = error
    }
    await Bun.sleep(250)
  }
  throw new Error(
    `Docker agents server did not become healthy: ${lastError instanceof Error ? lastError.message : lastError}`,
  )
}

async function fetchJSON(url: string): Promise<any> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url} returned ${response.status}`)
  return response.json()
}

async function run(cmd: string[], options: {cwd: string; allowFailure?: boolean}): Promise<void> {
  const proc = Bun.spawn(cmd, {cwd: options.cwd, stdout: 'inherit', stderr: 'inherit'})
  const code = await proc.exited
  if (code !== 0 && !options.allowFailure) {
    throw new Error(`${cmd.join(' ')} exited with ${code}`)
  }
}
