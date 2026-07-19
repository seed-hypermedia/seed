import type {HMDocument, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {describe, expect, it, vi} from 'vitest'
import {invalidateAfterPublish} from '../post-publish-cache'
import {queryKeys} from '../query-keys'

const invalidateQueries = vi.hoisted(() => vi.fn())
const setQueriesDataByKey = vi.hoisted(() => vi.fn())

vi.mock('../query-client', () => ({
  invalidateQueries,
  setQueriesDataByKey,
}))

const docId = {
  id: 'hm://z6Mksite/docs/page',
  uid: 'z6Mksite',
  path: ['docs', 'page'],
  version: null,
  blockRef: null,
  blockRange: null,
  hostname: null,
  scheme: 'hm',
} as UnpackedHypermediaId

const document = {
  version: 'new-version',
} as HMDocument

describe('invalidateAfterPublish', () => {
  it('invalidates activity feed so document versions refresh after publishing a draft', () => {
    invalidateAfterPublish(docId, document)

    expect(setQueriesDataByKey).toHaveBeenCalledWith([queryKeys.ENTITY, docId.id], {
      type: 'document',
      document,
      id: {...docId, version: document.version},
    })
    expect(invalidateQueries).toHaveBeenCalledWith([queryKeys.ACTIVITY_FEED])
  })

  it('does NOT invalidate the doc ENTITY query (avoids a stale post-publish refetch clobbering the fresh doc)', () => {
    invalidateAfterPublish(docId, document)
    expect(invalidateQueries).not.toHaveBeenCalledWith([queryKeys.ENTITY, docId.id])
  })
})
