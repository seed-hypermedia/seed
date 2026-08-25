import {describe, expect, it} from 'vitest'
import type {SeedClient} from './client'
import {resolveEditableDocument} from './document-state'
import {packHmId, unpackHmId, type UnpackedHypermediaId} from './hm-types'

const SPACE_A = 'z6MkwRA1sPTdRk6nvDBs2eZiXAxYtvxRusN3faHibKPULdrL'
const SPACE_B = 'z6MkuoiSMnMKtqifsnso587kJcaSrpLQBB2QvZzc7neh1CVy'

function id(url: string): UnpackedHypermediaId {
  const unpacked = unpackHmId(url)
  if (!unpacked) throw new Error(`bad test id: ${url}`)
  return unpacked
}

/** Builds a stub SeedClient serving canned Resource/ListChanges responses keyed by packed id. */
function stubClient(handlers: {resources: Record<string, unknown>; changes?: Record<string, unknown>}): SeedClient {
  return {
    request: async (key: string, input: unknown) => {
      if (key === 'Resource') {
        const packed = packHmId(input as UnpackedHypermediaId)
        const found = handlers.resources[packed]
        if (!found) throw new Error(`no stub resource for ${packed}`)
        return found
      }
      if (key === 'ListChanges') {
        const packed = packHmId((input as {targetId: UnpackedHypermediaId}).targetId)
        const found = handlers.changes?.[packed]
        if (!found) throw new Error(`no stub changes for ${packed}`)
        return found
      }
      throw new Error(`unexpected request: ${key}`)
    },
  } as unknown as SeedClient
}

const GENESIS = 'bafyreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku'
const HEAD = 'bafyreibnw7dfl23nougcud3jtdsc3v2ems3wymk3x4eiup2jo2qzzdhkbq'

function documentResource(atId: UnpackedHypermediaId) {
  return {
    type: 'document',
    id: atId,
    document: {version: HEAD, genesis: GENESIS, account: atId.uid, path: `/${(atId.path ?? []).join('/')}`},
  }
}

const CHANGES = {
  changes: [
    {id: GENESIS, deps: []},
    {id: HEAD, deps: [GENESIS]},
  ],
}

describe('resolveEditableDocument', () => {
  it('returns the document and DAG state for a plain document address', async () => {
    const docId = id(`hm://${SPACE_A}/notes`)
    const client = stubClient({
      resources: {[packHmId(docId)]: documentResource(docId)},
      changes: {[packHmId(docId)]: CHANGES},
    })
    const base = await resolveEditableDocument(client, docId)
    expect(base.redirect).toBeNull()
    expect(base.targetId).toEqual(docId)
    expect(base.state).toEqual({genesis: GENESIS, heads: [HEAD], headDepth: 1, version: HEAD})
  })

  it('follows a republish redirect to the target and reports the redirect', async () => {
    const sourceId = id(`hm://${SPACE_A}/guide`)
    const targetId = id(`hm://${SPACE_B}/resources/guide`)
    const client = stubClient({
      resources: {
        [packHmId(sourceId)]: {type: 'redirect', id: sourceId, redirectTarget: targetId, republish: true},
        [packHmId(targetId)]: documentResource(targetId),
      },
      changes: {[packHmId(targetId)]: CHANGES},
    })
    const base = await resolveEditableDocument(client, sourceId)
    expect(base.id).toEqual(sourceId)
    expect(base.targetId).toEqual(targetId)
    expect(base.redirect).toEqual({republish: true, target: targetId})
    expect(base.state.genesis).toBe(GENESIS)
    expect(base.state.heads).toEqual([HEAD])
  })

  it('reports the FIRST redirect when following a chain', async () => {
    const a = id(`hm://${SPACE_A}/a`)
    const b = id(`hm://${SPACE_A}/b`)
    const c = id(`hm://${SPACE_B}/c`)
    const client = stubClient({
      resources: {
        [packHmId(a)]: {type: 'redirect', id: a, redirectTarget: b, republish: true},
        [packHmId(b)]: {type: 'redirect', id: b, redirectTarget: c, republish: false},
        [packHmId(c)]: documentResource(c),
      },
      changes: {[packHmId(c)]: CHANGES},
    })
    const base = await resolveEditableDocument(client, a)
    expect(base.targetId).toEqual(c)
    expect(base.redirect).toEqual({republish: true, target: b})
  })

  it('throws on a redirect cycle', async () => {
    const a = id(`hm://${SPACE_A}/a`)
    const b = id(`hm://${SPACE_A}/b`)
    const client = stubClient({
      resources: {
        [packHmId(a)]: {type: 'redirect', id: a, redirectTarget: b, republish: true},
        [packHmId(b)]: {type: 'redirect', id: b, redirectTarget: a, republish: true},
      },
    })
    await expect(resolveEditableDocument(client, a)).rejects.toThrow(/Redirect cycle/)
  })

  it('throws with the redirect context when the target is not editable', async () => {
    const sourceId = id(`hm://${SPACE_A}/gone`)
    const targetId = id(`hm://${SPACE_B}/dead`)
    const client = stubClient({
      resources: {
        [packHmId(sourceId)]: {type: 'redirect', id: sourceId, redirectTarget: targetId, republish: true},
        [packHmId(targetId)]: {type: 'tombstone', id: targetId},
      },
    })
    await expect(resolveEditableDocument(client, sourceId)).rejects.toThrow(/is tombstone.*followed redirect/)
  })
})
