import {describe, expect, it} from 'vitest'
import {simplePublishInput} from './document-page-content'

const url = 'hm://z6Mkspace/reading-list/articles/a1'

describe('seed.publishDocument(url, fields)', () => {
  it('creates a record with its name, metadata and body text', async () => {
    const request = (async () => ({type: 'not-found'})) as never
    const input = (await simplePublishInput(request, url, {
      name: 'Hypertext',
      metadata: {url: 'https://en.wikipedia.org/wiki/Hypertext', status: 'to-read', rating: 4},
      content: 'Background reading.',
    })) as {account: string; path: string; changes: {op: {case: string; value: unknown}}[]}
    expect(input.account).toBe('z6Mkspace')
    expect(input.path).toBe('/reading-list/articles/a1')
    expect(input.changes.filter((c) => c.op.case === 'setAttribute').map((c) => c.op.value)).toEqual([
      {blockId: '', key: ['url'], value: {case: 'stringValue', value: 'https://en.wikipedia.org/wiki/Hypertext'}},
      {blockId: '', key: ['status'], value: {case: 'stringValue', value: 'to-read'}},
      {blockId: '', key: ['rating'], value: {case: 'intValue', value: 4n}},
      {blockId: '', key: ['name'], value: {case: 'stringValue', value: 'Hypertext'}},
    ])
    expect(input.changes.some((c) => c.op.case === 'replaceBlock')).toBe(true)
  })
  it('edits an existing record on top of its current version', async () => {
    const request = (async () => ({
      type: 'document',
      document: {version: 'v2', genesis: 'g1', generationInfo: {generation: 7}},
    })) as never
    const input = (await simplePublishInput(request, url, {metadata: {status: 'done'}})) as Record<string, unknown>
    expect(input).toMatchObject({baseVersion: 'v2', genesis: 'g1', generation: 7})
    expect(input.changes).toHaveLength(1)
  })
  it('refuses an address that is not a record, and an empty write', async () => {
    const request = (async () => ({type: 'not-found'})) as never
    await expect(simplePublishInput(request, 'hm://z6Mkspace', {name: 'x'})).rejects.toThrow('address of a record')
    await expect(simplePublishInput(request, url, {})).rejects.toThrow('needs a name')
  })
  it('saves a record whose content is not text, leaving the body out', async () => {
    const request = (async () => ({type: 'not-found'})) as never
    const input = (await simplePublishInput(request, url, {
      name: 'x',
      content: {type: 'doc', content: []},
    })) as {changes: {op: {case: string}}[]}
    expect(input.changes.map((c) => c.op.case)).toEqual(['setAttribute'])
  })
  it('writes nested fields and booleans, and refuses a list with how to store it', async () => {
    const request = (async () => ({type: 'not-found'})) as never
    const input = (await simplePublishInput(request, url, {
      metadata: {done: true, source: {site: 'wikipedia'}},
    })) as {changes: {op: {value: {key: string[]; value: unknown}}}[]}
    expect(input.changes.map((c) => [c.op.value.key, c.op.value.value])).toEqual([
      [['done'], {case: 'boolValue', value: true}],
      [['source', 'site'], {case: 'stringValue', value: 'wikipedia'}],
    ])
    await expect(simplePublishInput(request, url, {metadata: {tags: ['a', 'b']}})).rejects.toThrow('cannot hold lists')
  })
})

describe('seed.directory', () => {
  it('resolves to the records, also answering to the names pages tend to guess', async () => {
    const {DOCUMENT_PAGE_API_SCRIPT} = await import('./document-page')
    const sdk = new Function(`return ${DOCUMENT_PAGE_API_SCRIPT}`)()(async () => [{id: {id: 'hm://x/a'}}])
    const records = await sdk.directory('hm://x')
    expect(Array.isArray(records)).toBe(true)
    expect(records.documents).toBe(records)
    expect(records.items).toBe(records)
    expect(Object.keys(records)).toEqual(['0'])
  })
  it('reads a record by its URL, its id, or the record itself', async () => {
    const {DOCUMENT_PAGE_API_SCRIPT} = await import('./document-page')
    const urls: unknown[] = []
    const sdk = new Function(`return ${DOCUMENT_PAGE_API_SCRIPT}`)()(
      async (_method: string, params: {url: unknown}) => {
        urls.push(params.url)
        return {}
      },
    )
    await sdk.resource('hm://x/a')
    await sdk.resource({id: 'hm://x/b', uid: 'x'})
    await sdk.resource({id: {id: 'hm://x/c'}, metadata: {}})
    expect(urls).toEqual(['hm://x/a', 'hm://x/b', 'hm://x/c'])
  })
  it("exposes a document record's metadata at the top, beside type and document", async () => {
    const {DOCUMENT_PAGE_API_SCRIPT} = await import('./document-page')
    const sdk = new Function(`return ${DOCUMENT_PAGE_API_SCRIPT}`)()(async () => ({
      type: 'document',
      id: {id: 'hm://x/a'},
      document: {metadata: {name: 'Lemon Rice'}, version: 'v1', content: []},
    }))
    const record = await sdk.resource('hm://x/a')
    expect(record.metadata.name).toBe('Lemon Rice')
    expect(record.document.metadata.name).toBe('Lemon Rice')
    expect(record.type).toBe('document')
  })
})

describe('records and ids as values', () => {
  it('saves and sends a record or an hm id as its URL', async () => {
    const {DOCUMENT_PAGE_API_SCRIPT} = await import('./document-page')
    const calls: [string, any][] = []
    const sdk = new Function(`return ${DOCUMENT_PAGE_API_SCRIPT}`)()(async (method: string, params: any) => {
      calls.push([method, params])
      return {}
    })
    const habit = {id: {id: 'hm://x/habits/read', uid: 'x', path: ['habits', 'read']}, metadata: {name: 'Read'}}
    await sdk.publishDocument('hm://x/check-ins/a', {metadata: {habit, day: '2026-11-14', done: true}})
    await sdk.publishDocument(habit, {metadata: {weeklyTarget: 4}})
    await sdk.app.call(habit.id, {habit, checkIns: [habit.id], note: {text: 'kept'}})
    expect(calls[0]).toEqual([
      'publishDocument',
      {url: 'hm://x/check-ins/a', fields: {metadata: {habit: 'hm://x/habits/read', day: '2026-11-14', done: true}}},
    ])
    expect(calls[1]![1].url).toBe('hm://x/habits/read')
    expect(calls[2]).toEqual([
      'app.call',
      {
        tool: 'hm://x/habits/read',
        input: {habit: 'hm://x/habits/read', checkIns: ['hm://x/habits/read'], note: {text: 'kept'}},
      },
    ])
  })
})
