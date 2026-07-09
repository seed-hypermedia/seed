/**
 * End-to-end test for client-JS-triggered gateway discovery.
 *
 * Topology (all local, isolated testnet):
 *   daemon A + web A  — "content server": fixture account + a unique test doc
 *   daemon B + web B  — "gateway": starts empty, SEED_IS_GATEWAY=true,
 *                        bootstrapped to daemon A over P2P
 *
 * Asserts the two halves of the scanner-mitigation design:
 *   1. A plain HTTP GET (no JS — like a bot/vuln scanner) of an unknown doc
 *      on the gateway returns a 404 shim page and does NOT make the gateway
 *      daemon discover the doc.
 *   2. A real browser (Playwright Chromium) loading the same URL runs the
 *      shim's JS, which polls /api/DiscoveryStatus, which starts discovery;
 *      the doc syncs from daemon A and the page reloads into real content.
 *
 * Run from frontend/apps/cli:
 *   bun src/test/discovery-gateway.e2e.ts
 */

import {spawn, type ChildProcess} from 'child_process'
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'fs'
import {tmpdir} from 'os'
import {join} from 'path'
import {chromium} from 'playwright'
import {createDocumentUpdate, generateTestAccount} from './account-helpers'
import {FIXTURE_ACCOUNT, FIXTURE_ACCOUNT_ID, seedTestFixtures, writeFixtureWebConfig} from './fixture-seed'
import {startDaemon, type TestContext} from './setup'

const MARKER = `DISCOVERY-E2E-MARKER-${Math.random().toString(36).slice(2, 10)}`
const DOC_PATH = 'discovery-e2e'
const SHIM_TEXT = 'Looking for this document'

function log(msg: string) {
  console.log(`\x1b[36m[e2e]\x1b[0m ${msg}`)
}

function fail(msg: string): never {
  console.error(`\x1b[31m[e2e] FAIL:\x1b[0m ${msg}`)
  process.exit(1)
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** fetch that can never hang the script: every request gets a hard timeout. */
function fetchT(url: string, init?: RequestInit, timeoutMs = 30_000): Promise<Response> {
  return fetch(url, {...init, signal: AbortSignal.timeout(timeoutMs)})
}

function findRepoRoot(): string {
  let repoRoot = process.cwd()
  while (!existsSync(join(repoRoot, 'backend')) && repoRoot !== '/') {
    repoRoot = join(repoRoot, '..')
  }
  if (!existsSync(join(repoRoot, 'backend'))) throw new Error('Could not find repo root')
  return repoRoot
}

type WebServer = {
  url: string
  proc: ChildProcess
  stop: () => Promise<void>
}

const repoRoot = findRepoRoot()
const webPath = join(repoRoot, 'frontend/apps/web')
const webEnvPath = join(webPath, '.env')
const originalEnv = existsSync(webEnvPath) ? readFileSync(webEnvPath, 'utf8') : null

function restoreWebEnv() {
  if (originalEnv !== null) writeFileSync(webEnvPath, originalEnv)
  else if (existsSync(webEnvPath)) rmSync(webEnvPath)
}

async function startWebServer(opts: {
  daemonHttpPort: number
  webPort: number
  dataDir: string
  gateway: boolean
}): Promise<WebServer> {
  const env: Record<string, string> = {
    DAEMON_HTTP_URL: `http://localhost:${opts.daemonHttpPort}`,
    DAEMON_HTTP_PORT: String(opts.daemonHttpPort),
    DAEMON_FILE_URL: `http://localhost:${opts.daemonHttpPort}/ipfs`,
    VITE_DESKTOP_HTTP_PORT: String(opts.daemonHttpPort),
    VITE_DESKTOP_HOSTNAME: 'http://localhost',
    DATA_DIR: opts.dataDir,
    SEED_IS_GATEWAY: opts.gateway ? 'true' : 'false',
  }
  // The constants module reads process.env at import time inside Vite's SSR
  // module runner, which may not inherit env from the spawned shell — write
  // .env so the config is picked up either way.
  writeFileSync(
    webEnvPath,
    Object.entries(env)
      .map(([k, v]) => `${k}=${v}`)
      .join('\n'),
  )

  const url = `http://localhost:${opts.webPort}`
  log(`starting web server (gateway=${opts.gateway}) at ${url} -> daemon :${opts.daemonHttpPort}`)
  // detached: own process group, so stop() can kill the whole tree (shell,
  // pnpm, node/vite) — killing just the shell leaks the vite server, which
  // then both fights over the shared .env and keeps this script's event
  // loop alive forever after main() returns.
  const proc = spawn('/bin/sh', ['-c', `cd "${webPath}" && pnpm remix vite:dev --port ${opts.webPort}`], {
    env: {...process.env, ...env, NODE_ENV: 'development'},
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  })
  // Vite silently auto-increments to a free port when the requested one is
  // taken, so trust its "Local:" line over the port we asked for.
  let actualUrl: string | null = null
  const recentOutput: string[] = []
  const onOutput = (prefix: string) => (d: Buffer) => {
    for (const line of d.toString().split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      recentOutput.push(`${prefix} ${trimmed}`)
      if (recentOutput.length > 40) recentOutput.shift()
      if (process.env.E2E_VERBOSE) console.log(`[web:${opts.webPort}]${prefix} ${trimmed}`)
      const local = trimmed.match(/Local:\s+(http:\/\/localhost:\d+)/)
      if (local) actualUrl = local[1]
    }
  }
  proc.stdout?.on('data', onOutput(''))
  proc.stderr?.on('data', onOutput(':err'))

  const start = Date.now()
  let lastError: unknown = null
  while (Date.now() - start < 120_000) {
    const candidate = actualUrl || url
    try {
      // Probe /hm/api/config, NOT `/`: rendering `/` hits the document
      // loader, which on a daemon with no content yet blocks the request in
      // discoverDocument (non-gateway mode) far longer than the probe
      // timeout. Any HTTP response at all means the server is listening.
      const res = await fetchT(`${candidate}/hm/api/config`, undefined, 5000)
      if (res.status > 0) {
        if (candidate !== url) log(`note: vite moved to ${candidate} (requested ${url})`)
        log(`web server ready at ${candidate}`)
        return {url: candidate, proc, stop: () => stopProcess(proc)}
      }
    } catch (e) {
      lastError = e
    }
    await sleep(1000)
  }
  await stopProcess(proc)
  throw new Error(
    `web server at ${url} failed to start: ${lastError}\n--- recent server output ---\n${recentOutput.join('\n')}`,
  )
}

async function stopProcess(proc: ChildProcess): Promise<void> {
  if (proc.pid === undefined || proc.exitCode !== null) return
  // Negative pid = kill the detached process group (shell + pnpm + vite).
  try {
    process.kill(-proc.pid, 'SIGTERM')
  } catch {}
  await sleep(1500)
  try {
    process.kill(-proc.pid, 'SIGKILL')
  } catch {}
  await sleep(300)
}

async function fetchResourceStatus(webUrl: string, hmUrl: string): Promise<number> {
  const res = await fetchT(`${webUrl}/api/Resource?id=${encodeURIComponent(hmUrl)}`)
  if (res.status !== 200) return res.status
  // /api/Resource returns 200 with a typed payload; a not-found resource can
  // come back as {type: 'not-found'} depending on the loader, so inspect it.
  const body = await res.json()
  const payload = body?.json ?? body
  if (payload?.type === 'not-found' || payload?.type === 'tombstone') return 404
  return 200
}

async function main() {
  // No hyphens: the backend's hmProtocolPattern only allows `-\w+` as the
  // testnet suffix of the protocol ID, so a hyphenated testnet name makes
  // peers reject each other as "not a Hypermedia peer".
  const testnetName = `e2e${Date.now()}`
  const hmUrl = `hm://${FIXTURE_ACCOUNT_ID}/${DOC_PATH}`
  let daemonA: TestContext | null = null
  let daemonB: TestContext | null = null
  let web: WebServer | null = null
  const tmpDirs: string[] = []

  const cleanup = async () => {
    if (web) await web.stop().catch(() => {})
    restoreWebEnv()
    if (daemonA) await daemonA.cleanup().catch(() => {})
    if (daemonB) await daemonB.cleanup().catch(() => {})
    for (const dir of tmpDirs) rmSync(dir, {recursive: true, force: true})
  }
  process.on('SIGINT', async () => {
    await cleanup()
    process.exit(130)
  })

  try {
    // ── Phase 1: content server ────────────────────────────────────────────
    log(`testnet: ${testnetName}`)
    daemonA = await startDaemon({testnetName})
    const webDataDirA = mkdtempSync(join(tmpdir(), 'e2e-web-a-'))
    tmpDirs.push(webDataDirA)
    writeFixtureWebConfig(webDataDirA)

    const daemonAHttpPort = Number(new URL(daemonA.daemonUrl).port)
    web = await startWebServer({
      daemonHttpPort: daemonAHttpPort,
      webPort: daemonAHttpPort + 10,
      dataDir: webDataDirA,
      gateway: false,
    })

    log('seeding fixture account + unique test doc on daemon A')
    await seedTestFixtures(web.url)
    const blockId = 'e2eBlock1'
    await createDocumentUpdate(web.url, FIXTURE_ACCOUNT, DOC_PATH, [
      {type: 'SetAttributes', attrs: [{key: ['name'], value: `Discovery E2E ${MARKER}`}]},
      {
        type: 'ReplaceBlock',
        block: {
          type: 'Paragraph',
          id: blockId,
          text: `This document proves discovery works: ${MARKER}`,
          annotations: [],
        },
      },
      {type: 'MoveBlocks', parent: '', blocks: [blockId]},
    ])
    if ((await fetchResourceStatus(web.url, hmUrl)) !== 200) {
      fail('test doc was not published to daemon A')
    }
    log(`test doc published on daemon A: ${hmUrl}`)

    const configRes = await fetchT(`${web.url}/hm/api/config`)
    const config = await configRes.json()
    if (!config.peerId || !Array.isArray(config.addrs) || config.addrs.length === 0) {
      fail(`could not read daemon A peer info from /hm/api/config: ${JSON.stringify(config)}`)
    }
    const bootstrapAddrs = (config.addrs as string[])
      .map((a) => (a.includes('/p2p/') ? a : `${a}/p2p/${config.peerId}`))
      .filter((a) => a.includes('127.0.0.1') || a.includes('/ip4/192.') || a.includes('/ip4/10.'))
    if (bootstrapAddrs.length === 0) {
      fail(`no local addrs for daemon A in: ${JSON.stringify(config.addrs)}`)
    }
    log(`daemon A peer: ${config.peerId} (${bootstrapAddrs.length} local addrs)`)

    await web.stop()
    web = null

    // ── Phase 2: gateway ───────────────────────────────────────────────────
    daemonB = await startDaemon({testnetName, bootstrapPeers: bootstrapAddrs.join(',')})
    const webDataDirB = mkdtempSync(join(tmpdir(), 'e2e-web-b-'))
    tmpDirs.push(webDataDirB)
    mkdirSync(webDataDirB, {recursive: true})
    // The route loader requires a registeredAccountUid even on the gateway
    // (the prod gateway registers its home site account). It MUST NOT be the
    // fixture account: the web server subscribes the daemon to its registered
    // account (applyConfigSubscriptions, recursive), and a subscription would
    // legitimately bulk-sync the test doc from daemon A without discovery.
    // Use a fresh account that has no content anywhere. The registration
    // secret lets the test force a peer connection via /hm/api/register.
    const gatewayHome = generateTestAccount()
    writeFileSync(
      join(webDataDirB, 'config.json'),
      JSON.stringify({registeredAccountUid: gatewayHome.accountId, availableRegistrationSecret: 'e2e-secret'}),
    )

    const daemonBHttpPort = Number(new URL(daemonB.daemonUrl).port)
    web = await startWebServer({
      daemonHttpPort: daemonBHttpPort,
      webPort: daemonBHttpPort + 10,
      dataDir: webDataDirB,
      gateway: true,
    })

    const gwConfig = await (await fetchT(`${web.url}/hm/api/config`)).json()
    log(`gateway config: isGateway=${gwConfig.isGateway} peerId=${gwConfig.peerId}`)
    if (gwConfig.isGateway !== true) {
      fail('SEED_IS_GATEWAY did not reach the web server — WEB_IS_GATEWAY is false')
    }

    // Force the gateway daemon to connect to daemon A (the register endpoint
    // appends /p2p/<peerId> itself, so strip any existing suffix).
    const registerRes = await fetchT(`${web.url}/hm/api/register`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        registrationSecret: 'e2e-secret',
        accountUid: gatewayHome.accountId,
        peerId: config.peerId,
        addrs: bootstrapAddrs.map((a) => a.replace(/\/p2p\/.*$/, '')),
      }),
    })
    const registerBody = await registerRes.json()
    if (registerRes.status !== 200) {
      fail(`register/connect to daemon A failed: ${registerRes.status} ${JSON.stringify(registerBody)}`)
    }
    log('gateway daemon connected to daemon A via /hm/api/register ✓')
    await sleep(2000)

    const gatewayDocUrl = `${web.url}/hm/${FIXTURE_ACCOUNT_ID}/${DOC_PATH}`

    // ── Test 1: non-JS client gets 404 shim and triggers NO discovery ─────
    log('TEST 1: plain fetch (no JS) must get a 404 shim and not trigger discovery')
    const shimRes = await fetchT(gatewayDocUrl)
    const shimHtml = await shimRes.text()
    if (shimRes.status !== 404) {
      log(`  response body (first 800 chars): ${shimHtml.slice(0, 800)}`)
      fail(`expected 404 for unknown doc on gateway, got ${shimRes.status}`)
    }
    if (!shimHtml.includes(SHIM_TEXT)) {
      log(`  response body (first 800 chars): ${shimHtml.slice(0, 800)}`)
      log(
        `  body mentions discoveryPending=${shimHtml.includes('discoveryPending')} NotFound=${shimHtml.includes(
          'Not Found',
        )}`,
      )
      fail(`expected shim page containing "${SHIM_TEXT}" in the 404 response`)
    }
    log('  got 404 + shim page ✓')

    log('  waiting 15s to prove the gateway daemon does not discover the doc on its own...')
    await sleep(15_000)
    const statusAfterNoJs = await fetchResourceStatus(web.url, hmUrl)
    if (statusAfterNoJs === 200) {
      fail('doc appeared on gateway daemon after a no-JS fetch — SSR must not trigger discovery!')
    }
    const shimRes2 = await fetchT(gatewayDocUrl)
    if (shimRes2.status !== 404) {
      fail(`second no-JS fetch expected 404, got ${shimRes2.status}`)
    }
    log('  doc still unknown to gateway daemon after no-JS fetches ✓')

    // ── Test 2: real browser triggers discovery via /api/DiscoveryStatus ──
    log('TEST 2: Chromium must see the shim, trigger discovery via JS, and land on the doc')
    const browser = await chromium.launch()
    try {
      const page = await browser.newPage()
      const apiCalls: string[] = []
      page.on('request', (req) => {
        if (req.url().includes('/api/DiscoveryStatus')) apiCalls.push(req.url())
      })
      page.on('response', async (res) => {
        if (!res.url().includes('/api/DiscoveryStatus')) return
        const body = await res.text().catch(() => '<unreadable>')
        log(`  DiscoveryStatus poll -> ${res.status()} ${body.slice(0, 160)}`)
      })
      await page.goto(gatewayDocUrl, {waitUntil: 'domcontentloaded'})
      await page.getByText(SHIM_TEXT).waitFor({state: 'visible', timeout: 15_000})
      log('  shim page rendered in browser ✓')

      // The shim polls /api/DiscoveryStatus; when found it reloads into the
      // real document. Retry via the shim's own "Try Again" if the first
      // discovery attempt raced the P2P bootstrap.
      const deadline = Date.now() + 180_000
      let found = false
      while (Date.now() < deadline && !found) {
        try {
          await page.getByText(MARKER, {exact: false}).first().waitFor({state: 'visible', timeout: 45_000})
          found = true
        } catch {
          const tryAgain = page.getByText('Try Again')
          if (await tryAgain.isVisible().catch(() => false)) {
            log('  discovery attempt failed (likely P2P bootstrap race) — retrying via Try Again')
            await tryAgain.click()
          }
        }
      }
      if (!found) {
        const pageText = await page.evaluate(() => document.body.innerText).catch(() => '<unreadable>')
        log(`  final page text: ${pageText.slice(0, 300)}`)
        fail('browser never reached the discovered document content')
      }
      log('  document content rendered after discovery ✓')
      if (apiCalls.length === 0) {
        fail('content appeared but no /api/DiscoveryStatus calls were observed — wrong mechanism?')
      }
      log(`  shim polled /api/DiscoveryStatus ${apiCalls.length}x ✓`)
    } finally {
      await browser.close()
    }

    const statusAfterBrowser = await fetchResourceStatus(web.url, hmUrl)
    if (statusAfterBrowser !== 200) {
      fail(`doc should now exist on gateway daemon, got status ${statusAfterBrowser}`)
    }
    log('  doc now exists on gateway daemon ✓')

    console.log('\n\x1b[32m[e2e] ALL TESTS PASSED\x1b[0m')
    console.log('  1. no-JS fetch  → 404 shim, no discovery triggered')
    console.log('  2. real browser → JS polls /api/DiscoveryStatus → discovery → content')
  } finally {
    await cleanup()
  }
}

main()
  .then(() => {
    // Exit explicitly: any stray child stdio handle would otherwise keep the
    // event loop (and this process) alive indefinitely after success.
    process.exit(0)
  })
  .catch((e) => {
    console.error('[e2e] Unhandled error:', e)
    process.exit(1)
  })
