import type {Database} from 'bun:sqlite'
import {unpackHmId, type SeedClient} from '@seed-hypermedia/client'
import * as api from '@seed-hypermedia/agents-protocol'
import {stmt} from './statements'

/** Resolves a pre-mount server ID without changing the signed envelope. */
export function resolveAgentId(db: Database, id: string): string {
  return (
    stmt<{agent_id: string}, [string]>(db, 'SELECT agent_id FROM agent_id_aliases WHERE alias = ?').get(id)?.agent_id ??
    id
  )
}

/** Publishes/verifies the mount document, then changes all relational references atomically. */
export async function mountAgent(
  db: Database,
  client: SeedClient,
  accountId: string,
  action: api.MountAgent,
  beforeCommit?: () => void,
  signerId = accountId,
): Promise<void> {
  const existing = stmt<{id: string}, [string, string]>(
    db,
    'SELECT id FROM agents WHERE id = ? AND account_id = ?',
  ).get(action.agentId, accountId)
  if (!existing) throw new Error('Only the agent owner can mount it')
  if (action.agentId === action.documentId) return
  if (action.agentId.startsWith('hm://')) throw new Error('This agent is already mounted')
  const occupied = stmt<{id: string}, [string]>(db, 'SELECT id FROM agents WHERE id = ?').get(action.documentId)
  if (occupied) throw new Error('This document already represents another agent')
  await verifyMountDocument(client, accountId, action, signerId)
  // There is no await between the busy check and commit: a queue/trigger cannot start in between.
  db.transaction(() => {
    beforeCommit?.()
    if (!stmt(db, 'SELECT id FROM agents WHERE id = ? AND account_id = ?').get([action.agentId, accountId])) {
      throw new Error('The agent changed while mounting. Reload and try again.')
    }
    const busy = stmt<{id: string}, [string]>(
      db,
      "SELECT id FROM runs WHERE agent_id = ? AND status IN ('queued', 'claimed', 'running', 'waiting') LIMIT 1",
    ).get(action.agentId)
    if (busy) throw new Error('Wait for this agent’s running work to finish before mounting')
    if (stmt<{id: string}, [string]>(db, 'SELECT id FROM agents WHERE id = ?').get(action.documentId)) {
      throw new Error('This document already represents another agent')
    }
    db.run('PRAGMA defer_foreign_keys = ON')
    for (const table of [
      'agent_collaborators',
      'agent_triggers',
      'sessions',
      'trigger_firings',
      'runs',
      'agent_drafts',
      'tool_documents',
      'session_continuations',
      'agent_id_aliases',
    ]) {
      stmt(db, `UPDATE ${table} SET agent_id = ? WHERE agent_id = ?`).run([action.documentId, action.agentId])
    }
    stmt(db, 'UPDATE agents SET id = ?, updated_at = ? WHERE id = ? AND account_id = ?').run([
      action.documentId,
      Date.now(),
      action.agentId,
      accountId,
    ])
    stmt(db, 'INSERT INTO agent_id_aliases (alias, agent_id) VALUES (?, ?)').run([action.agentId, action.documentId])
  })()
}

/** Verifies a mount's canonical path, published document and the caller's write authority. */
export async function verifyMountDocument(
  client: SeedClient,
  accountId: string,
  action: Pick<api.MountAgent, 'documentId' | 'blobs'>,
  signerId = accountId,
): Promise<void> {
  const target = unpackHmId(action.documentId)
  if (
    !target ||
    !target.path?.length ||
    target.version ||
    target.blockRef ||
    target.id !== action.documentId ||
    target.path.some((part) => part.startsWith(':'))
  ) {
    throw new Error('Choose a document path, without a version or view suffix')
  }
  if (action.blobs) {
    if (action.blobs.length > 16 || action.blobs.reduce((total, blob) => total + blob.data.byteLength, 0) > 262144) {
      throw new Error('Mount document is too large')
    }
    await client.publish({blobs: action.blobs})
  }
  const resource = await client.request('Resource', target)
  if (
    resource.type !== 'document' ||
    resource.document.metadata.type !== 'hm://hyper.media/agent' ||
    typeof resource.document.metadata.agentServerUrl !== 'string'
  ) {
    throw new Error('Publish an agent mount document at this location first')
  }
  if (resource.document.content?.length)
    throw new Error('Agent mount documents must have no content; edit the agent home instead')
  if (!api.isMountableAgentServerUrl(resource.document.metadata.agentServerUrl)) {
    throw new Error('Use an HTTP or HTTPS agent server address without credentials.')
  }
  if (target.uid !== accountId) {
    const {capabilities} = await client.request('ListCapabilities', {targetId: target})
    const path = '/' + target.path.join('/')
    if (
      !capabilities.some(
        (cap) =>
          (cap.delegate === accountId || cap.delegate === signerId) &&
          (cap.role === 'WRITER' || cap.role === 'AGENT') &&
          (cap.path === path ||
            (!cap.noRecursive && !cap.isExact && (!cap.path || cap.path === '/' || path.startsWith(cap.path + '/')))),
      )
    ) {
      throw new Error('You need write access to the mount document')
    }
  }
}
