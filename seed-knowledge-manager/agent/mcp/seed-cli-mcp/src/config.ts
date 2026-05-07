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
  /** When true, drivers refuse to start unless `seed-cli site sync-status`
   *  reports ready_for_writes. Set via KM_USE_LOCAL_DAEMON=1. */
  useLocalDaemon: boolean
  /** Account id whose WRITER capability gates ready_for_writes. Defaults to
   *  KM_AID; if absent, falls back to "any writer cap present". */
  writerAid: string | null
  /** When true, poll-cli replaces the ad-hoc two-pass loop with the XState
   *  supervisor (machines/supervisor.ts). Set via KM_USE_STATE_MACHINE=1. */
  useStateMachine: boolean
  /** When true, finalisation calls the Mastra agent via agent/mastra-agent.ts
   *  instead of reply-engine.draftReply. Set via KM_USE_MASTRA_AGENT=1. */
  useMastraAgent: boolean
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
    useLocalDaemon: env.KM_USE_LOCAL_DAEMON === '1' || env.KM_USE_LOCAL_DAEMON === 'true',
    writerAid: env.KM_AID ?? null,
    useStateMachine: env.KM_USE_STATE_MACHINE === '1' || env.KM_USE_STATE_MACHINE === 'true',
    useMastraAgent: env.KM_USE_MASTRA_AGENT === '1' || env.KM_USE_MASTRA_AGENT === 'true',
  }
}

function numberOr(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : fallback
}
