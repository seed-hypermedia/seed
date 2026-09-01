/**
 * Agents service configuration.
 *
 * Keep runtime configuration in this module instead of reading `process.env` throughout
 * server code. Environment variables provide defaults and command-line flags override
 * them for local development and deployments.
 */

/** HTTP bind configuration for the Agents service. */
export type Server = {
  hostname: string
  port: number
}

import {parseLogLevel, type LogLevel} from '@/log'

/** Runtime configuration for the Agents service. */
export type Config = {
  http: Server
  dbPath: string
  dataDir: string
  /** Minimum log level emitted; `debug` turns the per-delta/per-poll hot-path lines back on. */
  logLevel: LogLevel
  /**
   * Offer subscription (OAuth) provider sign-in ("Sign in with ChatGPT").
   * Explicit opt-in: the flow needs a client that can catch the provider's
   * localhost redirect (the desktop app) or a user willing to paste it.
   */
  subscriptionAuth: boolean
  /** Generate titles for untitled sessions with a dedicated model call. */
  titleGeneration: boolean
  activity: {
    hmServerUrl: string
    /** HTTP endpoint serving `/ipfs/*`; defaults to hmServerUrl when both surfaces share a host. */
    ipfsServerUrl: string
    pollIntervalMs: number
    pageSize: number
    maxPagesPerPoll: number
  }
  web: {
    /** Self-hosted SearXNG base URL for web_search. Undefined disables web_search. */
    searxngUrl?: string
    /** Optional self-hosted Crawl4AI base URL for web_read browser-render escalation. */
    crawlerUrl?: string
    /** Bearer token for Crawl4AI (required by Crawl4AI >= 0.9). */
    crawlerToken?: string
  }
  exec: {
    /** Code-execution backend: 'microsandbox' or '' to disable. */
    backend: '' | 'microsandbox'
    /** OCI image for sandbox rootfs. */
    image: string
    /** OCI image for the `ts` runtime; needs bun on PATH. Defaults to `oven/bun`; explicitly empty leaves TypeScript unavailable. */
    tsImage: string
    /** Virtual CPUs per sandbox. */
    cpus: number
    /** Guest memory per sandbox in MiB. */
    memoryMib: number
    /** Default per-execution timeout in seconds. */
    timeoutSecs: number
    /** Allow outbound network access from sandboxes. */
    allowNetwork: boolean
    /** Upstream DNS nameservers for sandbox name resolution. */
    dnsServers: string[]
    /** Keep microVMs alive between executions (docs/exec-warm-pool.md). Off unless opted in. */
    warmPool: boolean
    /** Maximum live pooled VMs host-wide. */
    poolMaxVms: number
    /** Idle time before a parked pooled VM is disposed. */
    poolIdleTtlMs: number
    /** Hard lifetime of a pooled VM from boot. */
    poolVmLifetimeMs: number
  }
  runQueue: {
    /** Model-backed runs executed concurrently. Everything shares one event loop, so size this to the host. */
    maxConcurrentModelRuns: number
    /** Workflow runs executed concurrently (they mostly park waiting on children). */
    maxConcurrentWorkflows: number
  }
}

/** Parsed command-line flags accepted by the Agents service. */
export type Flags = {
  'server-hostname': string
  'server-port': number
  'db-path': string
  'data-dir': string
  'hm-server-url': string
  'ipfs-server-url': string
  'activity-poll-interval-ms': number
  'activity-page-size': number
  'activity-max-pages': number
  'searxng-url': string
  'crawler-url': string
  'crawler-token': string
  'exec-backend': string
  'subscription-auth': boolean
  'session-title-generation': boolean
  'exec-image': string
  'exec-ts-image': string
  'exec-cpus': number
  'exec-memory-mib': number
  'exec-timeout-secs': number
  'exec-allow-network': string
  'exec-dns': string
  'exec-warm-pool': string
  'exec-max-vms': number
  'max-concurrent-model-runs': number
  'max-concurrent-workflows': number
  'log-level': string
}

/** Creates default flag values from the current environment. */
export function flags(env: NodeJS.ProcessEnv = process.env): Flags {
  return {
    'server-hostname': env.SEED_AGENTS_HTTP_HOSTNAME || '0.0.0.0',
    'server-port': Number(env.SEED_AGENTS_HTTP_PORT) || 3050,
    'db-path': env.SEED_AGENTS_DB_PATH || './data/agents.sqlite',
    'data-dir': env.SEED_AGENTS_DATA_DIR || './data',
    'hm-server-url': env.SEED_AGENTS_HM_SERVER_URL || 'https://hyper.media',
    'ipfs-server-url': env.SEED_AGENTS_IPFS_SERVER_URL || '',
    'activity-poll-interval-ms': Number(env.SEED_AGENTS_ACTIVITY_POLL_INTERVAL_MS) || 5_000,
    'activity-page-size': Number(env.SEED_AGENTS_ACTIVITY_PAGE_SIZE) || 50,
    'activity-max-pages': Number(env.SEED_AGENTS_ACTIVITY_MAX_PAGES) || 5,
    'searxng-url': env.SEED_AGENTS_SEARXNG_URL || '',
    'crawler-url': env.SEED_AGENTS_CRAWLER_URL || '',
    'crawler-token': env.SEED_AGENTS_CRAWLER_TOKEN || '',
    'exec-backend': env.SEED_AGENTS_EXEC_BACKEND ?? 'microsandbox',
    'subscription-auth': isTruthyFlag(env.SEED_AGENTS_SUBSCRIPTION_AUTH ?? ''),
    'session-title-generation': env.SEED_AGENTS_SESSION_TITLE_GENERATION !== 'false',
    'exec-image': env.SEED_AGENTS_EXEC_IMAGE || 'python',
    'exec-ts-image': env.SEED_AGENTS_EXEC_TS_IMAGE ?? 'oven/bun',
    'exec-cpus': Number(env.SEED_AGENTS_EXEC_CPUS) || 1,
    'exec-memory-mib': Number(env.SEED_AGENTS_EXEC_MEMORY_MIB) || 512,
    'exec-timeout-secs': Number(env.SEED_AGENTS_EXEC_TIMEOUT_SECS) || 60,
    'exec-allow-network': env.SEED_AGENTS_EXEC_ALLOW_NETWORK ?? '',
    'exec-dns': env.SEED_AGENTS_EXEC_DNS || '',
    'exec-warm-pool': env.SEED_AGENTS_EXEC_WARM_POOL ?? '',
    'exec-max-vms': Number(env.SEED_AGENTS_EXEC_MAX_VMS) || 3,
    'max-concurrent-model-runs': Number(env.SEED_AGENTS_MAX_CONCURRENT_MODEL_RUNS) || 8,
    'max-concurrent-workflows': Number(env.SEED_AGENTS_MAX_CONCURRENT_WORKFLOWS) || 32,
    'log-level': env.SEED_AGENTS_LOG_LEVEL || 'info',
  }
}

/** Parses supported `--k=v` and `--k v` CLI arguments over environment defaults. */
export function parseArgs(argv: string[] = process.argv.slice(2), env: NodeJS.ProcessEnv = process.env): Flags {
  const parsed = {...flags(env)}

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (!arg?.startsWith('--')) {
      throw new Error(`Unexpected argument: ${arg}`)
    }

    const raw = arg.slice(2)
    const eqIndex = raw.indexOf('=')
    const key = (eqIndex === -1 ? raw : raw.slice(0, eqIndex)) as keyof Flags
    const value = eqIndex === -1 ? argv[++i] : raw.slice(eqIndex + 1)

    if (!(key in parsed)) {
      throw new Error(`Unknown flag: --${key}`)
    }
    if (value === undefined || value === '') {
      throw new Error(`Missing value for --${key}`)
    }

    if (key === 'server-port') {
      parsed[key] = parsePort(value)
    } else if (key === 'subscription-auth') {
      parsed[key] = isTruthyFlag(value)
    } else if (
      key === 'activity-poll-interval-ms' ||
      key === 'activity-page-size' ||
      key === 'activity-max-pages' ||
      key === 'exec-cpus' ||
      key === 'exec-memory-mib' ||
      key === 'exec-timeout-secs' ||
      key === 'max-concurrent-model-runs' ||
      key === 'max-concurrent-workflows'
    ) {
      parsed[key] = parsePositiveInteger(value, key)
    } else {
      parsed[key] = value as never
    }
  }

  return parsed
}

/** Creates validated service configuration from parsed flags. */
export function create(pflags: Flags): Config {
  if (!pflags['server-hostname']) {
    throw new Error('Server hostname configuration is required')
  }

  return {
    http: {
      hostname: pflags['server-hostname'],
      port: parsePort(String(pflags['server-port'])),
    },
    dbPath: pflags['db-path'],
    dataDir: pflags['data-dir'],
    logLevel: parseLogLevel(pflags['log-level']),
    activity: {
      hmServerUrl: normalizeHttpUrl(pflags['hm-server-url'], 'HM server URL'),
      ipfsServerUrl: normalizeHttpUrl(pflags['ipfs-server-url'] || pflags['hm-server-url'], 'IPFS server URL'),
      pollIntervalMs: parsePositiveInteger(String(pflags['activity-poll-interval-ms']), 'activity-poll-interval-ms'),
      pageSize: parsePositiveInteger(String(pflags['activity-page-size']), 'activity-page-size'),
      maxPagesPerPoll: parsePositiveInteger(String(pflags['activity-max-pages']), 'activity-max-pages'),
    },
    web: {
      searxngUrl: optionalHttpUrl(pflags['searxng-url'], 'SearXNG URL'),
      crawlerUrl: optionalHttpUrl(pflags['crawler-url'], 'Crawler URL'),
      crawlerToken: pflags['crawler-token'].trim() || undefined,
    },
    exec: {
      backend: parseExecBackend(pflags['exec-backend']),
      image: pflags['exec-image'].trim() || 'python',
      tsImage: pflags['exec-ts-image'].trim(),
      cpus: parsePositiveInteger(String(pflags['exec-cpus']), 'exec-cpus'),
      memoryMib: parsePositiveInteger(String(pflags['exec-memory-mib']), 'exec-memory-mib'),
      timeoutSecs: parsePositiveInteger(String(pflags['exec-timeout-secs']), 'exec-timeout-secs'),
      allowNetwork: isNetworkEnabled(pflags['exec-allow-network']),
      dnsServers: parseDnsServers(pflags['exec-dns']),
      // Opt-in polarity, unlike allowNetwork: pooling changes execution semantics, so it must be
      // asked for explicitly (SEED_AGENTS_EXEC_WARM_POOL=1) until it is the proven default.
      warmPool: isFlagEnabled(pflags['exec-warm-pool']),
      poolMaxVms: parsePositiveInteger(String(pflags['exec-max-vms']), 'exec-max-vms'),
      poolIdleTtlMs: 10 * 60_000,
      poolVmLifetimeMs: 30 * 60_000,
    },
    runQueue: {
      maxConcurrentModelRuns: parsePositiveInteger(
        String(pflags['max-concurrent-model-runs']),
        'max-concurrent-model-runs',
      ),
      maxConcurrentWorkflows: parsePositiveInteger(
        String(pflags['max-concurrent-workflows']),
        'max-concurrent-workflows',
      ),
    },
    subscriptionAuth: pflags['subscription-auth'],
    titleGeneration: pflags['session-title-generation'],
  }
}

/** Interprets a boolean flag value; only explicit truthy spellings enable it. */
function isTruthyFlag(value: string): boolean {
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())
}

/** Parses a comma-separated DNS server list; empty falls back to the executor default resolvers. */
function parseDnsServers(value: string): string[] {
  return value
    .split(',')
    .map((server) => server.trim())
    .filter(Boolean)
}

/**
 * Interprets the exec network flag. Network is ON by default (agents commonly need to install
 * packages and fetch data); set the flag to a falsy value to disable it.
 */
function isNetworkEnabled(value: string): boolean {
  return !['0', 'false', 'no', 'off'].includes(value.trim().toLowerCase())
}

/** True only when a flag is explicitly turned on; empty means off. */
function isFlagEnabled(value: string): boolean {
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())
}

/** Parses the code-execution backend flag; empty disables execution. */
function parseExecBackend(value: string): '' | 'microsandbox' {
  const trimmed = value.trim()
  if (trimmed === '' || trimmed === 'off' || trimmed === 'none') return ''
  if (trimmed === 'microsandbox') return 'microsandbox'
  throw new Error(`Invalid exec backend: ${value} (expected "microsandbox" or empty)`)
}

/** Normalizes an optional http(s) URL flag; returns undefined when unset. */
function optionalHttpUrl(value: string, label: string): string | undefined {
  return value.trim() ? normalizeHttpUrl(value, label) : undefined
}

function normalizeHttpUrl(value: string, label: string): string {
  const trimmed = value.trim().replace(/\/+$/, '')
  if (!trimmed) throw new Error(`${label} is required`)
  const url = new URL(trimmed)
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    throw new Error(`${label} must start with http:// or https://`)
  return url.toString().replace(/\/$/, '')
}

function parsePositiveInteger(value: string, label: string): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`Invalid ${label}: ${value}`)
  return parsed
}

function parsePort(value: string): number {
  const port = Number(value)
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    throw new Error(`Invalid server port: ${value}`)
  }
  return port
}
