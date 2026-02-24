import {describe, expect, test} from 'vitest'
import {createDocumentNavRoute} from '../routes'
import {routeToHref} from '../routing'
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

    test('comments panel', () => {
      const route = createDocumentNavRoute(testDocId, null, 'comments')
      expect(route).toEqual({
        key: 'document',
        id: testDocId,
        panel: {key: 'comments', id: testDocId},
      })
    })

    test('discussions panel (backward compat)', () => {
      const route = createDocumentNavRoute(testDocId, null, 'discussions')
      expect(route).toEqual({
        key: 'document',
        id: testDocId,
        panel: {key: 'comments', id: testDocId},
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
    test('comments panel opens document with comments right panel', () => {
      const route = createDocumentNavRoute(testDocId, null, 'comments/block123')
      expect(route).toEqual({
        key: 'document',
        id: testDocId,
        panel: {key: 'comments', id: testDocId, openComment: 'block123'},
      })
    })

    test('discussions/BLOCKID backward compat', () => {
      const route = createDocumentNavRoute(testDocId, null, 'discussions/block123')
      expect(route).toEqual({
        key: 'document',
        id: testDocId,
        panel: {key: 'comments', id: testDocId, targetBlockId: 'block123'},
      })
    })

    test('comments/ panel opens document with comments right panel + openComment', () => {
      const route = createDocumentNavRoute(testDocId, null, 'comments/uid123/path/to/comment')
      expect(route).toEqual({
        key: 'document',
        id: testDocId,
        panel: {key: 'comments', id: testDocId, openComment: 'uid123/path/to/comment'},
      })
    })

    test('comment/ backward compat opens document with comments right panel', () => {
      const route = createDocumentNavRoute(testDocId, null, 'comment/uid123/path/to/comment')
      expect(route).toEqual({
        key: 'document',
        id: testDocId,
        panel: {key: 'comments', id: testDocId, openComment: 'uid123/path/to/comment'},
      })
    })

    test('comments viewTerm + comments panel → comments main + right panel', () => {
      const route = createDocumentNavRoute(testDocId, 'comments', 'comments/uid123/tsid456')
      expect(route).toEqual({
        key: 'comments',
        id: testDocId,
        panel: {key: 'comments', id: testDocId, openComment: 'uid123/tsid456'},
      })
    })

    test('comments viewTerm + openComment → comments main with highlight', () => {
      const route = createDocumentNavRoute(testDocId, 'comments', null, 'uid123/tsid456')
      expect(route).toEqual({
        key: 'comments',
        id: testDocId,
        openComment: 'uid123/tsid456',
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
      const route = createDocumentNavRoute(testDocId, null, 'activity/citations')
      expect(route).toEqual({
        key: 'document',
        id: testDocId,
        panel: {
          key: 'activity',
          id: testDocId,
          filterEventType: ['comment/Embed', 'doc/Embed', 'doc/Link', 'doc/Button'],
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
      const route = createDocumentNavRoute(testDocId, 'activity', 'activity/versions')
      expect(route).toEqual({
        key: 'activity',
        id: testDocId,
        filterEventType: ['Ref'],
      })
    })

    test('comments viewTerm returns comments route', () => {
      const route = createDocumentNavRoute(testDocId, 'comments', null)
      expect(route).toEqual({key: 'comments', id: testDocId})
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

describe('routeToHref', () => {
  const originHome = hmId('uid1')

  test('comments route generates view-term href', () => {
    const href = routeToHref({key: 'comments', id: hmId('uid1')}, {originHomeId: originHome})
    expect(href).toBe('/:comments')
  })

  test('comments route with openComment includes commentId in path', () => {
    const href = routeToHref({key: 'comments', id: hmId('uid1'), openComment: 'z6Mk/z6FC'}, {originHomeId: originHome})
    expect(href).toBe('/:comments/z6Mk/z6FC')
  })

  test('comments route with blockRef includes fragment', () => {
    const href = routeToHref(
      {key: 'comments', id: hmId('uid1', {blockRef: 'blk1', blockRange: {expanded: true}}), openComment: 'z6Mk/z6FC'},
      {originHomeId: originHome},
    )
    expect(href).toBe('/:comments/z6Mk/z6FC#blk1+')
  })

  test('comments route with blockRef range includes fragment', () => {
    const href = routeToHref(
      {
        key: 'comments',
        id: hmId('uid1', {blockRef: 'blk1', blockRange: {start: 5, end: 10}}),
        openComment: 'z6Mk/z6FC',
      },
      {originHomeId: originHome},
    )
    expect(href).toBe('/:comments/z6Mk/z6FC#blk1[5:10]')
  })

  test('activity route with blockRef includes fragment', () => {
    const href = routeToHref({key: 'activity', id: hmId('uid1', {blockRef: 'blk2'})}, {originHomeId: originHome})
    expect(href).toBe('/:activity#blk2')
  })

  test('comments route with doc path generates correct href', () => {
    const href = routeToHref(
      {key: 'comments', id: hmId('uid1', {path: ['docs', 'intro']}), openComment: 'z6Mk/z6FC'},
      {originHomeId: originHome},
    )
    expect(href).toBe('/docs/intro/:comments/z6Mk/z6FC')
  })

  test('comments route with different uid generates /hm/ href', () => {
    const href = routeToHref({key: 'comments', id: hmId('uid2'), openComment: 'z6Mk/z6FC'}, {originHomeId: originHome})
    expect(href).toBe('/hm/uid2/:comments/z6Mk/z6FC')
  })
})
