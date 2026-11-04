import {hmId, type NavRoute} from '@shm/shared'
import {describe, expect, it} from 'vitest'
import {getHrefLocation, shouldDeferNavRoute, takePendingNavRoute} from './pending-nav-route'

const notes = hmId('site', {path: ['notes', 'runs']})
const runs = hmId('docs', {path: ['agent', 'runs'], version: 'v1'})

describe('shouldDeferNavRoute', () => {
  it('defers a move to another document until Remix lands it', () => {
    // Clicking an embed of `runs` on `notes`: committing early labels the still-visible `notes`
    // page as `runs`, and its embed of `runs` reads as a recursive loop.
    expect(shouldDeferNavRoute({key: 'document', id: notes}, {key: 'document', id: runs})).toBe(true)
  })

  it('defers a move to another version of the same document', () => {
    expect(shouldDeferNavRoute({key: 'document', id: runs}, {key: 'document', id: {...runs, version: 'v2'}})).toBe(true)
  })

  it('commits same-document changes right away', () => {
    expect(shouldDeferNavRoute({key: 'document', id: runs}, {key: 'document', id: {...runs, blockRef: 'b1'}})).toBe(
      false,
    )
    expect(
      shouldDeferNavRoute({key: 'document', id: runs}, {
        key: 'document',
        id: runs,
        panel: {key: 'comments', id: runs},
      } as NavRoute),
    ).toBe(false)
  })

  it('defers routes that are not bound to a document', () => {
    expect(shouldDeferNavRoute({key: 'document', id: runs}, {key: 'library'} as NavRoute)).toBe(true)
  })
})

describe('takePendingNavRoute', () => {
  const pending = {route: {key: 'document', id: runs} as NavRoute, location: '/hm/docs/agent/runs?v=v1', replace: false}

  it('returns the pending route once its location commits', () => {
    expect(takePendingNavRoute(pending, '/hm/docs/agent/runs?v=v1')).toBe(pending)
  })

  it('ignores it when another location committed (interrupted navigation, back button)', () => {
    expect(takePendingNavRoute(pending, '/hm/site/notes/runs')).toBeNull()
    expect(takePendingNavRoute(null, '/hm/docs/agent/runs?v=v1')).toBeNull()
  })
})

describe('getHrefLocation', () => {
  it('keeps pathname and search, dropping origin and hash', () => {
    expect(getHrefLocation('/hm/docs/agent/runs?v=v1#blk', 'https://example.com')).toBe('/hm/docs/agent/runs?v=v1')
    expect(getHrefLocation('https://example.com/a?b=1', 'https://example.com')).toBe('/a?b=1')
  })
})
