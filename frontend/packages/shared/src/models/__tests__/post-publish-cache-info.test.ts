import type {HMDocument, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {QueryClient} from '@tanstack/react-query'
import {describe, expect, it} from 'vitest'
import {invalidateAfterPublish} from '../post-publish-cache'
import {registerQueryClient} from '../query-client'
import {documentInfoQueryKey, queryKeys} from '../query-keys'

const docId = {
  id: 'hm://z6Mksite',
  uid: 'z6Mksite',
  path: [],
  version: null,
  blockRef: null,
  blockRange: null,
  hostname: null,
  scheme: 'hm',
} as unknown as UnpackedHypermediaId

describe('invalidateAfterPublish against a real cache', () => {
  it('keeps the document info entry instead of overwriting it with the published resource', () => {
    const client = new QueryClient()
    registerQueryClient(client)
    const info = {id: docId, navigationCards: ['hm://z6Mksite/a']}
    client.setQueryData([queryKeys.ENTITY, docId.id, undefined, false], {type: 'document', document: {version: 'old'}})
    client.setQueryData(documentInfoQueryKey(docId.id), info)

    invalidateAfterPublish(docId, {version: 'new'} as HMDocument)

    expect(client.getQueryData(documentInfoQueryKey(docId.id))).toBe(info)
    expect(client.getQueryState(documentInfoQueryKey(docId.id))?.isInvalidated).toBe(true)
    expect(client.getQueryData([queryKeys.ENTITY, docId.id, undefined, false])).toMatchObject({
      type: 'document',
      document: {version: 'new'},
    })
  })

  it("carries the published document's navigation Cards into the info right away", () => {
    const client = new QueryClient()
    registerQueryClient(client)
    client.setQueryData(documentInfoQueryKey(docId.id), {id: docId, navigationCards: ['hm://z6Mksite/a']})

    invalidateAfterPublish(docId, {version: 'new', navigationCards: ['hm://z6Mksite/b']} as HMDocument)

    expect(client.getQueryData(documentInfoQueryKey(docId.id))).toEqual({
      id: docId,
      navigationCards: ['hm://z6Mksite/b'],
    })
  })
})
