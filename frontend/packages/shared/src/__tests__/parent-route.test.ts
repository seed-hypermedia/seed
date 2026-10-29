import {describe, expect, it} from 'vitest'
import type {NavRoute} from '../routes'
import {hmId} from '../utils/entity-id-url'
import {getParentRoute} from '../utils/parent-route'

const home = hmId('alice')
const notes = hmId('alice', {path: ['notes']})
const note = hmId('alice', {path: ['notes', 'today']})

/** Presses Cmd+Up until nothing happens and returns every route visited. */
function walkUp(start: NavRoute): NavRoute[] {
  const visited: NavRoute[] = []
  let route: NavRoute | null = start
  while (route && visited.length < 10) {
    route = getParentRoute(route)
    if (route) visited.push(route)
  }
  return visited
}

describe('getParentRoute', () => {
  it('walks from a single comment to all comments, the document, each ancestor, and stops at home', () => {
    expect(walkUp({key: 'comments', id: note, openComment: 'c1', replyCommentId: 'c2'})).toEqual([
      {key: 'comments', id: note, panel: undefined},
      {key: 'document', id: note, panel: undefined},
      {key: 'document', id: notes},
      {key: 'document', id: home},
    ])
  })

  it('does nothing at the space home', () => {
    expect(getParentRoute({key: 'document', id: home})).toBeNull()
  })

  it('drops the version pin when moving to the parent document', () => {
    const parent = getParentRoute({key: 'document', id: hmId('alice', {path: ['notes', 'today'], version: 'v1'})})
    expect(parent).toEqual({key: 'document', id: notes})
  })

  it('steps a comment open in the side panel back to the comments panel before closing it', () => {
    const start: NavRoute = {
      key: 'document',
      id: note,
      panel: {key: 'comments', id: note, openComment: 'c1', isReplying: true},
    }
    expect(walkUp(start).slice(0, 3)).toEqual([
      {key: 'document', id: note, panel: {key: 'comments', id: note}},
      {key: 'document', id: note, panel: null},
      {key: 'document', id: notes},
    ])
  })

  it('closes other side panels in one step', () => {
    expect(getParentRoute({key: 'document', id: note, panel: {key: 'activity', id: note}})).toEqual({
      key: 'document',
      id: note,
      panel: null,
    })
  })

  it('clears a focused block before leaving the document', () => {
    const focused = hmId('alice', {path: ['notes', 'today'], blockRef: 'b1'})
    expect(getParentRoute({key: 'document', id: focused, isBlockFocused: true})).toEqual({
      key: 'document',
      id: {...focused, blockRef: null, blockRange: null},
    })
  })

  it('returns document tool views to the document content', () => {
    for (const key of ['activity', 'directory', 'collaborators', 'metadata'] as const) {
      expect(getParentRoute({key, id: note})).toEqual({key: 'document', id: note, panel: undefined})
    }
    expect(getParentRoute({key: 'feed', id: home})).toEqual({key: 'document', id: home})
    expect(getParentRoute({key: 'all-documents', id: home})).toEqual({key: 'document', id: home})
  })

  it('takes a new draft to the document it is being created under', () => {
    expect(getParentRoute({key: 'draft', id: 'd1', locationUid: 'alice', locationPath: ['notes']})).toEqual({
      key: 'document',
      id: notes,
    })
  })

  it('takes a draft of an existing document to that document’s parent', () => {
    expect(getParentRoute({key: 'draft', id: 'd1', editUid: 'alice', editPath: ['notes', 'today']})).toEqual({
      key: 'document',
      id: notes,
    })
    expect(getParentRoute({key: 'draft', id: 'd1', editUid: 'alice', editPath: []})).toBeNull()
  })

  it('has no parent for app pages outside a space', () => {
    expect(getParentRoute({key: 'library'})).toBeNull()
    expect(getParentRoute({key: 'contacts'})).toBeNull()
    expect(getParentRoute({key: 'draft', id: 'd1'})).toBeNull()
  })
})
