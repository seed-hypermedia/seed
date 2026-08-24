import {hmId} from '@shm/shared'
import {activitySlugToFilter} from '@shm/shared/utils/entity-id-url'
import React from 'react'
import {createRoot, Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {WindowTitle} from '../window-title'

const state = vi.hoisted(() => ({
  route: {} as any,
  resourceName: undefined as string | undefined,
}))

vi.mock('@shm/shared/utils/navigation', () => ({
  useNavRoute: () => state.route,
}))

vi.mock('@shm/shared/models/entity', () => ({
  useResource: () => ({
    data: state.resourceName
      ? {type: 'document', document: {metadata: {name: state.resourceName}, path: []}}
      : undefined,
  }),
}))

describe('WindowTitle', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    root = createRoot(container)
    state.resourceName = undefined
  })

  afterEach(() => {
    act(() => root.unmount())
  })

  it('updates the title from dedicated routes but ignores right panels', () => {
    const id = hmId('alice')
    state.resourceName = 'Document A'
    state.route = {key: 'document', id}

    act(() => root.render(<WindowTitle />))
    expect(document.title).toBe('Document A')

    state.route = {key: 'activity', id, filterEventType: activitySlugToFilter('citations')}
    act(() => root.render(<WindowTitle />))
    expect(document.title).toBe('Document A – Citations')

    state.route = {key: 'document', id, panel: {key: 'comments'}}
    act(() => root.render(<WindowTitle />))
    expect(document.title).toBe('Document A')
  })

  it('uses Seed until the active resource resolves', () => {
    state.route = {key: 'document', id: hmId('alice')}

    act(() => root.render(<WindowTitle />))
    expect(document.title).toBe('Seed')

    state.resourceName = 'Document A'
    act(() => root.render(<WindowTitle />))
    expect(document.title).toBe('Document A')
  })
})
