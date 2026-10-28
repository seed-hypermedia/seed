// @vitest-environment jsdom
import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {hmId, UniversalAppProvider, type NavRoute} from '@shm/shared'
import {MobilePanelSheet} from '../mobile-panel-sheet'
import {ConnectionsPanel} from '../connections-panel'
;(globalThis as any).React = React
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

const state = vi.hoisted(() => ({
  hasChild: false,
  isComment: true,
  loaded: true,
  destination: null as NavRoute | null,
}))

vi.mock('@shm/shared/models/entity', () => ({
  useDirectory: () => ({
    data: state.hasChild
      ? [{id: hmId('target', {path: ['child']}), metadata: {name: 'Child note'}, visibility: 'PUBLIC'}]
      : [],
  }),
  useCitations: () => ({
    data: {
      citations: [
        {
          sourceType: state.isComment ? 'Comment' : 'Ref',
          source: state.isComment ? 'hm://author/comment' : 'hm://site/doc?v=source-version',
          sourceDocument: 'hm://site/doc',
          sourceContext: 'block',
          sourceBlob: {cid: 'ref-blob'},
        },
      ],
    },
  }),
  useResource: (id: ReturnType<typeof hmId> | null) => ({
    data:
      id?.uid === 'author'
        ? state.loaded
          ? {type: 'comment', comment: {id: 'author/comment', content: []}}
          : undefined
        : {type: 'document', document: {metadata: {name: 'Source document'}, content: []}},
  }),
}))
vi.mock('@shm/shared/models/capabilities', () => ({useCanSeePrivateDocs: () => false}))
vi.mock('pele/lazy', () => ({enableZoom: () => ({destroy() {}})}))
vi.mock('@shm/shared/readonly-viewer-context', () => ({useReadOnlyViewer: () => null}))

let container: HTMLDivElement
let root: Root
beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  )
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  state.hasChild = false
  state.isComment = true
  state.loaded = true
  state.destination = null
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function renderPanel() {
  act(() =>
    root.render(
      <UniversalAppProvider
        openUrl={() => {}}
        openRoute={(route) => {
          state.destination = route
        }}
        universalClient={{request: async () => null} as any}
      >
        <MobilePanelSheet isOpen title="Connections" onClose={() => {}} resizable>
          <ConnectionsPanel docId={hmId('target')} />
        </MobilePanelSheet>
      </UniversalAppProvider>,
    ),
  )
}

function openLocation(fromGraph = false) {
  renderPanel()
  act(() =>
    document.body
      .querySelector(fromGraph ? '[role=button][aria-pressed]' : 'section button[aria-expanded]')!
      .dispatchEvent(new MouseEvent('click', {bubbles: true})),
  )
  const link = Array.from(document.body.querySelectorAll<HTMLAnchorElement>('a')).find(
    (link) => link.textContent?.includes('Go to location'),
  )!
  act(() => link.click())
  return link.getAttribute('href')
}

describe('connection locations', () => {
  it('restores the constellation after organizing without losing the selected document', () => {
    state.hasChild = true
    renderPanel()
    const node = () => document.body.querySelector('[aria-label="Select Child note"]')!
    const initial = node().getAttribute('transform')
    act(() => node().dispatchEvent(new MouseEvent('click', {bubbles: true})))
    const toggle = (label: string) =>
      Array.from(document.body.querySelectorAll('button')).find((button) => button.textContent === label)!
    act(() => toggle('Organize').click())
    expect(node().getAttribute('transform')).not.toBe(initial)
    expect(node().getAttribute('aria-pressed')).toBe('true')
    act(() => toggle('Constellation').click())
    expect(node().getAttribute('transform')).toBe(initial)
    expect(node().getAttribute('aria-pressed')).toBe('true')
    expect(state.destination).toBeNull()
  })

  it('selects a child without navigation, then opens it with its document route', () => {
    state.hasChild = true
    renderPanel()
    const node = document.body.querySelector('[aria-label="Select Child note"]')!
    act(() => node.dispatchEvent(new MouseEvent('click', {bubbles: true})))
    expect(state.destination).toBeNull()
    const open = Array.from(document.body.querySelectorAll<HTMLAnchorElement>('a')).find(
      (link) => link.textContent === 'Open document',
    )!
    act(() => open.click())
    expect(state.destination).toMatchObject({key: 'document', id: {uid: 'target', path: ['child']}})
  })

  it('opens the source preview from the graph and retains comment navigation', () => {
    expect(openLocation(true)).toContain('/hm/site/doc?panel=comments/author/comment')
    expect(state.destination).toMatchObject({
      key: 'document',
      id: {uid: 'site', path: ['doc']},
      panel: {key: 'comments', openComment: 'author/comment', blockId: 'block'},
    })
  })

  it.each([true, false])('opens a comment panel when source content is loaded=%s', (loaded) => {
    state.loaded = loaded
    expect(openLocation()).toContain('/hm/site/doc?panel=comments/author/comment')
    expect(state.destination).toMatchObject({
      key: 'document',
      id: {uid: 'site', path: ['doc']},
      panel: {key: 'comments', openComment: 'author/comment', blockId: 'block'},
    })
  })

  it('opens document backlinks in the main content at their source version and block', () => {
    state.isComment = false
    expect(openLocation()).toBe('/hm/site/doc?v=source-version#block')
    expect(state.destination).toMatchObject({
      key: 'document',
      id: {uid: 'site', path: ['doc'], version: 'source-version', blockRef: 'block'},
    })
    expect(state.destination).not.toHaveProperty('panel')
  })
})
