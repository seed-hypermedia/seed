// @vitest-environment jsdom
import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {UniversalAppProvider} from '@shm/shared/routing'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {DocumentCard} from '../newspaper'
;(globalThis as typeof globalThis & {React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean}).React = React
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@shm/shared/models/interaction-summary', () => ({
  useInteractionSummary: () => ({data: null}),
}))

vi.mock('@shm/shared/utils/navigation', () => ({
  useNavigate: () => vi.fn(),
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

function renderDocumentCard({
  titleLinkOnly = true,
  parentClick = vi.fn(),
  openRoute = vi.fn(),
}: {
  titleLinkOnly?: boolean
  parentClick?: () => void
  openRoute?: ReturnType<typeof vi.fn>
} = {}) {
  const docId = hmId('uid-1', {path: ['doc']})
  const entity = {
    type: 'document',
    id: docId,
    document: {
      metadata: {name: 'Embedded document'},
      authors: [],
      content: [],
      version: 'version-1',
      visibility: 'PUBLIC',
    },
  } as any

  act(() => {
    root.render(
      <UniversalAppProvider
        openRoute={openRoute}
        openUrl={vi.fn()}
        universalClient={{request: vi.fn(), publish: vi.fn()} as any}
      >
        <div data-testid="parent" onClick={parentClick}>
          <DocumentCard
            data-testid="card"
            docId={docId}
            entity={entity}
            navigate={false}
            titleLinkOnly={titleLinkOnly}
          />
        </div>
      </UniversalAppProvider>,
    )
  })

  return {docId, openRoute, parentClick}
}

describe('DocumentCard title-only navigation', () => {
  it('does not navigate when the non-title card body is clicked', () => {
    const {openRoute} = renderDocumentCard()
    const card = container.querySelector('[data-testid="card"]') as HTMLElement

    act(() => {
      card.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true}))
    })

    expect(openRoute).not.toHaveBeenCalled()
  })

  it('navigates from the title link and stops propagation to the editor block', () => {
    const {docId, openRoute, parentClick} = renderDocumentCard()
    const titleLink = container.querySelector('a') as HTMLAnchorElement

    act(() => {
      titleLink.dispatchEvent(new MouseEvent('mousedown', {bubbles: true, cancelable: true}))
      titleLink.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true}))
    })

    expect(openRoute).toHaveBeenCalledWith({key: 'document', id: docId}, undefined)
    expect(parentClick).not.toHaveBeenCalled()
  })
})
