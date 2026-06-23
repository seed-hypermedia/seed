/**
 * stdio MCP server entry point. Boots the wrapper, registers all tools,
 * and connects to nanobot's stdio transport.
 *
 * Lifecycle:
 *   1. Parse env (SEED_SERVER, SEED_SITE, KM_KEY_NAME, KM_STATE_DIR, KM_LOGS_DIR).
 *   2. Build a Redactor from secret env vars.
 *   3. Start an AuditRun for this process invocation.
 *   4. Resolve the agent's accountId by calling `seed-cli key list`.
 *   5. Register MCP tools.
 *   6. Listen on stdio until parent exits, then close the audit run.
 */

import {Server} from '@modelcontextprotocol/sdk/server/index.js'
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js'
import {AuditRun} from './audit.js'
import {loadConfig} from './config.js'
import {GovernanceCache} from './governance.js'
import {buildRedactor} from './redact.js'
import {SeedCli} from './seedcli.js'
import {State} from './state.js'
import {buildTools, registerToolHandlers} from './tools.js'

async function main(): Promise<void> {
  const config = loadConfig()
  const redactor = buildRedactor()
  const audit = new AuditRun({
    logsDir: config.logsDir,
    trigger: process.env.KM_TRIGGER ?? 'mcp-server',
    redactor,
    seedSite: config.seedSite,
  })

  audit.trace({
    ts: new Date().toISOString(),
    level: 'info',
    event: 'agent_start',
    data: {seedServer: config.seedServer, seedSite: config.seedSite, keyName: config.keyName},
  })

  const cli = new SeedCli(config, redactor, audit)
  const state = new State(config.stateDir)
  const governance = new GovernanceCache(config, cli)
  const kmAccountId = await resolveAgentAccountId(cli, config.keyName)
  audit.meta.kmAccountId = kmAccountId

  const tools = buildTools({config, cli, governance, state, audit, kmAccountId})

  const server = new Server({name: 'seed-cli-mcp', version: '0.1.0'}, {capabilities: {tools: {}}})
  registerToolHandlers(server, tools)

  const transport = new StdioServerTransport()
  await server.connect(transport)

  // Close the audit run when the parent disconnects (stdin EOF).
  const close = (status: 'ok' | 'error' = 'ok') => {
    audit.trace({ts: new Date().toISOString(), level: 'info', event: 'agent_end', data: {status}})
    audit.close({status, logsDir: config.logsDir})
  }
  process.on('SIGINT', () => {
    close('ok')
    process.exit(0)
  })
  process.on('SIGTERM', () => {
    close('ok')
    process.exit(0)
  })
  process.on('exit', () => close('ok'))
}

async function resolveAgentAccountId(cli: SeedCli, keyName: string): Promise<string> {
  const r = await cli.runRead(['key', 'show', keyName])
  if (r.exitCode !== 0) {
    throw new Error(`Failed to resolve agent key '${keyName}': ${r.stderr}`)
  }
  if (r.parsedJson && typeof r.parsedJson === 'object') {
    const obj = r.parsedJson as {accountId?: string}
    if (obj.accountId) return obj.accountId
  }
  // Fallback: parse "accountId: z6Mk..." from stdout.
  const m = r.stdout.match(/z6Mk[1-9A-HJ-NP-Za-km-z]{40,}/)
  if (m) return m[0]
  throw new Error(`Could not parse accountId from \`seed-cli key show ${keyName}\` output`)
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('seed-cli-mcp fatal error:', err)
  process.exit(1)
})
