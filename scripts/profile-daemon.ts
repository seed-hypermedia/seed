#!/usr/bin/env bun

import {mkdir} from 'node:fs/promises'
import {basename, dirname, join} from 'node:path'
import {parseArgs as parseNodeArgs} from 'node:util'

const DEFAULT_BASE_URL = 'http://127.0.0.1:56001/debug/pprof'
const DEFAULT_SECONDS = 30

function usage(scriptName = basename(process.argv[1] ?? 'profile-daemon.ts')) {
  return [
    `Usage: ${scriptName} [options]`,
    '',
    'Collect a bundle of daemon pprof data into a folder.',
    '',
    'Options:',
    `  --base-url URL   Base pprof URL. Default: ${DEFAULT_BASE_URL}`,
    `  --seconds N      Capture duration in seconds. Default: ${DEFAULT_SECONDS}`,
    '  --out-dir DIR    Output directory. Default: seed-pprof-YYYYMMDD-HHMMSS',
    '  --help           Show this help.',
  ].join('\n')
}

type ParsedArgs = {
  baseUrl: string
  seconds: number
  outDir: string
}

type FetchFailure = {
  required: boolean
  url: string
  outputPath: string
  message: string
}

const optionalFiles = {
  index: 'index.html',
  cmdline: 'cmdline.txt',
  version: 'version.json',
  buildInfo: 'buildinfo.json',
  metrics: 'metrics.txt',
  vars: 'vars.json',
  goroutineStart: 'goroutine-start-debug2.txt',
  goroutineEnd: 'goroutine-end-debug2.txt',
  heapLiveAfterGC: 'heap-live-after-gc.pb.gz',
  captureErrors: 'capture-errors.txt',
  readme: 'README.md',
  agents: 'AGENTS.md',
} as const

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

function parsePositiveInteger(raw: string, flag: string) {
  if (!/^\d+$/.test(raw)) {
    fail(`${flag} must be a positive integer number of seconds.`)
  }

  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value <= 0) {
    fail(`${flag} must be a positive integer number of seconds.`)
  }

  return value
}

function stripTrailingSlash(value: string) {
  return value.endsWith('/') ? value.slice(0, -1) : value
}

function urlVariants(raw: string) {
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return [raw]
  }

  if (parsed.hostname !== 'localhost') {
    return [raw]
  }

  const ipv4 = new URL(parsed)
  ipv4.hostname = '127.0.0.1'

  const ipv6 = new URL(parsed)
  ipv6.hostname = '::1'

  return [raw, ipv4.toString(), ipv6.toString()]
}

function withoutPprofSuffix(value: string) {
  return value.replace(/\/pprof$/, '')
}

function pad(value: number) {
  return String(value).padStart(2, '0')
}

function formatDirTimestamp(date = new Date()) {
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '-',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('')
}

function formatUtcTimestamp(date = new Date()) {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

function parseCliArgs(argv: string[]): ParsedArgs | null {
  try {
    const {values, positionals} = parseNodeArgs({
      args: argv,
      allowPositionals: false,
      strict: true,
      options: {
        help: {type: 'boolean'},
        'base-url': {type: 'string'},
        seconds: {type: 'string'},
        'out-dir': {type: 'string'},
      },
    })

    if (positionals.length > 0) {
      fail(`Unexpected positional arguments: ${positionals.join(' ')}.\n\n${usage()}`)
    }

    if (values.help) {
      return null
    }

    return {
      baseUrl: stripTrailingSlash(values['base-url'] ?? DEFAULT_BASE_URL),
      seconds: values.seconds ? parsePositiveInteger(values.seconds, '--seconds') : DEFAULT_SECONDS,
      outDir: values['out-dir'] || `seed-pprof-${formatDirTimestamp()}`,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    fail(`${message}.\n\n${usage()}`)
  }
}

async function fetchToFile(params: {
  url: string
  outputPath: string
  asText?: boolean
  required: boolean
}): Promise<FetchFailure | null> {
  const {url, outputPath, asText = false, required} = params

  let lastMessage = 'Unknown error'

  for (const candidateUrl of urlVariants(url)) {
    try {
      const response = await fetch(candidateUrl)
      if (!response.ok) {
        return {
          required,
          url: candidateUrl,
          outputPath,
          message: `HTTP ${response.status} ${response.statusText}`.trim(),
        }
      }

      const body = asText ? await response.text() : new Uint8Array(await response.arrayBuffer())

      await Bun.write(outputPath, body)
      return null
    } catch (error) {
      lastMessage = error instanceof Error ? error.message : String(error)
    }
  }

  return {required, url, outputPath, message: lastMessage}
}

function buildReadme(params: {
  baseUrl: string
  seconds: number
  startedAt: string
  endedAt: string
  scriptPath: string
}) {
  const {baseUrl, seconds, startedAt, endedAt, scriptPath} = params

  return `# Seed daemon profile capture

This folder contains a one-shot profile capture from \`${baseUrl}\`.

- Started at: \`${startedAt}\`.
- Ended at: \`${endedAt}\`.
- Requested window: \`${seconds}s\`.

## Main files

- \`cpu-${seconds}s.pb.gz\` — CPU profile for the capture window.
- \`trace-${seconds}s.out\` — Go trace for the same window.
- \`heap-delta-${seconds}s.pb.gz\` — Heap delta over the window.
- \`allocs-delta-${seconds}s.pb.gz\` — Allocation delta over the window.
- \`mutex-delta-${seconds}s.pb.gz\` — Mutex contention delta over the window.
- \`block-delta-${seconds}s.pb.gz\` — Blocking delta over the window.
- \`${optionalFiles.goroutineStart}\` — Goroutine dump at the start.
- \`${optionalFiles.goroutineEnd}\` — Goroutine dump at the end.
- \`${optionalFiles.metrics}\` — Metrics snapshot.

## Notes

- The \`*-delta-*\` files are windowed profiles, not simple snapshots.
- The profile requests were started together, so their windows line up closely.
- \`block\` and \`mutex\` still depend on the daemon's runtime sampling settings.
- If a file is missing, check \`${optionalFiles.captureErrors}\`.

## Useful commands

\`\`\`bash
go tool pprof -http=:0 ./cpu-${seconds}s.pb.gz
go tool pprof -http=:0 ./heap-delta-${seconds}s.pb.gz
go tool pprof -http=:0 ./mutex-delta-${seconds}s.pb.gz
go tool trace ./trace-${seconds}s.out
\`\`\`

## Re-running the capture

\`\`\`bash
bun ${scriptPath} --base-url ${JSON.stringify(baseUrl)} --seconds ${seconds}
\`\`\`
`
}

function buildAgentsGuide(params: {baseUrl: string; seconds: number}) {
  const {baseUrl, seconds} = params

  return `# Agent guide for this profile capture

Read \`README.md\` first for the human summary.

## What this folder is

This folder is a mostly aligned one-shot capture from \`${baseUrl}\` over a requested \`${seconds}s\` window.

Treat these files as the primary evidence for the capture window:

- \`cpu-${seconds}s.pb.gz\`.
- \`trace-${seconds}s.out\`.
- \`allocs-delta-${seconds}s.pb.gz\`.
- \`heap-delta-${seconds}s.pb.gz\`.
- \`goroutine-delta-${seconds}s.pb.gz\`.
- \`threadcreate-delta-${seconds}s.pb.gz\`.
- \`block-delta-${seconds}s.pb.gz\`.
- \`mutex-delta-${seconds}s.pb.gz\`.

Treat these files as supporting context, not the primary time window:

- \`${optionalFiles.goroutineStart}\`.
- \`${optionalFiles.goroutineEnd}\`.
- \`${optionalFiles.heapLiveAfterGC}\`.
- \`${optionalFiles.cmdline}\`.
- \`${optionalFiles.version}\`.
- \`${optionalFiles.buildInfo}\`.
- \`${optionalFiles.metrics}\`.
- \`${optionalFiles.vars}\`.
- \`${optionalFiles.index}\`.
- \`${optionalFiles.captureErrors}\`, if present.

## Interpretation rules

- Prefer the windowed \`*-delta-*\` files when comparing CPU, heap, allocation, mutex, and blocking behavior.
- Do not describe \`${optionalFiles.heapLiveAfterGC}\` as covering the same time window. It is a point-in-time GC-normalized snapshot.
- Do not assume exact simultaneity. The requests were launched concurrently over HTTP, so they are closely aligned but not perfectly synchronized.
- Be careful with \`block\` and \`mutex\`. Their usefulness depends on the daemon's runtime sampling settings during capture.
- Use the start and end goroutine dumps to identify stuck work, leaked goroutines, or major state transitions across the window.
- Use \`metrics.txt\` and \`vars.json\` to correlate pprof findings with queue depth, memory counters, request volume, or subsystem-specific counters.

## Suggested workflow

1. Inspect \`README.md\`.
2. Open \`cpu-${seconds}s.pb.gz\` in \`go tool pprof\`.
3. Check \`mutex-delta-${seconds}s.pb.gz\` and \`block-delta-${seconds}s.pb.gz\` for contention.
4. Check \`heap-delta-${seconds}s.pb.gz\` and \`allocs-delta-${seconds}s.pb.gz\` for memory growth.
5. Compare \`${optionalFiles.goroutineStart}\` and \`${optionalFiles.goroutineEnd}\`.
6. Use \`trace-${seconds}s.out\` if scheduler or latency behavior still looks unclear.

## Useful commands

\`\`\`bash
go tool pprof -top ./cpu-${seconds}s.pb.gz
go tool pprof -http=:0 ./mutex-delta-${seconds}s.pb.gz
go tool pprof -http=:0 ./block-delta-${seconds}s.pb.gz
go tool pprof -http=:0 ./allocs-delta-${seconds}s.pb.gz
go tool trace ./trace-${seconds}s.out
\`\`\`
`
}

async function main() {
  const parsed = parseCliArgs(process.argv.slice(2))
  if (!parsed) {
    console.log(usage())
    return
  }

  const {baseUrl, seconds, outDir} = parsed
  const debugBase = withoutPprofSuffix(baseUrl)
  const startedAt = formatUtcTimestamp()
  const scriptPath = join(dirname(process.argv[1] ?? 'scripts'), basename(process.argv[1] ?? 'profile-daemon.ts'))

  await mkdir(outDir, {recursive: true})

  console.log(`Collecting daemon profiles into ${outDir} for ${seconds}s ...`)

  const optionalFailures: FetchFailure[] = []
  const preflightRequests = [
    {url: `${baseUrl}/`, outputPath: join(outDir, optionalFiles.index), asText: true},
    {url: `${baseUrl}/cmdline`, outputPath: join(outDir, optionalFiles.cmdline), asText: true},
    {url: `${debugBase}/version`, outputPath: join(outDir, optionalFiles.version), asText: true},
    {url: `${debugBase}/buildinfo?format=json`, outputPath: join(outDir, optionalFiles.buildInfo), asText: true},
    {url: `${debugBase}/metrics`, outputPath: join(outDir, optionalFiles.metrics), asText: true},
    {url: `${debugBase}/vars`, outputPath: join(outDir, optionalFiles.vars), asText: true},
    {url: `${baseUrl}/goroutine?debug=2`, outputPath: join(outDir, optionalFiles.goroutineStart), asText: true},
    {url: `${baseUrl}/heap?gc=1`, outputPath: join(outDir, optionalFiles.heapLiveAfterGC)},
  ] as const

  for (const request of preflightRequests) {
    const failure = await fetchToFile({...request, required: false})
    if (failure) {
      optionalFailures.push(failure)
    }
  }

  const windowedRequests = [
    {url: `${baseUrl}/allocs?seconds=${seconds}`, outputPath: join(outDir, `allocs-delta-${seconds}s.pb.gz`)},
    {url: `${baseUrl}/block?seconds=${seconds}`, outputPath: join(outDir, `block-delta-${seconds}s.pb.gz`)},
    {url: `${baseUrl}/goroutine?seconds=${seconds}`, outputPath: join(outDir, `goroutine-delta-${seconds}s.pb.gz`)},
    {url: `${baseUrl}/heap?seconds=${seconds}`, outputPath: join(outDir, `heap-delta-${seconds}s.pb.gz`)},
    {url: `${baseUrl}/mutex?seconds=${seconds}`, outputPath: join(outDir, `mutex-delta-${seconds}s.pb.gz`)},
    {
      url: `${baseUrl}/threadcreate?seconds=${seconds}`,
      outputPath: join(outDir, `threadcreate-delta-${seconds}s.pb.gz`),
    },
    {url: `${baseUrl}/profile?seconds=${seconds}`, outputPath: join(outDir, `cpu-${seconds}s.pb.gz`)},
    {url: `${baseUrl}/trace?seconds=${seconds}`, outputPath: join(outDir, `trace-${seconds}s.out`)},
  ] as const

  const requiredFailures = (
    await Promise.all(windowedRequests.map((request) => fetchToFile({...request, required: true})))
  ).filter((failure): failure is FetchFailure => failure !== null)

  const goroutineEndFailure = await fetchToFile({
    url: `${baseUrl}/goroutine?debug=2`,
    outputPath: join(outDir, optionalFiles.goroutineEnd),
    asText: true,
    required: false,
  })
  if (goroutineEndFailure) {
    optionalFailures.push(goroutineEndFailure)
  }

  const endedAt = formatUtcTimestamp()

  await Bun.write(join(outDir, optionalFiles.readme), buildReadme({baseUrl, seconds, startedAt, endedAt, scriptPath}))
  await Bun.write(join(outDir, optionalFiles.agents), buildAgentsGuide({baseUrl, seconds}))

  const failures = [...optionalFailures, ...requiredFailures]
  if (failures.length > 0) {
    const failureText = failures
      .map((failure, index) =>
        [
          `${index + 1}. ${failure.required ? 'required' : 'optional'} request failed.`,
          `   URL: ${failure.url}`,
          `   Output: ${failure.outputPath}`,
          `   Error: ${failure.message}`,
        ].join('\n'),
      )
      .join('\n\n')

    await Bun.write(join(outDir, optionalFiles.captureErrors), `${failureText}\n`)
  }

  if (requiredFailures.length > 0) {
    console.error()
    console.error('Done, but one or more windowed profile requests failed.')
    console.error(`See ${join(outDir, optionalFiles.captureErrors)} for details.`)
    console.error(outDir)
    process.exit(1)
  }

  console.log()
  console.log('Done. Please send me this folder:')
  console.log(outDir)
}

main()
