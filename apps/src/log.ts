/**
 * Leveled logging for the Agents service.
 *
 * Production measurement (2026-08-29) put the server at ~440k log lines/hour, dominated by
 * per-delta WebSocket lines and per-poll activity lines — noise that costs real CPU on a busy
 * host and buries the lines an operator actually reads. Those hot-path sites now log at `debug`,
 * which is off by default; everything an operator needs to follow the service (run lifecycle,
 * trigger firings, subscriptions, warnings, errors) stays at `info` and above.
 *
 * The threshold is process-wide module state set once at startup from configuration
 * (`SEED_AGENTS_LOG_LEVEL` / `--log-level`), so hot paths pay one integer compare per call and
 * modules need no config threading.
 */

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const
export type LogLevel = (typeof LOG_LEVELS)[number]

const RANK: Record<LogLevel, number> = {debug: 10, info: 20, warn: 30, error: 40}

let threshold = RANK.info

/** Parses a log level string, throwing on anything that is not a known level. */
export function parseLogLevel(value: string): LogLevel {
  const normalized = value.trim().toLowerCase()
  if ((LOG_LEVELS as readonly string[]).includes(normalized)) return normalized as LogLevel
  throw new Error(`Invalid log level: ${value} (expected ${LOG_LEVELS.join(', ')})`)
}

/** Sets the process-wide log threshold. Called once at startup from configuration. */
export function setLogLevel(level: LogLevel): void {
  threshold = RANK[level]
}

export const log = {
  /** True when debug lines would be emitted, for callers that build expensive log payloads. */
  get debugEnabled(): boolean {
    return threshold <= RANK.debug
  },
  debug(...args: unknown[]): void {
    if (threshold <= RANK.debug) console.log(...args)
  },
  info(...args: unknown[]): void {
    if (threshold <= RANK.info) console.info(...args)
  },
  warn(...args: unknown[]): void {
    if (threshold <= RANK.warn) console.warn(...args)
  },
  error(...args: unknown[]): void {
    if (threshold <= RANK.error) console.error(...args)
  },
}
