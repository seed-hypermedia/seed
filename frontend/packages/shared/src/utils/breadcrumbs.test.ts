import {describe, expect, it} from 'vitest'
import {hmId} from './entity-id-url'
import {getBreadcrumbDocumentIds} from './breadcrumbs'

describe('getBreadcrumbDocumentIds', () => {
  it('keeps parent breadcrumbs unversioned and preserves current version', () => {
    const docId = hmId('zDocs', {
      path: ['guides', 'install'],
      version: 'v123',
    })

    const ids = getBreadcrumbDocumentIds(docId)

    expect(ids).toHaveLength(3)
    expect(ids.map((id) => id.path)).toEqual([[], ['guides'], ['guides', 'install']])
    expect(ids.map((id) => id.version)).toEqual([null, null, 'v123'])
  })

  it('preserves latest flag on current breadcrumb', () => {
    const docId = hmId('zDocs', {
      path: ['guides'],
      latest: true,
    })

    const ids = getBreadcrumbDocumentIds(docId)

    expect(ids).toHaveLength(2)
    expect(ids[0]?.latest).toBeUndefined()
    expect(ids[1]?.latest).toBe(true)
  })
})
