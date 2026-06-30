// @vitest-environment jsdom
import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import type {HMDocumentInfo} from '@seed-hypermedia/client/hm-types'
import {DocumentActionsProvider} from '@shm/shared/document-actions-context'
import {UniversalAppProvider} from '@shm/shared/routing'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {DocumentListItem} from '../document-list-item'
;(globalThis as typeof globalThis & {React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean}).React = React
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

if (!('PointerEvent' in window)) {
  ;(window as any).PointerEvent = MouseEvent
}
if (!HTMLElement.prototype.hasPointerCapture) {
  HTMLElement.prototype.hasPointerCapture = () => false
}
if (!HTMLElement.prototype.setPointerCapture) {
  HTMLElement.prototype.setPointerCapture = () => {}
}
if (!HTMLElement.prototype.releasePointerCapture) {
  HTMLElement.prototype.releasePointerCapture = () => {}
}

vi.mock('@shm/shared/models/interaction-summary', () => ({
  useInteractionSummary: () => ({data: null}),
}))

vi.mock('@shm/shared/utils/navigation', () => ({
  useNavigate: () => vi.fn(),
}))

const copyUrlToClipboardWithFeedbackMock = vi.hoisted(() => vi.fn(async () => undefined))

vi.mock('../copy-to-clipboard', () => ({
  copyUrlToClipboardWithFeedback: copyUrlToClipboardWithFeedbackMock,
}))

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  window.history.pushState({}, '', 'http://localhost:3000/current')
  copyUrlToClipboardWithFeedbackMock.mockClear()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
  document.body.querySelectorAll('[data-slot="dropdown-menu-content"]').forEach((node) => node.remove())
})

function makeItem(name: string): HMDocumentInfo {
  const id = hmId('uid-1', {path: ['doc']})
  return {
    type: 'document',
    id,
    path: id.path,
    authors: ['uid-1'],
    createTime: '2024-01-01T00:00:00Z',
    updateTime: '2024-01-01T00:00:00Z',
    sortTime: new Date('2024-01-01T00:00:00Z'),
    genesis: 'genesis',
    version: 'version-1',
    metadata: {name},
    visibility: 'PUBLIC',
  } as HMDocumentInfo
}

function renderDocumentListItem(
  options: {
    getDraft?: (id: ReturnType<typeof hmId>) => any
    origin?: string | null
    onCopyLink?: () => void
  } = {},
) {
  const item = makeItem('Published title')
  act(() => {
    root.render(
      <UniversalAppProvider
        openRoute={vi.fn()}
        openUrl={vi.fn()}
        origin={options.origin}
        universalClient={{request: vi.fn()} as any}
      >
        <DocumentActionsProvider getDraft={options.getDraft} onCopyLink={options.onCopyLink}>
          <DocumentListItem item={item} />
        </DocumentActionsProvider>
      </UniversalAppProvider>,
    )
  })
}

describe('DocumentListItem draft metadata', () => {
  it('prefers the local draft title and shows draft state', () => {
    renderDocumentListItem({
      getDraft: () => ({
        id: 'draft-1',
        metadata: {name: 'Draft list title'},
      }),
    })

    expect(container.textContent).toContain('Draft list title')
    expect(container.textContent).not.toContain('Published title')
    expect(container.textContent).toContain('Draft')
  })
})

describe('DocumentListItem copy link', () => {
  it('uses the current browser origin for gateway links', async () => {
    renderDocumentListItem({
      origin: 'horaciohdev.dev.hyper.media',
      onCopyLink: () => {},
    })

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-slot="dropdown-menu-trigger"]')
        ?.dispatchEvent(new PointerEvent('pointerdown', {bubbles: true, cancelable: true, button: 0, ctrlKey: false}))
    })

    const copyLinkItem = Array.from(document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(
      (item) => item.textContent?.includes('Copy Link'),
    )
    expect(copyLinkItem).toBeDefined()

    await act(async () => {
      copyLinkItem?.click()
    })

    expect(copyUrlToClipboardWithFeedbackMock).toHaveBeenCalled()
    const copiedUrl = (copyUrlToClipboardWithFeedbackMock.mock.calls as any[])[0]?.[0]
    expect(copiedUrl).toMatch(/^http:\/\/localhost:3000\/hm\/uid-1\/doc/)
  })
})
