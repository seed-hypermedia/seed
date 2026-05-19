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

/** Runtime configuration for the Agents service. */
export type Config = {
  http: Server
  dbPath: string
  dataDir: string
  activity: {
    hmServerUrl: string
    pollIntervalMs: number
    pageSize: number
    maxPagesPerPoll: number
  }
}

/** Parsed command-line flags accepted by the Agents service. */
export type Flags = {
  'server-hostname': string
  'server-port': number
  'db-path': string
  'data-dir': string
  'hm-server-url': string
  'activity-poll-interval-ms': number
  'activity-page-size': number
  'activity-max-pages': number
}

/** Creates default flag values from the current environment. */
export function flags(env: NodeJS.ProcessEnv = process.env): Flags {
  return {
    'server-hostname': env.SEED_AGENTS_HTTP_HOSTNAME || '0.0.0.0',
    'server-port': Number(env.SEED_AGENTS_HTTP_PORT) || 3050,
    'db-path': env.SEED_AGENTS_DB_PATH || './data/agents.sqlite',
    'data-dir': env.SEED_AGENTS_DATA_DIR || './data',
    'hm-server-url': env.SEED_AGENTS_HM_SERVER_URL || 'http://localhost:3000',
    'activity-poll-interval-ms': Number(env.SEED_AGENTS_ACTIVITY_POLL_INTERVAL_MS) || 5_000,
    'activity-page-size': Number(env.SEED_AGENTS_ACTIVITY_PAGE_SIZE) || 50,
    'activity-max-pages': Number(env.SEED_AGENTS_ACTIVITY_MAX_PAGES) || 5,
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
    } else if (key === 'activity-poll-interval-ms' || key === 'activity-page-size' || key === 'activity-max-pages') {
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
    activity: {
      hmServerUrl: normalizeHttpUrl(pflags['hm-server-url'], 'HM server URL'),
      pollIntervalMs: parsePositiveInteger(String(pflags['activity-poll-interval-ms']), 'activity-poll-interval-ms'),
      pageSize: parsePositiveInteger(String(pflags['activity-page-size']), 'activity-page-size'),
      maxPagesPerPoll: parsePositiveInteger(String(pflags['activity-max-pages']), 'activity-max-pages'),
    },
  }
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
