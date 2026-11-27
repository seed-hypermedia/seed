#!/usr/bin/env bun
/**
 * Dry run of the stored-trigger migration (hm://z6MkiAKDcRSzQ4zPZfnJcS5HYx5MwgN6MU9foHihJGrhqNBj/notes/legacy-triggers-and-tool-memory):
 * lists every trigger that is still only a row on this server (no trigger document) and says what
 * it would become, now that tools have memory (ctx.memory), Seed access (ctx.seed), can wake their
 * agent (ctx.agent.start), and trigger documents can start a session on failure or run sessions
 * with their own prompt and tools. It changes nothing.
 *
 *   bun scripts/trigger-migration-report.ts <path/to/agents.sqlite> [--days 14] [--json]
 *
 * Read-only and standalone (only bun:sqlite, with its own small CBOR reader), so it can be copied
 * into a server's container and run there against the live database; the trigger tables are small:
 *
 *   docker cp trigger-migration-report.ts agents-stable:/tmp/ &&
 *   docker exec agents-stable timeout 60 nice -n 19 bun /tmp/trigger-migration-report.ts /data/agents.sqlite
 */

import {Database} from 'bun:sqlite'

/** What a stored trigger becomes, and what it waits on. */
export type MigrationPlan = {
  /** One-word bucket, stable for counting. */
  kind:
    | 'delete-disabled'
    | 'mount-or-retire-agent'
    | 'document-as-is'
    | 'document-with-session-options'
    | 'document-with-failure-session'
    | 'port-script-to-tool'
    | 'port-builtin-call-to-tool'
    | 'keep-stored-wake'
  /** What to do, in words. */
  action: string
  /** What else it needs: the agent's write access to its own document, an owner's decision. */
  needs?: string
}

export type StoredTrigger = {
  id: string
  accountId: string
  agentId: string | null
  name: string
  enabled: boolean
  continuation: Record<string, unknown> | null
  lastFiredAt: number | null
}

/** Classifies one stored trigger. Pure, so tests can check every bucket. */
export function planStoredTrigger(trigger: StoredTrigger): MigrationPlan {
  if (!trigger.enabled) return {kind: 'delete-disabled', action: 'Delete: it is off (most are one-off retries).'}
  if (!trigger.agentId?.startsWith('hm://'))
    return {
      kind: 'mount-or-retire-agent',
      action: 'The agent has no document: mount it as a document, or retire the trigger with the agent.',
      needs: "the owner's decision",
    }
  const writeAccess = "the agent's write access under its own document (granted on its People tab)"
  const continuation = trigger.continuation
  const kind = typeof continuation?.kind === 'string' ? continuation.kind : 'newThread'
  if (kind === 'wake')
    return {
      kind: 'keep-stored-wake',
      action: 'Keep stored: a wake answers a parked run, which a trigger document cannot express.',
    }
  if (kind === 'script') {
    const script = typeof continuation?.script === 'string' ? continuation.script : ''
    const uses = [
      /memory|readFile|writeFile|~\/memory|\/workspace/u.test(script) ? 'ctx.memory' : null,
      /ctx\.delegate|startSession|newThread/u.test(script) ? 'ctx.agent.start' : null,
      /hm:\/\/|publish|ctx\.call\(['"`]write/u.test(script) ? 'ctx.seed' : null,
    ].filter(Boolean)
    return {
      kind: 'port-script-to-tool',
      action: `Port the script to a tool under the agent${
        uses.length ? ` (it needs ${uses.join(', ')})` : ''
      }, called by a trigger document${continuation?.onFailure === 'thread' ? ' with onFailure: "session"' : ''}.`,
      needs: writeAccess,
    }
  }
  if (kind === 'tool') {
    const tool = typeof continuation?.tool === 'string' ? continuation.tool : ''
    if (tool.startsWith('hm://'))
      return continuation?.onFailure === 'thread'
        ? {
            kind: 'document-with-failure-session',
            action: 'A trigger document calling the tool, with onFailure: "session".',
            needs: writeAccess,
          }
        : {kind: 'document-as-is', action: 'A trigger document calling the tool.', needs: writeAccess}
    return {
      kind: 'port-builtin-call-to-tool',
      action: `Port the call of ${
        tool || 'its tool'
      } to a tool under the agent (code for execute; the API call with a key in private config for an MCP tool), called by a trigger document.`,
      needs: writeAccess,
    }
  }
  const options = ['systemPrompt', 'includeAgentSystemPrompt', 'tools'].filter(
    (field) => continuation?.[field] !== undefined,
  )
  if (options.length)
    return {
      kind: 'document-with-session-options',
      action: `A session trigger document with session options (${options.join(', ')}).`,
      needs: writeAccess,
    }
  return {kind: 'document-as-is', action: 'A session trigger document with the same message.', needs: writeAccess}
}

// ---------------------------------------------------------------------------------------------
// A small canonical-CBOR reader: maps, lists, text, bytes, integers, floats, true/false/null and
// tags (the tag is dropped). Enough for trigger rows, without the app's dependencies.
function decodeCbor(bytes: Uint8Array): unknown {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let offset = 0
  const length = (info: number): number => {
    if (info < 24) return info
    if (info === 24) return view.getUint8(offset++)
    if (info === 25) return (offset += 2), view.getUint16(offset - 2)
    if (info === 26) return (offset += 4), view.getUint32(offset - 4)
    if (info === 27) return (offset += 8), Number(view.getBigUint64(offset - 8))
    throw new Error(`unsupported CBOR length ${info}`)
  }
  const item = (): unknown => {
    const initial = view.getUint8(offset++)
    const major = initial >> 5
    const info = initial & 31
    if (major === 7) {
      if (info === 20) return false
      if (info === 21) return true
      if (info === 22 || info === 23) return null
      if (info === 25) return (offset += 2), view.getFloat32(offset - 2) // half floats are rare in rows
      if (info === 26) return (offset += 4), view.getFloat32(offset - 4)
      if (info === 27) return (offset += 8), view.getFloat64(offset - 8)
      throw new Error(`unsupported CBOR simple ${info}`)
    }
    const n = length(info)
    if (major === 0) return n
    if (major === 1) return -1 - n
    if (major === 2) return (offset += n), bytes.slice(offset - n, offset)
    if (major === 3) return (offset += n), new TextDecoder().decode(bytes.subarray(offset - n, offset))
    if (major === 4) return Array.from({length: n}, item)
    if (major === 5) {
      const map: Record<string, unknown> = {}
      for (let index = 0; index < n; index++) map[String(item())] = item()
      return map
    }
    if (major === 6) return item()
    throw new Error(`unsupported CBOR major ${major}`)
  }
  return item()
}

function readStoredTriggers(db: Database): StoredTrigger[] {
  const rows = db
    .query(
      `SELECT id, account_id, agent_id, name, enabled, continuation_cbor, last_fired_at
       FROM agent_triggers WHERE document_id IS NULL ORDER BY account_id, agent_id, name`,
    )
    .all() as {
    id: string
    account_id: string
    agent_id: string | null
    name: string
    enabled: number
    continuation_cbor: Uint8Array | null
    last_fired_at: number | null
  }[]
  return rows.map((row) => ({
    id: row.id,
    accountId: row.account_id,
    agentId: row.agent_id,
    name: row.name,
    enabled: !!row.enabled,
    continuation: row.continuation_cbor
      ? (decodeCbor(new Uint8Array(row.continuation_cbor)) as Record<string, unknown>)
      : null,
    lastFiredAt: row.last_fired_at,
  }))
}

if (import.meta.main) {
  const args = process.argv.slice(2)
  const dbPath = args.find((arg) => !arg.startsWith('--'))
  if (!dbPath) {
    console.error('usage: bun trigger-migration-report.ts <agents.sqlite> [--days 14] [--json]')
    process.exit(2)
  }
  const daysIndex = args.indexOf('--days')
  const days = daysIndex >= 0 ? Number(args[daysIndex + 1]) : 14
  const db = new Database(dbPath, {readonly: true})
  const all = db.query(`SELECT COUNT(*) AS n, SUM(document_id IS NOT NULL) AS docs FROM agent_triggers`).get() as {
    n: number
    docs: number | null
  }
  const since = Date.now() - days * 24 * 3600 * 1000
  const planned = readStoredTriggers(db).map((trigger) => ({trigger, plan: planStoredTrigger(trigger)}))
  if (args.includes('--json')) {
    console.log(JSON.stringify(planned, null, 2))
    process.exit(0)
  }
  const buckets = new Map<string, {count: number; recent: number; action: string}>()
  for (const {trigger, plan} of planned) {
    const bucket = buckets.get(plan.kind) ?? {count: 0, recent: 0, action: plan.action}
    bucket.count++
    if (trigger.lastFiredAt && trigger.lastFiredAt >= since) bucket.recent++
    buckets.set(plan.kind, bucket)
  }
  const lines = [
    `# Stored-trigger migration dry run`,
    ``,
    `${dbPath}, ${new Date().toISOString()}. ${all.n} triggers: ${all.docs ?? 0} documents, ${
      planned.length
    } stored only.`,
    ``,
    `| What it becomes | Triggers | Fired in the last ${days} days |`,
    `| --- | --- | --- |`,
    ...[...buckets].map(([kind, bucket]) => `| ${kind} | ${bucket.count} | ${bucket.recent} |`),
    ``,
    `## Each stored trigger`,
    ``,
    ...planned.map(
      ({trigger, plan}) =>
        `- **${trigger.name}** (${trigger.agentId ?? 'no agent'}, ${trigger.enabled ? 'on' : 'off'}${
          trigger.lastFiredAt ? `, last fired ${new Date(trigger.lastFiredAt).toISOString().slice(0, 10)}` : ''
        }): ${plan.action}${plan.needs ? ` Needs ${plan.needs}.` : ''}`,
    ),
  ]
  console.log(lines.join('\n'))
}
