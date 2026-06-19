// @vitest-environment jsdom
import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {hmId, packHmId} from '@shm/shared/utils/entity-id-url'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {BlockEmbedCard} from '../embed-views'
;(globalThis as typeof globalThis & {React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean}).React = React
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const {resourceId} = vi.hoisted(() => ({
  resourceId: {
    id: 'hm://uid-1/doc',
    uid: 'uid-1',
    path: ['doc'],
    version: null,
    latest: true,
    blockRef: null,
    blockRange: null,
    hostname: null,
    scheme: null,
  },
}))

vi.mock('@shm/shared/models/entity', () => ({
  useResource: () => ({
    data: {
      type: 'document',
      id: resourceId,
      document: {
        metadata: {name: 'Embedded document card'},
        authors: [],
        content: [],
        version: 'version-1',
        visibility: 'PUBLIC',
      },
    },
    isInitialLoading: false,
    isError: false,
    isTombstone: false,
  }),
  useResources: () => [],
}))

vi.mock('@shm/shared/models/interaction-summary', () => ({
  useInteractionSummary: () => ({data: null}),
}))

vi.mock('../embed-wrapper', () => ({
  EmbedWrapper: ({children, openOnClick, route, viewType}: any) => (
    <div
      data-testid="embed-wrapper"
      data-open-on-click={String(openOnClick)}
      data-route-key={route?.key ?? ''}
      data-view={viewType}
    >
      {children}
    </div>
  ),
}))

vi.mock('../newspaper', () => ({
  DocumentCard: ({navigate, titleLinkOnly}: any) => (
    <div data-testid="document-card" data-navigate={String(navigate)} data-title-link-only={String(titleLinkOnly)} />
  ),
}))

let container: HTMLDivElement
let root: Root

beforeEach(() => {
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

function renderBlockEmbedCard({
  openOnClick = true,
  titleLinkOnly = false,
}: {
  openOnClick?: boolean
  titleLinkOnly?: boolean
} = {}) {
  const docId = hmId('uid-1', {path: ['doc']})

  act(() => {
    root.render(
      <BlockEmbedCard
        block={{
          id: 'embed-1',
          type: 'Embed',
          text: '',
          attributes: {view: 'Card', childrenType: 'Group'},
          annotations: [],
          link: packHmId(docId),
        }}
        parentBlockId={null}
        openOnClick={openOnClick}
        titleLinkOnly={titleLinkOnly}
      />,
    )
  })

  return {docId}
}

describe('BlockEmbedCard navigation surface', () => {
  it('puts whole-card navigation on the document card instead of the outer embed wrapper', () => {
    renderBlockEmbedCard()

    const embedWrapper = container.querySelector('[data-testid="embed-wrapper"]') as HTMLElement | null
    expect(embedWrapper).toBeTruthy()
    expect(embedWrapper?.dataset.openOnClick).toBe('false')
    expect(embedWrapper?.dataset.routeKey).toBe('document')
    expect(embedWrapper?.dataset.view).toBe('Card')

    const card = container.querySelector('[data-testid="document-card"]') as HTMLElement | null
    expect(card).toBeTruthy()
    expect(card?.dataset.navigate).toBe('true')
    expect(card?.dataset.titleLinkOnly).toBe('false')
  })

  it('keeps title-only navigation on the document card title without enabling the outer embed wrapper', () => {
    renderBlockEmbedCard({titleLinkOnly: true})

    const embedWrapper = container.querySelector('[data-testid="embed-wrapper"]') as HTMLElement | null
    expect(embedWrapper?.dataset.openOnClick).toBe('false')

    const card = container.querySelector('[data-testid="document-card"]') as HTMLElement | null
    expect(card?.dataset.navigate).toBe('false')
    expect(card?.dataset.titleLinkOnly).toBe('true')
  })
})
