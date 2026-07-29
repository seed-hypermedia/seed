/**
 * Phase 0 validation for the local-agent-server plan: proves the agents service can use the
 * desktop app's local HM API server (`app-http-server.ts`, default :56004) as its `hmServerUrl`,
 * so a locally spawned agent reads and writes through the user's own node.
 *
 * Requires the Seed desktop app to be running. Usage:
 *   bun scripts/smoke-local-hm.ts [--hm-server-url=http://localhost:56004]
 */
import {createSeedClient} from '@seed-hypermedia/client'

const urlFlag = process.argv.find((arg) => arg.startsWith('--hm-server-url='))
const hmServerUrl = urlFlag ? urlFlag.slice('--hm-server-url='.length) : 'http://localhost:56004'

const client = createSeedClient(hmServerUrl)

type Check = {name: string; run: () => Promise<string>}

/** Truncates a value to a single readable log line. */
function brief(value: unknown, max = 110): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  if (!text) return '(empty)'
  return text.length > max ? `${text.slice(0, max)}…` : text
}

const checks: Check[] = [
  {
    name: 'Search (backs the `search` tool)',
    run: async () => {
      const result = await client.request('Search', {query: 'seed', includeBody: false})
      return `${result.entities?.length ?? 0} entities, first=${brief(result.entities?.[0]?.title)}`
    },
  },
  {
    name: 'ListEvents (backs `list_activity_feed` + activity triggers)',
    run: async () => {
      const result = await client.request('ListEvents', {pageSize: 5})
      return `${result.events?.length ?? 0} events, first type=${brief(result.events?.[0]?.type)}`
    },
  },
  {
    name: 'ListAccounts (resolves authors)',
    run: async () => {
      const result = await client.request('ListAccounts', {})
      return `${result.accounts?.length ?? 0} accounts`
    },
  },
]

console.log(`Local HM API smoke test against ${hmServerUrl}\n`)

let failed = 0
for (const check of checks) {
  try {
    const detail = await check.run()
    console.log(`  ok    ${check.name}\n        ${detail}`)
  } catch (error) {
    failed += 1
    console.log(`  FAIL  ${check.name}\n        ${error instanceof Error ? error.message : String(error)}`)
  }
}

// A resource read needs a real target, so derive one from search rather than hardcoding a UID.
// Search returns already-unpacked ids, which is exactly the shape `Resource` wants.
try {
  const search = await client.request('Search', {query: 'seed', includeBody: false})
  const target = search.entities?.find((entity) => entity.id?.uid)
  if (!target) {
    console.log('  skip  Resource (backs the `read` tool)\n        no hm:// search result to read')
  } else {
    const resource = await client.request('Resource', target.id)
    console.log(`  ok    Resource (backs the \`read\` tool)\n        ${target.id.id} -> type=${resource.type}`)
  }
} catch (error) {
  failed += 1
  console.log(
    `  FAIL  Resource (backs the \`read\` tool)\n        ${error instanceof Error ? error.message : String(error)}`,
  )
}

console.log(failed === 0 ? '\nAll checks passed.' : `\n${failed} check(s) failed.`)
process.exit(failed === 0 ? 0 : 1)
