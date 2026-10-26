#!/usr/bin/env node
/**
 * SSR CPU benchmark for the web app's document pages.
 *
 * Loads the production server build (`pnpm web:prod` -> build/server/index.js)
 * in-process through Remix's request handler and renders a list of pages many
 * times, one request at a time, measuring for each request:
 *   - main-thread busy time (event-loop utilization "active" ms): the resource
 *     that saturated on hyper.media, since one Node process renders on one thread
 *   - process CPU time (user + system, all threads incl. GC helpers)
 *   - wall time, GC pause time, and the response size
 *
 * The daemon is replaced by `daemon-replay.mjs` serving recorded responses of
 * real documents, so the numbers do not include any daemon work or latency and
 * are repeatable. Run the replay server first, then:
 *
 *   node scripts/ssr-bench/bench.mjs --daemon http://localhost:58999 \
 *     --pages scripts/ssr-bench/pages.json [--iterations 40] [--warmup 5] [--out result.json] \
 *     [--build path/to/server/index.js] [--profile run.cpuprofile] [--dump-html <dir>]
 *
 * `--profile` records a V8 CPU profile of the measured requests only (startup and
 * warmup excluded); summarize it with profile-summary.mjs. `--dump-html` writes
 * each page's first response so two builds can be diffed for identical output.
 *
 * Each request uses a distinct Host so the per-document SSR HTML cache in
 * @shm/editor/ssr-render (keyed by origin) never hits: crawler traffic spreads
 * across many pages, so a warm cache would understate the per-render cost.
 * Pass `--same-host` to measure the warm-cache path instead.
 *
 * Server logs go to stdout; redirect them (e.g. `> /tmp/ssr-bench.log`) so the
 * logging cost is paid the way it is in production.
 *
 * Full workflow (from frontend/apps/web):
 *   1. Record fixtures once from any daemon that has the pages' documents (only
 *      reads are forwarded; see daemon-replay.mjs):
 *        node scripts/ssr-bench/daemon-replay.mjs record --upstream http://localhost:56001 --fixtures /tmp/f.json
 *        node scripts/ssr-bench/bench.mjs --iterations 1 --warmup 1      # then stop the recorder
 *   2. Serve them:  node scripts/ssr-bench/daemon-replay.mjs replay --fixtures /tmp/f.json
 *   3. Build each variant (`pnpm build`, copy build/ aside; SEED_WEB_NO_MINIFY=1 for
 *      readable profiles), then compare them interleaved:
 *        node scripts/ssr-bench/ab.mjs --builds before=<dir>/server/index.js,after=<dir>/server/index.js
 *   4. Check the output is unchanged: run bench.mjs with --dump-html for each build, then
 *        node scripts/ssr-bench/compare-html.mjs <before-html-dir> <after-html-dir>
 */
import {mkdtempSync, readFileSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname, join, resolve} from 'node:path'
import {PerformanceObserver, performance} from 'node:perf_hooks'
import {fileURLToPath, pathToFileURL} from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const webRoot = resolve(here, '../..')
const args = process.argv.slice(2)
function opt(name, dflt) {
  const i = args.indexOf(`--${name}`)
  return i === -1 ? dflt : args[i + 1]
}
const flag = (name) => args.includes(`--${name}`)

const daemonUrl = opt('daemon', 'http://localhost:58999')
const pagesFile = resolve(opt('pages', join(here, 'pages.json')))
const iterations = Number(opt('iterations', '40'))
const warmup = Number(opt('warmup', '5'))
const outFile = opt('out')
const sameHost = flag('same-host')
const dumpDir = opt('dump-html')
const buildPath = resolve(webRoot, opt('build', 'build/server/index.js'))
const userAgent = opt(
  'user-agent',
  'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', // crawler traffic is what saturated prod
)

/** @type {{siteUid: string, pages: {name: string, path: string}[]}} */
const pagesConfig = JSON.parse(readFileSync(pagesFile, 'utf8'))

// The server reads its environment at import time. Drop any developer-shell
// settings (instrumentation, upstream fallbacks, Sentry, …) so the run matches
// a production gateway.
for (const key of Object.keys(process.env)) {
  if (/^(SEED_|VITE_|SITE_|SENTRY_|DAEMON_|NOTIFY_|LOG_LEVEL$|DATA_DIR$)/.test(key)) delete process.env[key]
}
const dataDir = mkdtempSync(join(tmpdir(), 'ssr-bench-'))
writeFileSync(join(dataDir, 'config.json'), JSON.stringify({registeredAccountUid: pagesConfig.siteUid}))
Object.assign(process.env, {
  NODE_ENV: 'production',
  DATA_DIR: dataDir,
  DAEMON_HTTP_URL: daemonUrl,
  DAEMON_FILE_URL: `${daemonUrl}/ipfs`,
  SEED_IS_GATEWAY: 'true',
  SEED_BASE_URL: 'https://hyper.media',
  SEED_IDENTITY_ENABLED: 'false',
  SEED_SIGNING_ENABLED: 'false',
})

const {createRequestHandler} = await import('@remix-run/node')
const build = await import(pathToFileURL(buildPath).href)
const handler = createRequestHandler(build, 'production')

let gcMs = 0
let gcCount = 0
const gcObserver = new PerformanceObserver((list) => {
  for (const e of list.getEntries()) {
    gcMs += e.duration
    gcCount++
  }
})
gcObserver.observe({entryTypes: ['gc']})
function flushGc() {
  for (const e of gcObserver.takeRecords?.() ?? []) {
    gcMs += e.duration
    gcCount++
  }
}

let hostCounter = 0
async function renderOnce(path) {
  const host = sameHost ? 'hyper.media' : `h${++hostCounter}.bench.test`
  const request = new Request(`http://${host}${path}`, {
    headers: {host, 'user-agent': userAgent, accept: 'text/html'},
  })
  const elu0 = performance.eventLoopUtilization()
  const cpu0 = process.cpuUsage()
  flushGc()
  const gc0 = gcMs
  const gcCount0 = gcCount
  const t0 = performance.now()
  const response = await handler(request)
  const body = await response.text()
  const wall = performance.now() - t0
  const cpu = process.cpuUsage(cpu0)
  const elu = performance.eventLoopUtilization(elu0)
  // GC entries are delivered asynchronously; give the observer a tick.
  await new Promise((r) => setImmediate(r))
  flushGc()
  return {
    status: response.status,
    bytes: Buffer.byteLength(body),
    body,
    wallMs: wall,
    mainThreadMs: elu.active,
    cpuMs: (cpu.user + cpu.system) / 1000,
    gcMs: gcMs - gc0,
    gcCount: gcCount - gcCount0,
  }
}

function stats(values) {
  const s = [...values].sort((a, b) => a - b)
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))]
  return {median: q(0.5), p10: q(0.1), p90: q(0.9), min: s[0], max: s[s.length - 1]}
}

const pages = pagesConfig.pages
const firsts = new Map()
for (const page of pages) {
  const first = await renderOnce(page.path)
  if (first.status !== 200) console.error(`! ${page.name} ${page.path} -> HTTP ${first.status}`)
  if (dumpDir) writeFileSync(join(dumpDir, `${page.name}.html`), first.body)
  firsts.set(page.name, first)
}
for (let i = 1; i < warmup; i++) for (const page of pages) await renderOnce(page.path)

// Optional CPU profile of the measured phase only (startup and warmup excluded).
const profileFile = opt('profile')
let session
if (profileFile) {
  const {Session} = await import('node:inspector/promises')
  session = new Session()
  session.connect()
  await session.post('Profiler.enable')
  await session.post('Profiler.setSamplingInterval', {interval: 200})
  await session.post('Profiler.start')
}

// Round-robin over the pages so drift in machine load hits every page equally.
const samples = new Map(pages.map((p) => [p.name, []]))
for (let i = 0; i < iterations; i++) {
  for (const page of pages) samples.get(page.name).push(await renderOnce(page.path))
}

if (session) {
  const {profile} = await session.post('Profiler.stop')
  writeFileSync(profileFile, JSON.stringify(profile))
  console.error(`profile written to ${profileFile}`)
}

const fmt = (s) => `${s.median.toFixed(1).padStart(6)} ms [p10 ${s.p10.toFixed(1)}, p90 ${s.p90.toFixed(1)}]`
const results = []
for (const page of pages) {
  const first = firsts.get(page.name)
  const ss = samples.get(page.name)
  const r = {
    name: page.name,
    path: page.path,
    status: first.status,
    bytes: first.bytes,
    cpuMs: stats(ss.map((s) => s.cpuMs)),
    mainThreadMs: stats(ss.map((s) => s.mainThreadMs)),
    wallMs: stats(ss.map((s) => s.wallMs)),
    gcMs: stats(ss.map((s) => s.gcMs)),
  }
  results.push(r)
  console.error(
    `${page.name.padEnd(20)} ${String(r.status).padEnd(4)} ${(r.bytes / 1024).toFixed(0).padStart(5)} KiB  ` +
      `cpu ${fmt(r.cpuMs)}  main ${fmt(r.mainThreadMs)}  gc ${r.gcMs.median.toFixed(1).padStart(5)} ms`,
  )
}
const sum = (k) => results.reduce((a, r) => a + r[k].median, 0)
console.error(
  `${'TOTAL (sum of medians)'.padEnd(31)} cpu ${sum('cpuMs').toFixed(1)} ms  main ${sum('mainThreadMs').toFixed(1)} ms`,
)
if (outFile) writeFileSync(outFile, JSON.stringify({node: process.version, iterations, sameHost, results}, null, 2))
process.exit(0)
