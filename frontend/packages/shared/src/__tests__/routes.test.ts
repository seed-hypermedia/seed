import {describe, expect, test} from 'vitest'
import {createDocumentNavRoute} from '../routes'
import {hmId} from '../utils/entity-id-url'

const testDocId = hmId('testuid123')

describe('createDocumentNavRoute', () => {
  describe('no panel param', () => {
    test('returns document route without panel', () => {
      const route = createDocumentNavRoute(testDocId)
      expect(route).toEqual({key: 'document', id: testDocId, panel: null})
    })

    test('null panelParam returns document route without panel', () => {
      const route = createDocumentNavRoute(testDocId, null, null)
      expect(route).toEqual({key: 'document', id: testDocId, panel: null})
    })
  })

  describe('simple panel keys', () => {
    test('collaborators panel', () => {
      const route = createDocumentNavRoute(testDocId, null, 'collaborators')
      expect(route).toEqual({
        key: 'document',
        id: testDocId,
        panel: {key: 'collaborators', id: testDocId},
      })
    })

    test('discussions panel', () => {
      const route = createDocumentNavRoute(testDocId, null, 'discussions')
      expect(route).toEqual({
        key: 'document',
        id: testDocId,
        panel: {key: 'discussions', id: testDocId},
      })
    })

    test('activity panel', () => {
      const route = createDocumentNavRoute(testDocId, null, 'activity')
      expect(route).toEqual({
        key: 'document',
        id: testDocId,
        panel: {key: 'activity', id: testDocId},
      })
    })

    test('directory panel', () => {
      const route = createDocumentNavRoute(testDocId, null, 'directory')
      expect(route).toEqual({
        key: 'document',
        id: testDocId,
        panel: {key: 'directory', id: testDocId},
      })
    })

    test('options panel', () => {
      const route = createDocumentNavRoute(testDocId, null, 'options')
      expect(route).toEqual({
        key: 'document',
        id: testDocId,
        panel: {key: 'options'},
      })
    })
  })

  describe('extended panel formats', () => {
    test('discussions with targetBlockId', () => {
      const route = createDocumentNavRoute(
        testDocId,
        null,
        'discussions/block123',
      )
      expect(route).toEqual({
        key: 'document',
        id: testDocId,
        panel: {key: 'discussions', id: testDocId, targetBlockId: 'block123'},
      })
    })

    test('comment opens document with comment in right panel', () => {
      const route = createDocumentNavRoute(
        testDocId,
        null,
        'comment/uid123/path/to/comment',
      )
      expect(route).toEqual({
        key: 'document',
        id: testDocId,
        panel: {
          key: 'discussions',
          id: testDocId,
          openComment: 'uid123/path/to/comment',
        },
      })
    })

    test('activity with versions filter', () => {
      const route = createDocumentNavRoute(testDocId, null, 'activity/versions')
      expect(route).toEqual({
        key: 'document',
        id: testDocId,
        panel: {key: 'activity', id: testDocId, filterEventType: ['Ref']},
      })
    })

    test('activity with comments filter', () => {
      const route = createDocumentNavRoute(testDocId, null, 'activity/comments')
      expect(route).toEqual({
        key: 'document',
        id: testDocId,
        panel: {key: 'activity', id: testDocId, filterEventType: ['Comment']},
      })
    })

    test('activity with citations filter', () => {
      const route = createDocumentNavRoute(
        testDocId,
        null,
        'activity/citations',
      )
      expect(route).toEqual({
        key: 'document',
        id: testDocId,
        panel: {
          key: 'activity',
          id: testDocId,
          filterEventType: [
            'comment/Embed',
            'doc/Embed',
            'doc/Link',
            'doc/Button',
          ],
        },
      })
    })
  })

  describe('with viewTerm', () => {
    test('activity viewTerm ignores panel, returns activity route', () => {
      const route = createDocumentNavRoute(testDocId, 'activity', null)
      expect(route).toEqual({
        key: 'activity',
        id: testDocId,
        filterEventType: undefined,
      })
    })

    test('activity viewTerm with activity/versions panelParam applies filter', () => {
      const route = createDocumentNavRoute(
        testDocId,
        'activity',
        'activity/versions',
      )
      expect(route).toEqual({
        key: 'activity',
        id: testDocId,
        filterEventType: ['Ref'],
      })
    })

    test('discussions viewTerm returns discussions route', () => {
      const route = createDocumentNavRoute(testDocId, 'discussions', null)
      expect(route).toEqual({key: 'discussions', id: testDocId})
    })

    test('directory viewTerm returns directory route', () => {
      const route = createDocumentNavRoute(testDocId, 'directory', null)
      expect(route).toEqual({key: 'directory', id: testDocId})
    })

    test('collaborators viewTerm returns collaborators route', () => {
      const route = createDocumentNavRoute(testDocId, 'collaborators', null)
      expect(route).toEqual({key: 'collaborators', id: testDocId})
    })

    test('feed viewTerm with panel preserves panel', () => {
      const route = createDocumentNavRoute(testDocId, 'feed', 'collaborators')
      expect(route).toEqual({
        key: 'feed',
        id: testDocId,
        panel: {key: 'collaborators', id: testDocId},
      })
    })
  })

  describe('with path in docId', () => {
    test('preserves docId path with panel', () => {
      const docWithPath = hmId('testuid123', {path: ['docs', 'intro']})
      const route = createDocumentNavRoute(docWithPath, null, 'collaborators')
      expect(route).toEqual({
        key: 'document',
        id: docWithPath,
        panel: {key: 'collaborators', id: docWithPath},
      })
    })
  })
})
