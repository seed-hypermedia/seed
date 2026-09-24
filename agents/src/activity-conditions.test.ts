import {afterEach, describe, expect, test} from 'bun:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as blobs from '@shm/shared/blobs'
import type * as api from '@/api'
import * as apisvc from '@/api-service'
import * as sqlite from '@/sqlite'
import * as cbor from '@/cbor'

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.()
})

const comments: api.AgentActivitySource = {type: 'document-comment', resource: 'hm://z6Mksite'}
const mentions: api.AgentActivitySource = {type: 'user-mention', mentionedAccounts: ['z6Mkmentioned']}
const compound: api.AgentTriggerSource = {
  type: 'activity',
  conditions: [
    {id: 'comments', source: comments},
    {id: 'mentions', source: mentions},
  ],
}

async function harness() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'activity-conditions-'))
  const opened = sqlite.open(path.join(directory, 'test.db'))
  if (!opened.ok) throw new Error('schema mismatch')
  const db = opened.db
  const service = new apisvc.Service(db, directory, {})
  const account = blobs.generateNobleKeyPair()
  const accountId = blobs.principalToString(account.principal)
  const send = async (action: api.UnsignedAgentAction, protocol?: number) =>
    service.message(await apisvc.createSignedEnvelope(account, {action, protocol}))
  await send({_: 'SetModelProvider', name: 'openai', provider: {type: 'openai'}})
  const created = await send({
    _: 'CreateAgent',
    definition: {name: 'Conditions', systemPrompt: 'ok', modelProvider: 'openai', model: 'gpt'},
  })
  if (created._ !== 'CreateAgentResponse') throw new Error('unexpected response')
  cleanups.push(() => {
    service.stopRunQueue()
    sqlite.closeDatabase(db)
    fs.rmSync(directory, {recursive: true, force: true})
  })
  const create = async (source: api.AgentTriggerSource, name = 'Respond') => {
    const result = await send({
      _: 'CreateAgentTrigger',
      agentId: created.agentId,
      trigger: {name, source, prompt: `Instructions for ${name}`, continuation: {kind: 'wake', signal: name}},
    })
    if (result._ !== 'CreateAgentTriggerResponse') throw new Error('unexpected response')
    return result.trigger
  }
  return {db, service, send, create, accountId, agentId: created.agentId}
}

function comment(cid: string, resource = 'hm://z6Mksite') {
  return {
    type: 'comment',
    feedEventId: `blob-${cid}`,
    target: {id: {id: resource}},
    comment: {content: [{block: {annotations: [{type: 'Embed', link: 'hm://z6Mkmentioned/:profile'}]}}]},
  }
}

function citation(cid: string) {
  return {
    type: 'citation',
    citationType: 'c',
    feedEventId: `mention-${cid}--hm://z6Mkmentioned/:profile`,
    target: {id: {uid: 'z6Mkmentioned', path: [':profile']}},
  }
}

describe('activity conditions and combination', () => {
  test('one firing across matching conditions, sibling order, raw mentions, and replay', async () => {
    const h = await harness()
    const trigger = await h.create(compound)
    for (const event of [
      comment('first'),
      citation('first'),
      citation('second'),
      comment('second'),
      comment('first'),
      {newMention: {sourceBlob: {cid: 'first'}, mentionType: 'c', target: 'hm://z6Mkmentioned'}},
    ]) {
      await h.service.processActivityEvent(h.accountId, event)
    }
    const loaded = await h.send({_: 'GetAgentTrigger', triggerId: trigger.id})
    if (loaded._ !== 'GetAgentTriggerResponse') throw new Error('unexpected response')
    expect(loaded.firings).toHaveLength(2)
    expect(
      loaded.firings?.find(({activityKey}) => activityKey === 'blob-first')?.matchedConditions?.map(({id}) => id),
    ).toEqual(['comments', 'mentions'])
    expect(
      loaded.firings?.find(({activityKey}) => activityKey === 'blob-second')?.matchedConditions?.map(({id}) => id),
    ).toEqual(['mentions'])
    await h.create(comments, 'Another job')
    await h.service.processActivityEvent(h.accountId, comment('third'))
    expect(h.db.query('SELECT id FROM trigger_firings').all()).toHaveLength(4)
  })

  test('combining preserves duplicate histories and inherits all previous event claims', async () => {
    const h = await harness()
    const target = await h.create(comments, 'Comments')
    const other = await h.create(mentions, 'Mentions')
    await h.service.processActivityEvent(h.accountId, comment('both'))
    await h.service.processActivityEvent(h.accountId, comment('only-other', 'hm://elsewhere'))
    const before = h.db.query('SELECT id, trigger_id FROM trigger_firings ORDER BY id').all()
    expect(before).toHaveLength(3)
    const action: api.CombineAgentTriggers = {
      _: 'CombineAgentTriggers',
      triggerId: target.id,
      otherTriggerId: other.id,
      expectedUpdatedAt: target.updatedAt,
      otherExpectedUpdatedAt: other.updatedAt,
      useOtherAction: true,
    }
    const combined = await h.send(action)
    if (combined._ !== 'UpdateAgentTriggerResponse') throw new Error('unexpected response')
    expect(combined.trigger.source.type).toBe('activity')
    expect(combined.trigger.continuation).toEqual(other.continuation)
    expect(await h.send(action)).toEqual(combined)
    expect(h.db.query('SELECT id, trigger_id FROM trigger_firings ORDER BY id').all()).toEqual(before)
    const old = await h.send({_: 'GetAgentTrigger', triggerId: other.id})
    if (old._ !== 'GetAgentTriggerResponse') throw new Error('unexpected response')
    expect(old.trigger).toMatchObject({enabled: false, mergedInto: target.id})
    await expect(h.send({_: 'UpdateAgentTrigger', triggerId: other.id, patch: {enabled: true}})).rejects.toThrow(
      'cannot be edited',
    )
    await h.service.processActivityEvent(h.accountId, comment('both'))
    await h.service.processActivityEvent(h.accountId, comment('only-other', 'hm://elsewhere'))
    expect(h.db.query('SELECT id FROM trigger_firings').all()).toHaveLength(3)
    // Imported claims survive deletion of the historical trigger and restart of the service.
    await h.send({_: 'DeleteAgentTrigger', triggerId: other.id})
    h.service.stopRunQueue()
    const restarted = new apisvc.Service(h.db, os.tmpdir(), {})
    try {
      await restarted.processActivityEvent(h.accountId, comment('only-other', 'hm://elsewhere'))
      await restarted.processActivityEvent(h.accountId, comment('new'))
      expect(h.db.query('SELECT id FROM trigger_firings').all()).toHaveLength(2)
    } finally {
      restarted.stopRunQueue()
    }
  })

  test('firing attribution survives edits and stale edits fail without losing conditions', async () => {
    const h = await harness()
    const trigger = await h.create(compound, 'Original')
    await h.service.processActivityEvent(h.accountId, comment('snapshot'))
    const before = h.db.query<{context_cbor: Uint8Array}, []>('SELECT context_cbor FROM trigger_firings').get()!
    const updated = await h.send({
      _: 'UpdateAgentTrigger',
      triggerId: trigger.id,
      expectedUpdatedAt: trigger.updatedAt,
      patch: {
        name: 'Changed',
        source: {type: 'activity', conditions: [{id: 'different', source: comments}]},
        prompt: 'Changed instructions',
      },
    })
    expect(updated._).toBe('UpdateAgentTriggerResponse')
    await expect(
      h.send({
        _: 'UpdateAgentTrigger',
        triggerId: trigger.id,
        expectedUpdatedAt: trigger.updatedAt,
        patch: {source: mentions},
      }),
    ).rejects.toThrow('changed elsewhere')
    const after = h.db.query<{context_cbor: Uint8Array}, []>('SELECT context_cbor FROM trigger_firings').get()!
    expect(after.context_cbor).toEqual(before.context_cbor)
    expect(cbor.decode(after.context_cbor)).toMatchObject({
      triggerName: 'Original',
      prompt: 'Instructions for Original',
      matchedConditions: compound.type === 'activity' ? compound.conditions : [],
    })
  })

  test('legacy clients keep single sources and cannot read or overwrite a compound trigger', async () => {
    const h = await harness()
    const single = await h.create(comments)
    expect((await h.send({_: 'GetAgentTrigger', triggerId: single.id}, 2))._).toBe('GetAgentTriggerResponse')
    const multi = await h.create(compound)
    // Their lists leave out what they cannot render rather than failing outright.
    const listed = await h.send({_: 'ListAgentTriggers', agentId: h.agentId}, 2)
    expect(listed._ === 'ListAgentTriggersResponse' && listed.triggers.map(({id}) => id)).toEqual([single.id])
    for (const action of [
      {_: 'GetAgentTrigger', triggerId: multi.id},
      {
        _: 'CreateAgentTrigger',
        agentId: h.agentId,
        trigger: {
          name: 'Replies',
          enabled: true,
          prompt: 'Reply.',
          source: {type: 'comment-reply', repliedToAccounts: ['z6Mkagent']},
        },
      },
      {_: 'UpdateAgentTrigger', triggerId: multi.id, patch: {source: comments}},
    ] as api.UnsignedAgentAction[]) {
      await expect(h.send(action, 2)).rejects.toMatchObject({status: 426, code: 'protocol_too_old'})
    }
    expect(h.db.query('SELECT id FROM agent_triggers').all()).toHaveLength(2)
  })

  test('rejects invalid groups and combining standalone or stale triggers', async () => {
    const h = await harness()
    for (const conditions of [
      [],
      [{id: 'x', source: {type: 'webhook'}}],
      [{id: 'x', source: compound}],
      [
        {id: 'x', source: comments},
        {id: 'x', source: mentions},
      ],
    ]) {
      await expect(h.create({type: 'activity', conditions} as api.AgentTriggerSource)).rejects.toThrow()
    }
    // A bare hm:// matches the whole network; it is not a document filter.
    for (const source of [
      {type: 'site-update', resourcePrefix: 'hm://', eventTypes: ['comment']},
      {type: 'document-comment', resource: 'hm://'},
      {type: 'user-mention', mentionedAccounts: ['z6Mkagent'], resourcePrefix: 'docs/notes'},
      {type: 'comment-reply', repliedToAccounts: ['z6Mkagent'], resourcePrefix: 'hm:///docs'},
    ] as api.AgentActivitySource[]) {
      await expect(h.create(source)).rejects.toThrow('must name an account or document')
      await expect(h.create({type: 'activity', conditions: [{id: 'x', source}]})).rejects.toThrow(
        'must name an account or document',
      )
    }
    const target = await h.create(comments)
    const schedule = await h.create({type: 'schedule', schedule: {kind: 'interval', every: 1, unit: 'hours'}})
    await expect(
      h.send({
        _: 'CombineAgentTriggers',
        triggerId: target.id,
        otherTriggerId: schedule.id,
        expectedUpdatedAt: target.updatedAt,
        otherExpectedUpdatedAt: schedule.updatedAt,
      }),
    ).rejects.toThrow('Only activity')
    const other = await h.create(mentions)
    await expect(
      h.send({
        _: 'CombineAgentTriggers',
        triggerId: target.id,
        otherTriggerId: other.id,
        expectedUpdatedAt: target.updatedAt - 1,
        otherExpectedUpdatedAt: other.updatedAt,
      }),
    ).rejects.toThrow('changed elsewhere')
    expect(h.db.query('SELECT id FROM agent_triggers WHERE merged_into IS NOT NULL').all()).toHaveLength(0)
  })

  test('migrates existing firing identities without changing configuration or replaying events', async () => {
    const h = await harness()
    const trigger = await h.create(comments)
    await h.service.processActivityEvent(h.accountId, comment('old'))
    h.db.run('UPDATE trigger_firings SET activity_key = ?', ['mention-old-c-hm://z6Mkmentioned'])
    h.db.run('DROP TABLE trigger_event_claims')
    h.db.run('ALTER TABLE trigger_firings DROP COLUMN context_cbor')
    h.db.run('ALTER TABLE agent_triggers DROP COLUMN merged_into')
    // Two versions behind: the claims migration sits under the firing-session link migration.
    h.db.run('UPDATE server_config SET value = ? WHERE key = ?', [
      String(sqlite.desiredVersion - 2),
      sqlite.SCHEMA_MIGRATION_VERSION_KEY,
    ])
    expect(sqlite.openWithDatabase(h.db).ok).toBe(true)
    expect(h.db.query('SELECT activity_key FROM trigger_event_claims ORDER BY activity_key').all()).toEqual([
      {activity_key: 'blob-old'},
      {activity_key: 'mention-old-c-hm://z6Mkmentioned'},
    ])
    const loaded = await h.send({_: 'GetAgentTrigger', triggerId: trigger.id})
    if (loaded._ !== 'GetAgentTriggerResponse') throw new Error('unexpected response')
    expect(loaded.trigger.source).toEqual(comments)
    expect(loaded.trigger.createdAt).toBe(trigger.createdAt)
    await h.service.processActivityEvent(h.accountId, comment('old'))
    expect(h.db.query('SELECT id FROM trigger_firings').all()).toHaveLength(1)
  })
})
