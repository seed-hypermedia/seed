import {hmId} from '@shm/shared/utils/entity-id-url'
import {describe, expect, it} from 'vitest'
import {
  createDocumentVersionsPanelRoute,
  DOCUMENT_VERSION_EVENT_TYPES,
  isDocumentVersionsPanelRoute,
} from '../document-versions-panel'

describe('document versions panel route helpers', () => {
  it('creates the shared versions panel activity route', () => {
    const docId = hmId('z-test', {path: ['docs']})

    expect(createDocumentVersionsPanelRoute(docId)).toEqual({
      key: 'activity',
      id: docId,
      filterEventType: ['Ref'],
    })
  })

  it('identifies only the versions activity panel route', () => {
    const docId = hmId('z-test', {path: ['docs']})

    expect(isDocumentVersionsPanelRoute(createDocumentVersionsPanelRoute(docId))).toBe(true)
    expect(isDocumentVersionsPanelRoute({key: 'activity', id: docId})).toBe(false)
    expect(isDocumentVersionsPanelRoute({key: 'activity', id: docId, filterEventType: ['Comment']})).toBe(false)
    expect(isDocumentVersionsPanelRoute({key: 'comments', id: docId})).toBe(false)
    expect(isDocumentVersionsPanelRoute(null)).toBe(false)
  })

  it('does not expose a mutable shared filter array through route creation', () => {
    const docId = hmId('z-test')
    const route = createDocumentVersionsPanelRoute(docId)

    route.filterEventType?.push('Comment')

    expect(DOCUMENT_VERSION_EVENT_TYPES).toEqual(['Ref'])
    expect(createDocumentVersionsPanelRoute(docId).filterEventType).toEqual(['Ref'])
  })
})
