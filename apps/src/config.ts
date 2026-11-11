/**
 * Agents service configuration.
 *
 * Keep runtime configuration in this module instead of reading `process.env` throughout
 * server code. Environment variables provide defaults and command-line flags override
 * them for local development and deployments.
 *
 * `SEED_AGENTS_APP_<SLUG>_<ARG>` variables have no flag: each is the value of one server-scope
 * app argument (a shared API key the operator provides for an app installed server-wide), keyed by
 * that suffix in `apps.serverArgs`. `SEED_AGENTS_DATALAB_API_KEY` remains the older spelling of
 * the convert app's `apiKey`.
 */

/** HTTP bind configuration for the Agents service. */
export type Server = {
  hostname: string
  port: number
}

import {parseLogLevel, type LogLevel} from '@/log'
import {defaultExecMaxConcurrent} from './code-exec'

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
  /** The document a new agent's system prompt embeds (the Agent Guide), reported in /api/health. */
  defaultPromptUrl: string
  /** Where `hm://hyper.media` (the Hypermedia knowledge base) resolves. See docs-space.ts. */
  docs: {
    /** The knowledge base account. */
    account?: string
    /** A file naming the knowledge base account, re-read on every use (the dev loop writes one). */
    accountFile?: string
  }
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
  apps: {
    /** Server-scope app argument values from the environment, keyed `<SLUG>_<ARG>` in upper case. */
    serverArgs: Record<string, string>
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
    /** Keep microVMs alive between executions (hypermedia/agent/plans/exec-warm-pool.md). Off unless opted in. */
    warmPool: boolean
    /** Maximum retained pool entries — transient overflow VMs can exceed it (see CodeExecConfig). */
    poolMaxVms: number
    /** Idle time before a parked pooled VM is disposed. */
    poolIdleTtlMs: number
    /** Maximum age of a pooled VM, enforced only between calls (never mid-use). */
    poolVmMaxAgeMs: number
    /** Hard cap on sandboxes on loan at once, host-wide (a real limit, unlike poolMaxVms). */
    maxConcurrent: number
    /** How long an acquire may wait for a host-wide slot before failing with a retryable error. */
    acquireWaitMs: number
    /** How long an acquire may wait for the agent's memory-root lease (one sandbox per agent memory at a time). */
    memoryRootWaitMs: number
  }
  runQueue: {
    /** Model-backed runs executed concurrently. Everything shares one event loop, so size this to the host. */
    maxConcurrentModelRuns: number
    /** Workflow runs executed concurrently (they mostly park waiting on children). */
    maxConcurrentWorkflows: number
  }
  storage: {
    /**
     * Free space the database's file system must have before the queue starts another run. A turn
     * that starts on a full disk cannot record itself; below this the queue holds runs instead.
     * Zero disables the check.
     */
    minFreeDiskBytes: number
  }
  /**
   * How often the exec canary boots a fresh sandbox to prove code execution works end to end
   * (`/api/metrics`, `/api/health`). Zero disables it; the hosted server turns it on.
   */
  execCanaryIntervalMs: number
  /** SQLite connection tuning and the data-retention policy (see db-retention.ts). */
  database: {
    /** SQLite page cache (private memory). */
    cacheBytes: number
    /** Memory-mapped reads (reclaimable page cache), capped by SQLite's compiled maximum. */
    mmapBytes: number
    /** Size the WAL is truncated back to after a checkpoint. */
    walLimitBytes: number
    retention: {
      /** `on` removes, `report` only logs what it would remove, `off` never runs. */
      mode: 'on' | 'report' | 'off'
      /** Idle time after which a session's durable store is dropped (rebuilt on its next turn); 0 disables. */
      durableIdleMs: number
      /** Age after a run finished at which its journal's large payloads are compacted; 0 disables. */
      journalAgeMs: number
      /** Disk budget for retention work; 0 is unthrottled. */
      bytesPerSecond: number
      /** Durable stores larger than this are left for an offline pass. */
      maxStoreBytes: number
      /** Time between retention passes. */
      intervalMs: number
    }
    /** Cap on one string inside a stored tool output, in characters; 0 disables. */
    toolOutputStoreLimitChars: number
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
  'default-prompt-url': string
  'docs-account': string
  'docs-account-file': string
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
  'exec-pool-idle-ttl-secs': number
  'exec-pool-max-age-secs': number
  'exec-max-concurrent': number
  'exec-acquire-wait-secs': number
  'exec-memory-root-wait-secs': number
  'max-concurrent-model-runs': number
  'max-concurrent-workflows': number
  'min-free-disk-mib': number
  'exec-canary-secs': number
  'log-level': string
  'sqlite-cache-mib': number
  'sqlite-mmap-mib': number
  'sqlite-wal-limit-mib': number
  retention: string
  'retention-durable-idle-days': number
  'retention-journal-days': number
  'retention-mib-per-sec': number
  'retention-max-store-mib': number
  'retention-interval-mins': number
  'tool-output-store-limit-kib': number
}

/** Flags that take a non-negative number (fractions allowed). */
const NON_NEGATIVE_NUMBER_FLAGS = [
  'sqlite-cache-mib',
  'sqlite-mmap-mib',
  'sqlite-wal-limit-mib',
  'retention-durable-idle-days',
  'retention-journal-days',
  'retention-mib-per-sec',
  'retention-max-store-mib',
  'retention-interval-mins',
  'tool-output-store-limit-kib',
] as const satisfies readonly (keyof Flags)[]

/** An unset or empty variable takes the default; anything else must parse (checked in {@link create}). */
function numberFromEnv(value: string | undefined, fallback: number): number {
  return value === undefined || value.trim() === '' ? fallback : Number(value)
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
    'default-prompt-url':
      env.SEED_AGENTS_DEFAULT_PROMPT_URL || 'hm://z6MkfzKMhF9k1oPaQsShWAg8xJzbWf5kaZgn1MkeZvhcAsmB/agent/guide',
    'docs-account': env.SEED_AGENTS_DOCS_ACCOUNT || '',
    'docs-account-file': env.SEED_AGENTS_DOCS_ACCOUNT_FILE || '',
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
    'exec-pool-idle-ttl-secs': Number(env.SEED_AGENTS_EXEC_POOL_IDLE_TTL_SECS) || 180,
    'exec-pool-max-age-secs': Number(env.SEED_AGENTS_EXEC_POOL_MAX_AGE_SECS) || 1800,
    'exec-max-concurrent': Number(env.SEED_AGENTS_EXEC_MAX_CONCURRENT) || defaultExecMaxConcurrent(),
    'exec-acquire-wait-secs': Number(env.SEED_AGENTS_EXEC_ACQUIRE_WAIT_SECS) || 30,
    'exec-memory-root-wait-secs': Number(env.SEED_AGENTS_EXEC_MEMORY_ROOT_WAIT_SECS) || 300,
    'max-concurrent-model-runs': Number(env.SEED_AGENTS_MAX_CONCURRENT_MODEL_RUNS) || 8,
    'max-concurrent-workflows': Number(env.SEED_AGENTS_MAX_CONCURRENT_WORKFLOWS) || 32,
    'min-free-disk-mib':
      env.SEED_AGENTS_MIN_FREE_DISK_MIB === undefined || env.SEED_AGENTS_MIN_FREE_DISK_MIB === ''
        ? 512
        : Number(env.SEED_AGENTS_MIN_FREE_DISK_MIB),
    'exec-canary-secs': Number(env.SEED_AGENTS_EXEC_CANARY_SECS) || 0,
    'log-level': env.SEED_AGENTS_LOG_LEVEL || 'info',
    'sqlite-cache-mib': numberFromEnv(env.SEED_AGENTS_SQLITE_CACHE_MIB, 256),
    'sqlite-mmap-mib': numberFromEnv(env.SEED_AGENTS_SQLITE_MMAP_MIB, 1024),
    'sqlite-wal-limit-mib': numberFromEnv(env.SEED_AGENTS_SQLITE_WAL_LIMIT_MIB, 64),
    retention: env.SEED_AGENTS_RETENTION || 'on',
    'retention-durable-idle-days': numberFromEnv(env.SEED_AGENTS_RETENTION_DURABLE_IDLE_DAYS, 14),
    'retention-journal-days': numberFromEnv(env.SEED_AGENTS_RETENTION_JOURNAL_DAYS, 30),
    'retention-mib-per-sec': numberFromEnv(env.SEED_AGENTS_RETENTION_MIB_PER_SEC, 2),
    'retention-max-store-mib': numberFromEnv(env.SEED_AGENTS_RETENTION_MAX_STORE_MIB, 32),
    'retention-interval-mins': numberFromEnv(env.SEED_AGENTS_RETENTION_INTERVAL_MINS, 360),
    'tool-output-store-limit-kib': numberFromEnv(env.SEED_AGENTS_TOOL_OUTPUT_STORE_LIMIT_KIB, 128),
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
    } else if (key === 'min-free-disk-mib' || key === 'exec-canary-secs') {
      parsed[key] = parseNonNegativeInteger(value, key)
    } else if ((NON_NEGATIVE_NUMBER_FLAGS as readonly string[]).includes(key)) {
      parsed[key] = parseNonNegativeNumber(value, key) as never
    } else {
      parsed[key] = value as never
    }
  }

  return parsed
}

/**
 * `SEED_AGENTS_APP_<SLUG>_<ARG>` variables, keyed by that suffix: the server-scope app arguments
 * the operator provides. `SEED_AGENTS_DATALAB_API_KEY`, the spelling from before installs existed,
 * still provides the convert app's key.
 */
export function serverAppArgs(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const out: Record<string, string> = {}
  if (env.SEED_AGENTS_DATALAB_API_KEY?.trim()) out.CONVERT_APIKEY = env.SEED_AGENTS_DATALAB_API_KEY.trim()
  for (const [key, value] of Object.entries(env)) {
    if (key.startsWith('SEED_AGENTS_APP_') && value) out[key.slice('SEED_AGENTS_APP_'.length)] = value
  }
  return out
}

/** Creates validated service configuration from parsed flags. */
export function create(pflags: Flags, env: NodeJS.ProcessEnv = process.env): Config {
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
    defaultPromptUrl: pflags['default-prompt-url'].trim(),
    docs: {
      account: pflags['docs-account'].trim() || undefined,
      accountFile: pflags['docs-account-file'].trim() || undefined,
    },
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
    apps: {serverArgs: serverAppArgs(env)},
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
      poolIdleTtlMs: parsePositiveInteger(String(pflags['exec-pool-idle-ttl-secs']), 'exec-pool-idle-ttl-secs') * 1000,
      poolVmMaxAgeMs: parsePositiveInteger(String(pflags['exec-pool-max-age-secs']), 'exec-pool-max-age-secs') * 1000,
      maxConcurrent: parsePositiveInteger(String(pflags['exec-max-concurrent']), 'exec-max-concurrent'),
      acquireWaitMs: parsePositiveInteger(String(pflags['exec-acquire-wait-secs']), 'exec-acquire-wait-secs') * 1000,
      memoryRootWaitMs:
        parsePositiveInteger(String(pflags['exec-memory-root-wait-secs']), 'exec-memory-root-wait-secs') * 1000,
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
    storage: {
      minFreeDiskBytes: parseNonNegativeInteger(String(pflags['min-free-disk-mib']), 'min-free-disk-mib') * 1_048_576,
    },
    database: {
      cacheBytes: Math.floor(parseNonNegativeNumber(String(pflags['sqlite-cache-mib']), 'sqlite-cache-mib') * MIB),
      mmapBytes: Math.floor(parseNonNegativeNumber(String(pflags['sqlite-mmap-mib']), 'sqlite-mmap-mib') * MIB),
      walLimitBytes: Math.floor(
        parseNonNegativeNumber(String(pflags['sqlite-wal-limit-mib']), 'sqlite-wal-limit-mib') * MIB,
      ),
      retention: {
        mode: parseRetentionMode(pflags.retention),
        durableIdleMs:
          parseNonNegativeNumber(String(pflags['retention-durable-idle-days']), 'retention-durable-idle-days') * DAY,
        journalAgeMs: parseNonNegativeNumber(String(pflags['retention-journal-days']), 'retention-journal-days') * DAY,
        bytesPerSecond: Math.floor(
          parseNonNegativeNumber(String(pflags['retention-mib-per-sec']), 'retention-mib-per-sec') * MIB,
        ),
        maxStoreBytes: Math.floor(
          parseNonNegativeNumber(String(pflags['retention-max-store-mib']), 'retention-max-store-mib') * MIB,
        ),
        intervalMs: Math.max(
          60_000,
          parseNonNegativeNumber(String(pflags['retention-interval-mins']), 'retention-interval-mins') * 60_000,
        ),
      },
      toolOutputStoreLimitChars: Math.floor(
        parseNonNegativeNumber(String(pflags['tool-output-store-limit-kib']), 'tool-output-store-limit-kib') * 1024,
      ),
    },
    subscriptionAuth: pflags['subscription-auth'],
    titleGeneration: pflags['session-title-generation'],
    execCanaryIntervalMs: parseNonNegativeInteger(String(pflags['exec-canary-secs']), 'exec-canary-secs') * 1000,
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

function parseNonNegativeInteger(value: string, label: string): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`Invalid ${label}: ${value}`)
  return parsed
}

const MIB = 1_048_576
const DAY = 86_400_000

function parseNonNegativeNumber(value: string, label: string): number {
  const parsed = Number(value)
  if (value.trim() === '' || !Number.isFinite(parsed) || parsed < 0) throw new Error(`Invalid ${label}: ${value}`)
  return parsed
}

/** `on` (default), `report` (log only), or `off`; the usual boolean spellings map to on/off. */
function parseRetentionMode(value: string): 'on' | 'report' | 'off' {
  const normalized = value.trim().toLowerCase()
  if (normalized === 'report' || normalized === 'dry-run') return 'report'
  if (['', 'on', '1', 'true', 'yes'].includes(normalized)) return 'on'
  if (['off', '0', 'false', 'no', 'none'].includes(normalized)) return 'off'
  throw new Error(`Invalid retention mode: ${value} (expected on, report or off)`)
}

function parsePort(value: string): number {
  const port = Number(value)
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    throw new Error(`Invalid server port: ${value}`)
  }
  return port
}
