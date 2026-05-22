import {describe, expect, it} from 'vitest'
import {unpackHmId} from './utils/entity-id-url'
import {shouldBlockEmbeddedResource, type RenderResource} from './render-resource-context'

function resource(kind: 'document' | 'comment', url: string): RenderResource {
  const id = unpackHmId(url)
  if (!id) throw new Error(`Invalid test id: ${url}`)
  return {kind, id}
}

describe('shouldBlockEmbeddedResource', () => {
  it('blocks latest document self-embeds', () => {
    const doc = resource('document', 'hm://alice/doc')
    expect(shouldBlockEmbeddedResource([doc], doc)).toBe(true)
  })

  it('allows embedding a previous document version of the same document', () => {
    const latestDoc = resource('document', 'hm://alice/doc')
    const previousDoc = resource('document', 'hm://alice/doc?v=v1')
    expect(shouldBlockEmbeddedResource([latestDoc], previousDoc)).toBe(false)
  })

  it('blocks returning to the latest document from an older version', () => {
    const previousDoc = resource('document', 'hm://alice/doc?v=v1')
    const latestDoc = resource('document', 'hm://alice/doc')
    expect(shouldBlockEmbeddedResource([previousDoc], latestDoc)).toBe(true)
  })

  it('blocks re-embedding the exact same document version', () => {
    const previousDoc = resource('document', 'hm://alice/doc?v=v1')
    expect(shouldBlockEmbeddedResource([previousDoc], previousDoc)).toBe(true)
  })

  it('blocks comment self-embeds even for previous versions', () => {
    const latestComment = resource('comment', 'hm://alice/comment-1')
    const previousComment = resource('comment', 'hm://alice/comment-1?v=v1')
    expect(shouldBlockEmbeddedResource([latestComment], previousComment)).toBe(true)
    expect(shouldBlockEmbeddedResource([previousComment], latestComment)).toBe(true)
  })

  it('does not confuse document ids with comment ids', () => {
    const doc = resource('document', 'hm://alice/shared-id')
    const comment = resource('comment', 'hm://alice/shared-id')
    expect(shouldBlockEmbeddedResource([doc], comment)).toBe(false)
  })
})
