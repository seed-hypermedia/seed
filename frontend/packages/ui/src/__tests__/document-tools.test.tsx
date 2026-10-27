// @vitest-environment jsdom
import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {hmId, activitySlugToFilter, type NavRoute} from '@shm/shared'
import {DocumentTools, getDocumentToolRoute} from '../document-tools'

vi.mock('../page-tabs', () => ({
  PageTab: ({label, count, showZeroCount}: {label?: string; count?: number; showZeroCount?: boolean}) => (
    <span data-label={label} data-count={count} data-show-zero-count={showZeroCount}>
      {label}
    </span>
  ),
}))
;(globalThis as typeof globalThis & {React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean}).React = React
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('DocumentTools', () => {
  it('shows the Attributes tab with a zero count when the document has no custom attributes', () => {
    act(() => {
      root.render(<DocumentTools id={hmId('alice', {path: ['doc']})} metadataCount={0} />)
    })

    const attributesTabs = Array.from(container.querySelectorAll('[data-label="Attributes"]')).filter(
      (tab) => !tab.closest('[aria-hidden="true"]'),
    )
    expect(attributesTabs).toHaveLength(1)
    expect(Array.from(attributesTabs).every((tab) => tab.getAttribute('data-count') === '0')).toBe(true)
    expect(Array.from(attributesTabs).every((tab) => tab.getAttribute('data-show-zero-count') === 'true')).toBe(true)
  })
})

describe('document tool panel navigation', () => {
  const id = hmId('alice', {path: ['doc'], version: 'v1', blockRef: 'paragraph'})
  it.each(['collaborators', 'comments', 'metadata'] as const)('opens %s without moving the document', (key) => {
    const route: NavRoute = {key: 'document', id, panel: {key: 'activity', id}}
    expect(getDocumentToolRoute(route, id, {key, id})).toEqual({...route, panel: {key, id}})
  })

  it('keeps the draft open when a tool is selected', () => {
    const route: NavRoute = {key: 'draft', id: 'draft-1', editUid: 'alice', editPath: ['doc']}
    expect(getDocumentToolRoute(route, id, {key: 'comments', id})).toEqual({...route, panel: {key: 'comments', id}})
  })

  it('moves an expanded thread into the panel with its selected reply', () => {
    const route: NavRoute = {
      key: 'comments',
      id,
      openComment: 'alice/root',
      replyCommentId: 'alice/reply',
      panel: {key: 'collaborators', id},
    }
    expect(getDocumentToolRoute(route, id, {key: 'comments', id})).toEqual({
      key: 'document',
      id,
      panel: {key: 'comments', id, openComment: 'alice/root', replyCommentId: 'alice/reply'},
    })
  })

  it('uses the citations filter even when the main activity page has a different filter', () => {
    const route: NavRoute = {key: 'activity', id, filterEventType: ['Update']}
    const panel = {key: 'activity' as const, id, filterEventType: activitySlugToFilter('citations')}
    expect(getDocumentToolRoute(route, id, panel)).toEqual({key: 'document', id, panel})
  })

  it('does not pin a resolved document version when no current route is supplied', () => {
    expect(getDocumentToolRoute(undefined, id, {key: 'metadata', id})).toMatchObject({
      key: 'document',
      id: {version: null, latest: true},
    })
  })
})
