import {describe, expect, it} from 'vitest'
import {hmId} from './entity-id-url'
import {buildInlineDraftWrite} from './inline-draft'

describe('buildInlineDraftWrite', () => {
  it('builds a public inline draft under a nested parent', () => {
    const parentId = hmId('acct', {path: ['parent']})
    const write = buildInlineDraftWrite({parentId, draftId: 'abc12345'})
    expect(write).toEqual({
      id: 'abc12345',
      locationUid: 'acct',
      locationPath: ['parent'],
      editUid: 'acct',
      editPath: ['parent', '-abc12345'],
      metadata: {name: ''},
      content: [],
      deps: [],
      visibility: 'PUBLIC',
    })
  })

  it('builds an inline draft under the root with no parent path', () => {
    const parentId = hmId('acct')
    const write = buildInlineDraftWrite({parentId, draftId: 'rootkid'})
    expect(write.locationPath).toEqual([])
    expect(write.editPath).toEqual(['-rootkid'])
  })

  it('seeds optional content + name', () => {
    const parentId = hmId('acct', {path: ['parent']})
    const write = buildInlineDraftWrite({
      parentId,
      draftId: 'seeded',
      options: {name: 'My doc', initialContent: [{block: {id: 'b1', type: 'paragraph', text: 'hi'}} as any]},
    })
    expect(write.metadata).toEqual({name: 'My doc'})
    expect(write.content).toHaveLength(1)
  })

  it('honors visibility override', () => {
    const parentId = hmId('acct', {path: ['parent']})
    const write = buildInlineDraftWrite({parentId, draftId: 'priv', visibility: 'PRIVATE'})
    expect(write.visibility).toBe('PRIVATE')
  })
})
