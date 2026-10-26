// @vitest-environment jsdom
import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import type {NavRoute} from '@shm/shared'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {EmbedWrapper, getEmbedDocumentRoute} from '../embed-wrapper'
;(globalThis as typeof globalThis & {React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean}).React = React
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const {currentRoute, routeOnClickMock, routeLinkMock} = vi.hoisted(() => ({
  currentRoute: {
    value: null as unknown as NavRoute,
  },
  routeOnClickMock: vi.fn(),
  routeLinkMock: vi.fn(),
}))

vi.mock('@shm/shared/routing', () => ({
  useRouteLink: (route: unknown) => {
    routeLinkMock(route)
    return {href: '#embed-target', onClick: routeOnClickMock}
  },
}))

vi.mock('@shm/shared/utils/navigation', () => ({
  useNavRoute: () => currentRoute.value,
}))

vi.mock('../highlight-context', () => ({
  useHighlighter: () => () => ({}),
}))

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  routeOnClickMock.mockReset()
  routeLinkMock.mockReset()
  currentRoute.value = {key: 'document', id: hmId('uid-1', {path: ['doc']})}
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
})

describe('EmbedWrapper', () => {
  it('does not apply legacy range-elision class to ranged embeds', () => {
    act(() => {
      root.render(
        <EmbedWrapper
          id={hmId('uid-1', {path: ['doc'], blockRef: 'block-1', blockRange: {start: 1, end: 3}})}
          parentBlockId={null}
          isRange
        >
          <span>whole block content</span>
        </EmbedWrapper>,
      )
    })

    const wrapper = container.querySelector('[data-content-type="embed"]') as HTMLElement | null
    expect(wrapper).toBeTruthy()
    expect(wrapper?.className).not.toContain('hm-embed-range-wrapper')
    expect(wrapper?.dataset.isRange).toBe('true')
  })

  it('lets links inside embed content handle the click instead of opening the outer embed', () => {
    act(() => {
      root.render(
        <EmbedWrapper
          id={hmId('uid-1', {path: ['doc']})}
          parentBlockId={null}
          route={{key: 'document', id: hmId('uid-1', {path: ['doc']})}}
        >
          <span className="link" {...({href: '#inner-link'} as any)}>
            inner link
          </span>
        </EmbedWrapper>,
      )
    })

    const innerLink = container.querySelector('.link[href="#inner-link"]') as HTMLElement | null
    expect(innerLink).toBeTruthy()

    innerLink?.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true}))

    expect(routeOnClickMock).not.toHaveBeenCalled()
  })

  it('preserves an active comments panel while passing a block-ref document embed id unchanged', () => {
    const panelId = hmId('uid-source', {path: ['source']})
    const targetId = hmId('uid-target', {
      path: ['target'],
      blockRef: 'embedded-block',
      blockRange: {start: 2, end: 7},
    })
    currentRoute.value = {
      key: 'comments',
      id: panelId,
      panel: {key: 'comments', id: panelId, openComment: 'source-comment'},
    }

    act(() => {
      root.render(
        <EmbedWrapper id={targetId} parentBlockId={null} route={{key: 'document', id: targetId}}>
          embedded content
        </EmbedWrapper>,
      )
    })

    expect(routeLinkMock).toHaveBeenLastCalledWith({
      key: 'document',
      id: targetId,
      panel: {key: 'comments', id: panelId, openComment: 'source-comment'},
    })
  })
})

describe('embed reference routes', () => {
  it('moves an expanded thread into the panel while selecting document content', () => {
    const id = hmId('alice', {path: ['notes'], latest: true})
    const reference = hmId('alice', {
      path: ['notes'],
      version: 'quoted-version',
      blockRef: 'block',
      blockRange: {start: 2, end: 8},
    })
    expect(
      getEmbedDocumentRoute(reference, {key: 'comments', id, openComment: 'root', replyCommentId: 'reply'}),
    ).toEqual({
      key: 'document',
      id: {...id, blockRef: 'block', blockRange: {start: 2, end: 8}},
      panel: {key: 'comments', id, openComment: 'root', replyCommentId: 'reply'},
    })
  })

  it('preserves the active document version and panel when selecting its reference', () => {
    const id = hmId('alice', {path: ['notes'], latest: true})
    const panel = {key: 'comments' as const, id, openComment: 'thread'}
    const route = {key: 'document' as const, id, panel}
    const reference = hmId('alice', {
      path: ['notes'],
      version: 'quoted-version',
      blockRef: 'block',
      blockRange: {start: 2, end: 8},
    })
    expect(getEmbedDocumentRoute(reference, route)).toEqual({
      ...route,
      id: {...id, blockRef: 'block', blockRange: {start: 2, end: 8}},
    })
    expect(route.id.blockRef).toBeNull()
  })
})
