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
  isComment: true,
  loaded: true,
  destination: null as NavRoute | null,
}))

vi.mock('@shm/shared/models/entity', () => ({
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
vi.mock('@shm/shared/readonly-viewer-context', () => ({useReadOnlyViewer: () => null}))

let container: HTMLDivElement
let root: Root
beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
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
})

function openLocation() {
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
  act(() => document.body.querySelector<HTMLButtonElement>('button[aria-expanded]')!.click())
  const link = document.body.querySelector<HTMLAnchorElement>('a')!
  act(() => link.click())
  return link.getAttribute('href')
}

describe('connection locations', () => {
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
