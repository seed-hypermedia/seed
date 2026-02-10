import {describe, expect, it} from 'vitest'
import {
  computeContactBreadcrumbs,
  computeDraftEntityParams,
  computeEntityBreadcrumbs,
  computeProfileBreadcrumbs,
  computeSimpleRouteBreadcrumbs,
  EntityContent,
  getIconForRoute,
  getWindowTitle,
} from '../route-breadcrumbs'
import {hmId, UnpackedHypermediaId} from '@shm/shared'

function makeId(uid: string, path?: string[] | null): UnpackedHypermediaId {
  return hmId(uid, {path: path ?? undefined})
}

describe('getIconForRoute', () => {
  it('contacts -> contact', () => {
    expect(getIconForRoute('contacts')).toBe('contact')
  })
  it('contact -> contact', () => {
    expect(getIconForRoute('contact')).toBe('contact')
  })
  it('profile -> contact', () => {
    expect(getIconForRoute('profile')).toBe('contact')
  })
  it('bookmarks -> star', () => {
    expect(getIconForRoute('bookmarks')).toBe('star')
  })
  it('drafts -> file', () => {
    expect(getIconForRoute('drafts')).toBe('file')
  })
  it('draft -> file', () => {
    expect(getIconForRoute('draft')).toBe('file')
  })
  it('document -> null', () => {
    expect(getIconForRoute('document')).toBeNull()
  })
  it('library -> null', () => {
    expect(getIconForRoute('library')).toBeNull()
  })
  it('feed -> null', () => {
    expect(getIconForRoute('feed')).toBeNull()
  })
})

describe('getWindowTitle', () => {
  it('contacts -> Contacts', () => {
    expect(getWindowTitle('contacts')).toBe('Contacts')
  })
  it('bookmarks -> Bookmarks', () => {
    expect(getWindowTitle('bookmarks')).toBe('Bookmarks')
  })
  it('library -> Library', () => {
    expect(getWindowTitle('library')).toBe('Library')
  })
  it('drafts -> Drafts', () => {
    expect(getWindowTitle('drafts')).toBe('Drafts')
  })
  it('contact with name', () => {
    expect(getWindowTitle('contact', 'Alice')).toBe('Contact: Alice')
  })
  it('contact without name', () => {
    expect(getWindowTitle('contact')).toBe('Contact')
  })
  it('profile with name', () => {
    expect(getWindowTitle('profile', 'Bob')).toBe('Profile: Bob')
  })
  it('profile without name', () => {
    expect(getWindowTitle('profile')).toBe('Profile')
  })
  it('draft with name', () => {
    expect(getWindowTitle('draft', 'My Draft')).toBe('Draft: My Draft')
  })
  it('draft without name', () => {
    expect(getWindowTitle('draft')).toBe('Draft')
  })
  it('document with name', () => {
    expect(getWindowTitle('document', 'My Doc')).toBe('My Doc')
  })
  it('document without name', () => {
    expect(getWindowTitle('document')).toBe('Document')
  })
  it('unknown key -> null', () => {
    expect(getWindowTitle('settings')).toBeNull()
  })
})

describe('computeSimpleRouteBreadcrumbs', () => {
  it('contacts', () => {
    const result = computeSimpleRouteBreadcrumbs('contacts')
    expect(result).not.toBeNull()
    expect(result!.items).toHaveLength(1)
    expect(result!.items[0].name).toBe('Contacts')
    expect(result!.icon).toBe('contact')
    expect(result!.windowTitle).toBe('Contacts')
  })
  it('bookmarks', () => {
    const result = computeSimpleRouteBreadcrumbs('bookmarks')
    expect(result).not.toBeNull()
    expect(result!.items).toHaveLength(1)
    expect(result!.items[0].name).toBe('Bookmarks')
    expect(result!.icon).toBe('star')
  })
  it('drafts', () => {
    const result = computeSimpleRouteBreadcrumbs('drafts')
    expect(result).not.toBeNull()
    expect(result!.items).toHaveLength(1)
    expect(result!.items[0].name).toBe('Drafts')
    expect(result!.icon).toBe('file')
  })
  it('library', () => {
    const result = computeSimpleRouteBreadcrumbs('library')
    expect(result).not.toBeNull()
    expect(result!.items).toHaveLength(1)
    expect(result!.items[0].name).toBe('Library')
    expect(result!.icon).toBeNull()
  })
  it('unknown key -> null', () => {
    expect(computeSimpleRouteBreadcrumbs('document')).toBeNull()
    expect(computeSimpleRouteBreadcrumbs('draft')).toBeNull()
    expect(computeSimpleRouteBreadcrumbs('settings')).toBeNull()
  })
})

describe('computeContactBreadcrumbs', () => {
  it('with name', () => {
    const items = computeContactBreadcrumbs('Alice')
    expect(items).toHaveLength(2)
    expect(items[0].name).toBe('Contacts')
    expect(items[1].name).toBe('Alice')
  })
  it('without name', () => {
    const items = computeContactBreadcrumbs()
    expect(items).toHaveLength(2)
    expect(items[0].name).toBe('Contacts')
    expect(items[1].name).toBe('Untitled Contact')
  })
  it('with undefined name', () => {
    const items = computeContactBreadcrumbs(undefined)
    expect(items[1].name).toBe('Untitled Contact')
  })
})

describe('computeProfileBreadcrumbs', () => {
  it('with name', () => {
    const items = computeProfileBreadcrumbs('Bob')
    expect(items).toHaveLength(2)
    expect(items[0].name).toBe('Profile')
    expect(items[1].name).toBe('Bob')
  })
  it('without name', () => {
    const items = computeProfileBreadcrumbs()
    expect(items).toHaveLength(2)
    expect(items[1].name).toBe('Untitled Profile')
  })
})

describe('computeEntityBreadcrumbs', () => {
  function makeEntityContent(
    id: UnpackedHypermediaId,
    doc?: {metadata?: {name?: string}; content?: any},
    flags?: {
      isTombstone?: boolean
      isNotFound?: boolean
      isDiscovering?: boolean
    },
  ): EntityContent {
    if (flags?.isTombstone) {
      return {id, entity: {id: id.id, isTombstone: true}, isDiscovering: false}
    }
    if (flags?.isNotFound) {
      return {id, entity: {id: id.id, isNotFound: true}, isDiscovering: false}
    }
    if (doc) {
      return {
        id,
        entity: {id: id.id, document: doc},
        isDiscovering: flags?.isDiscovering ?? false,
      }
    }
    return {id, entity: undefined, isDiscovering: flags?.isDiscovering ?? false}
  }

  it('single root entity', () => {
    const id = makeId('abc123')
    const items = computeEntityBreadcrumbs({
      entityIds: [id],
      entityContents: [makeEntityContent(id, {metadata: {name: 'My Site'}})],
      contacts: [],
    })
    expect(items).toHaveLength(1)
    // root uses getContactMetadata which returns contact name or metadata name
    expect(items[0].crumbKey).toBe('id-0')
    expect(items[0].id).toBe(id)
  })

  it('nested path produces multiple crumbs', () => {
    const rootId = makeId('abc123')
    const childId = makeId('abc123', ['docs'])
    const items = computeEntityBreadcrumbs({
      entityIds: [rootId, childId],
      entityContents: [
        makeEntityContent(rootId, {metadata: {name: 'My Site'}}),
        makeEntityContent(childId, {metadata: {name: 'Docs Page'}}),
      ],
      contacts: [],
    })
    expect(items).toHaveLength(2)
    expect(items[0].crumbKey).toBe('id-0')
    expect(items[1].crumbKey).toBe('id-1')
    expect(items[1].name).toBe('Docs Page')
  })

  it('sets fallbackName from path', () => {
    const id = makeId('abc123', ['my-page'])
    const items = computeEntityBreadcrumbs({
      entityIds: [id],
      entityContents: [makeEntityContent(id, {metadata: {name: 'My Page'}})],
      contacts: [],
    })
    expect(items[0].fallbackName).toBe('my-page')
  })

  it('sets fallbackName from uid prefix when no path', () => {
    const id = makeId('abcdefghijklmnop')
    const items = computeEntityBreadcrumbs({
      entityIds: [id],
      entityContents: [makeEntityContent(id, {metadata: {name: 'Root'}})],
      contacts: [],
    })
    expect(items[0].fallbackName).toBe('abcdefgh')
  })

  it('tombstone entity', () => {
    const id = makeId('abc123')
    const items = computeEntityBreadcrumbs({
      entityIds: [id],
      entityContents: [makeEntityContent(id, undefined, {isTombstone: true})],
      contacts: [],
    })
    expect(items[0].isTombstone).toBe(true)
    expect(items[0].isNotFound).toBe(false)
  })

  it('not-found entity', () => {
    const id = makeId('abc123')
    const items = computeEntityBreadcrumbs({
      entityIds: [id],
      entityContents: [makeEntityContent(id, undefined, {isNotFound: true})],
      contacts: [],
    })
    expect(items[0].isNotFound).toBe(true)
    expect(items[0].isTombstone).toBe(false)
  })

  it('discovering entity shows loading', () => {
    const id = makeId('abc123')
    const items = computeEntityBreadcrumbs({
      entityIds: [id],
      entityContents: [
        makeEntityContent(
          id,
          {metadata: {name: 'Test'}},
          {isDiscovering: true},
        ),
      ],
      contacts: [],
    })
    expect(items[0].isLoading).toBe(true)
  })

  it('error entity (has entity but no document, not tombstone/notFound)', () => {
    const id = makeId('abc123')
    const items = computeEntityBreadcrumbs({
      entityIds: [id],
      entityContents: [{id, entity: {id: id.id}, isDiscovering: false}],
      contacts: [],
    })
    expect(items[0].isError).toBeTruthy()
  })

  it('appends draftName', () => {
    const id = makeId('abc123')
    const items = computeEntityBreadcrumbs({
      entityIds: [id],
      entityContents: [makeEntityContent(id, {metadata: {name: 'Root'}})],
      contacts: [],
      draftName: 'New Draft',
    })
    expect(items).toHaveLength(2)
    expect(items[1].name).toBe('New Draft')
    expect(items[1].crumbKey).toBe('draft-New Draft')
  })

  it('replaceLastItem removes last entity crumb before appending draft', () => {
    const rootId = makeId('abc123')
    const childId = makeId('abc123', ['page'])
    const items = computeEntityBreadcrumbs({
      entityIds: [rootId, childId],
      entityContents: [
        makeEntityContent(rootId, {metadata: {name: 'Root'}}),
        makeEntityContent(childId, {metadata: {name: 'Page'}}),
      ],
      contacts: [],
      draftName: 'Updated Page',
      replaceLastItem: true,
    })
    // Root + draft (child replaced)
    expect(items).toHaveLength(2)
    expect(items[0].crumbKey).toBe('id-0')
    expect(items[1].name).toBe('Updated Page')
  })

  it('appends directory panel crumb', () => {
    const id = makeId('abc123')
    const items = computeEntityBreadcrumbs({
      entityIds: [id],
      entityContents: [makeEntityContent(id, {metadata: {name: 'Root'}})],
      contacts: [],
      panel: {key: 'directory'},
    })
    expect(items.at(-1)?.name).toBe('Directory')
    expect(items.at(-1)?.crumbKey).toBe('directory')
  })

  it('appends collaborators panel crumb', () => {
    const id = makeId('abc123')
    const items = computeEntityBreadcrumbs({
      entityIds: [id],
      entityContents: [makeEntityContent(id, {metadata: {name: 'Root'}})],
      contacts: [],
      panel: {key: 'collaborators'},
    })
    expect(items.at(-1)?.name).toBe('Collaborators')
  })

  it('appends activity panel crumb', () => {
    const id = makeId('abc123')
    const items = computeEntityBreadcrumbs({
      entityIds: [id],
      entityContents: [makeEntityContent(id, {metadata: {name: 'Root'}})],
      contacts: [],
      panel: {key: 'activity'},
    })
    expect(items.at(-1)?.name).toBe('Activity')
  })

  it('appends discussions panel crumb', () => {
    const id = makeId('abc123')
    const items = computeEntityBreadcrumbs({
      entityIds: [id],
      entityContents: [makeEntityContent(id, {metadata: {name: 'Root'}})],
      contacts: [],
      panel: {key: 'discussions'},
    })
    expect(items.at(-1)?.name).toBe('Discussions')
    expect(items.at(-1)?.crumbKey).toBe('discussions')
  })

  it('discussions with openComment and author name', () => {
    const id = makeId('abc123')
    const items = computeEntityBreadcrumbs({
      entityIds: [id],
      entityContents: [makeEntityContent(id, {metadata: {name: 'Root'}})],
      contacts: [],
      panel: {key: 'discussions', openComment: 'someComment'},
      commentAuthorName: 'Alice',
    })
    expect(items.at(-1)?.name).toBe('Comment by Alice')
    expect(items.at(-1)?.crumbKey).toBe('comment')
  })

  it('discussions with openComment but no author name', () => {
    const id = makeId('abc123')
    const items = computeEntityBreadcrumbs({
      entityIds: [id],
      entityContents: [makeEntityContent(id, {metadata: {name: 'Root'}})],
      contacts: [],
      panel: {key: 'discussions', openComment: 'someComment'},
    })
    expect(items.at(-1)?.name).toBe('Comment')
  })

  it('discussions with openComment shows loading state', () => {
    const id = makeId('abc123')
    const items = computeEntityBreadcrumbs({
      entityIds: [id],
      entityContents: [makeEntityContent(id, {metadata: {name: 'Root'}})],
      contacts: [],
      panel: {key: 'discussions', openComment: 'someComment'},
      commentIsLoading: true,
    })
    expect(items.at(-1)?.isLoading).toBe(true)
  })

  it('empty entityIds produces empty crumbs', () => {
    const items = computeEntityBreadcrumbs({
      entityIds: [],
      entityContents: [],
      contacts: [],
    })
    expect(items).toHaveLength(0)
  })
})

describe('computeDraftEntityParams', () => {
  const draftRoute = {
    key: 'draft' as const,
    id: 'draft-123',
    locationUid: undefined,
    locationPath: undefined,
    editUid: undefined,
    editPath: undefined,
    panel: null,
    visibility: undefined,
  }

  it('with locationId from draft data', () => {
    const locationId = makeId('uid1', ['path1'])
    const result = computeDraftEntityParams(
      {metadata: {name: 'My Draft'}, visibility: 'PUBLIC'},
      draftRoute as any,
      locationId,
      undefined,
      undefined,
    )
    expect(result.entityId).toBe(locationId)
    expect(result.draftName).toBe('My Draft')
    expect(result.hideControls).toBe(true)
    expect(result.isFallback).toBe(false)
    expect(result.replaceLastItem).toBe(false)
    expect(result.isNewDraft).toBe(false)
  })

  it('with editId', () => {
    const editId = makeId('uid2', ['page'])
    const result = computeDraftEntityParams(
      {metadata: {name: 'Edited Page'}, deps: ['dep1']},
      draftRoute as any,
      undefined,
      editId,
      'Original Page',
    )
    expect(result.entityId).toBe(editId)
    expect(result.draftName).toBe('Edited Page')
    expect(result.replaceLastItem).toBe(true)
    expect(result.isNewDraft).toBe(false)
    expect(result.isFallback).toBe(false)
  })

  it('editId with no deps -> isNewDraft', () => {
    const editId = makeId('uid2', ['page'])
    const result = computeDraftEntityParams(
      {metadata: {name: 'New Page'}, deps: []},
      draftRoute as any,
      undefined,
      editId,
      undefined,
    )
    expect(result.isNewDraft).toBe(true)
  })

  it('editId with no draft name uses editDocName', () => {
    const editId = makeId('uid2', ['page'])
    const result = computeDraftEntityParams(
      {metadata: {}},
      draftRoute as any,
      undefined,
      editId,
      'Original Title',
    )
    expect(result.draftName).toBe('Original Title')
    expect(result.replaceLastItem).toBe(true)
  })

  it('private draft strips path to account root', () => {
    const locationId = makeId('uid1', ['secret', 'path'])
    const privateRoute = {...draftRoute, visibility: 'PRIVATE' as const}
    const result = computeDraftEntityParams(
      {metadata: {name: 'Private Draft'}},
      privateRoute as any,
      locationId,
      undefined,
      undefined,
    )
    expect(result.entityId?.uid).toBe('uid1')
    expect(result.entityId?.path).toEqual([])
  })

  it('fallback when no locationId or editId', () => {
    const result = computeDraftEntityParams(
      {metadata: {name: 'Orphan Draft'}},
      draftRoute as any,
      undefined,
      undefined,
      undefined,
    )
    expect(result.isFallback).toBe(true)
    expect(result.entityId).toBeUndefined()
    expect(result.fallbackDraftName).toBe('Orphan Draft')
  })

  it('fallback with no draft name', () => {
    const result = computeDraftEntityParams(
      null,
      draftRoute as any,
      undefined,
      undefined,
      undefined,
    )
    expect(result.isFallback).toBe(true)
    expect(result.fallbackDraftName).toBe('New Draft')
  })
})
