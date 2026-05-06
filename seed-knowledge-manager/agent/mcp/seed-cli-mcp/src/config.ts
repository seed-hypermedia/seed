/**
 * Runtime configuration sourced from environment variables. The MCP server
 * is launched by `nanobot gateway`, which forwards these via the `env`
 * field of the `mcpServers` entry in `~/.nanobot/config.json`.
 */

export type AgentConfig = {
  seedServer: string
  seedSite: string
  keyName: string
  cliPath: string
  stateDir: string
  logsDir: string
  rulesTtlMs: number
  writersTtlMs: number
  governanceBasePath: string
}

const DEFAULT_RULES_TTL_MS = 60_000
const DEFAULT_WRITERS_TTL_MS = 5 * 60_000

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AgentConfig {
  const required = ['SEED_SERVER', 'SEED_SITE'] as const
  for (const key of required) {
    if (!env[key]) {
      throw new Error(`Missing required env var: ${key}`)
    }
  }
  return {
    seedServer: env.SEED_SERVER!,
    seedSite: env.SEED_SITE!,
    keyName: env.KM_KEY_NAME ?? 'knowledge-manager',
    cliPath: env.SEED_CLI_PATH ?? '/home/km/.local/bin/seed-cli',
    stateDir: env.KM_STATE_DIR ?? '/home/km/km-state',
    logsDir: env.KM_LOGS_DIR ?? '/home/km/km-logs',
    rulesTtlMs: numberOr(env.KM_RULES_TTL_MS, DEFAULT_RULES_TTL_MS),
    writersTtlMs: numberOr(env.KM_WRITERS_TTL_MS, DEFAULT_WRITERS_TTL_MS),
    governanceBasePath: env.KM_GOVERNANCE_BASE_PATH ?? '/agents/knowledge-manager',
  }
}

function numberOr(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : fallback
}
