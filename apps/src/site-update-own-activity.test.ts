import {afterEach, describe, expect, test} from 'bun:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as blobs from '@shm/shared/blobs'
import type * as api from '@/api'
import * as apisvc from '@/api-service'
import * as sqlite from '@/sqlite'

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.()
})

const AGENT_UID = 'z6MkAgentIdentity'
const OTHER_AGENT_UID = 'z6MkOtherAgentIdentity'
const HUMAN_UID = 'z6MkHuman'
const SITE = 'hm://z6Mksite'

/** An account with two agents: `agentId` signs as AGENT_UID, `otherAgentId` signs as OTHER_AGENT_UID. */
async function harness() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'site-update-own-activity-'))
  const opened = sqlite.open(path.join(directory, 'test.db'))
  if (!opened.ok) throw new Error('schema mismatch')
  const db = opened.db
  const service = new apisvc.Service(db, directory, {})
  const account = blobs.generateNobleKeyPair()
  const accountId = blobs.principalToString(account.principal)
  const send = async (action: api.UnsignedAgentAction) =>
    service.message(await apisvc.createSignedEnvelope(account, {action}))
  await send({_: 'SetModelProvider', name: 'openai', provider: {type: 'openai'}})
  const createAgent = async (name: string, secretName: string, identity: string) => {
    await send({
      _: 'SetSecret',
      name: secretName,
      value: new TextEncoder().encode('mnemonic words'),
      metadata: {kind: 'hm-account-key', accountId: identity, label: name},
    })
    const created = await send({
      _: 'CreateAgent',
      definition: {name, systemPrompt: 'ok', modelProvider: 'openai', model: 'gpt', signingKeys: [secretName]},
    })
    if (created._ !== 'CreateAgentResponse') throw new Error('unexpected response')
    return created.agentId
  }
  const agentId = await createAgent('Watcher', 'watcher-key', AGENT_UID)
  const otherAgentId = await createAgent('Other', 'other-key', OTHER_AGENT_UID)
  cleanups.push(() => {
    service.stopRunQueue()
    sqlite.closeDatabase(db)
    fs.rmSync(directory, {recursive: true, force: true})
  })
  const createTrigger = async (source: api.AgentTriggerSource, forAgent = agentId) => {
    const result = await send({
      _: 'CreateAgentTrigger',
      agentId: forAgent,
      trigger: {name: 'Site watch', source, prompt: 'Report the change', continuation: {kind: 'wake', signal: 'site'}},
    })
    if (result._ !== 'CreateAgentTriggerResponse') throw new Error('unexpected response')
    return result.trigger
  }
  const firings = (triggerId: string) =>
    db.query<{id: string}, [string]>(`SELECT id FROM trigger_firings WHERE trigger_id = ?`).all(triggerId).length
  return {db, service, send, createTrigger, firings, accountId, agentId, otherAgentId}
}

function author(uid: string) {
  return {id: {uid, id: `hm://${uid}`, path: []}}
}

/** The resolved `/api/ListEvents` shape of a document change. */
function docUpdate(cid: string, by: string) {
  return {
    id: cid,
    type: 'doc-update',
    feedEventId: `blob-${cid}`,
    author: author(by),
    docId: {id: `${SITE}/notes`},
    document: {account: 'z6Mksite', path: 'notes'},
  }
}

/** The resolved `/api/ListEvents` shape of a comment. */
function comment(cid: string, by: string) {
  return {
    id: cid,
    type: 'comment',
    feedEventId: `blob-${cid}`,
    author: author(by),
    target: {id: {id: `${SITE}/notes`}},
    comment: {author: by, targetAccount: 'z6Mksite', targetPath: '/notes', content: []},
  }
}

const watch: api.AgentTriggerSource = {
  type: 'site-update',
  resourcePrefix: SITE,
  eventTypes: ['doc-update', 'comment'],
}

describe('site-update triggers and the agent’s own activity (#1314)', () => {
  test('a document change or comment the trigger’s own agent signed does not fire it', async () => {
    const h = await harness()
    const trigger = await h.createTrigger(watch)

    const ownDoc = await h.service.processActivityEvent(h.accountId, docUpdate('own-doc', AGENT_UID))
    const ownComment = await h.service.processActivityEvent(h.accountId, comment('own-comment', AGENT_UID))
    expect([ownDoc.matched, ownComment.matched]).toEqual([0, 0])
    expect(h.firings(trigger.id)).toBe(0)

    // Somebody else's activity under the prefix still fires it.
    const theirDoc = await h.service.processActivityEvent(h.accountId, docUpdate('their-doc', HUMAN_UID))
    const theirComment = await h.service.processActivityEvent(h.accountId, comment('their-comment', HUMAN_UID))
    expect([theirDoc.matched, theirComment.matched]).toEqual([1, 1])
    expect(h.firings(trigger.id)).toBe(2)
  })

  test('another agent’s trigger on the same prefix still fires on it', async () => {
    const h = await harness()
    const own = await h.createTrigger(watch)
    const other = await h.createTrigger(watch, h.otherAgentId)

    await h.service.processActivityEvent(h.accountId, docUpdate('by-watcher', AGENT_UID))
    expect([h.firings(own.id), h.firings(other.id)]).toEqual([0, 1])

    await h.service.processActivityEvent(h.accountId, comment('by-other', OTHER_AGENT_UID))
    expect([h.firings(own.id), h.firings(other.id)]).toEqual([1, 1])
  })

  test('includeOwnActivity opts a source back in, and is stored only when set', async () => {
    const h = await harness()
    const optedIn = await h.createTrigger({...watch, includeOwnActivity: true})
    expect(optedIn.source).toEqual({...watch, includeOwnActivity: true})
    const explicitOff = await h.createTrigger({...watch, includeOwnActivity: false})
    expect(explicitOff.source).toEqual(watch)

    await h.service.processActivityEvent(h.accountId, docUpdate('own-doc', AGENT_UID))
    expect([h.firings(optedIn.id), h.firings(explicitOff.id)]).toEqual([1, 0])

    const invalid = h.createTrigger({...watch, includeOwnActivity: 'yes'} as unknown as api.AgentTriggerSource)
    await expect(invalid).rejects.toThrow('includeOwnActivity must be a boolean')
  })

  test('the rule holds for a site-update condition inside a compound trigger', async () => {
    const h = await harness()
    const trigger = await h.createTrigger({
      type: 'activity',
      conditions: [
        {id: 'site', source: watch},
        {id: 'mention', source: {type: 'user-mention', mentionedAccounts: ['z6Mksomeone']}},
      ],
    })

    await h.service.processActivityEvent(h.accountId, comment('own-comment', AGENT_UID))
    expect(h.firings(trigger.id)).toBe(0)
    await h.service.processActivityEvent(h.accountId, comment('their-comment', HUMAN_UID))
    expect(h.firings(trigger.id)).toBe(1)
  })
})
