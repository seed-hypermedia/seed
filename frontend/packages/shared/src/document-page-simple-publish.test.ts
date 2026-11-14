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
    expect(input.changes.filter((c) => c.op.case === 'setMetadata').map((c) => c.op.value)).toEqual([
      {key: 'url', value: 'https://en.wikipedia.org/wiki/Hypertext'},
      {key: 'status', value: 'to-read'},
      {key: 'rating', value: '4'},
      {key: 'name', value: 'Hypertext'},
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
    expect(input.changes.map((c) => c.op.case)).toEqual(['setMetadata'])
  })
})
