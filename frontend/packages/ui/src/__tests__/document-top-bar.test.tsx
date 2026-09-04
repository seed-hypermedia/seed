// @vitest-environment jsdom
import {UniversalAppProvider} from '@shm/shared/routing'
import {hmId} from '@shm/shared/utils/entity-id-url'
import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
;(globalThis as typeof globalThis & {React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean}).React = React
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../tooltip', async () => {
  const React = await import('react')
  return {
    Tooltip: ({children}: {children: React.ReactNode}) => React.createElement(React.Fragment, null, children),
  }
})

vi.mock('@shm/shared/models/entity', () => ({
  useAccount: (uid: string) => ({data: {metadata: {name: uid}}}),
}))

vi.mock('@shm/shared/utils/navigation', () => ({
  useNavRoute: () => ({key: 'document'}),
}))

const fileBrowserControls = vi.hoisted(() => ({
  current: null as null | {
    collapsed: boolean
    setCollapsed: (collapsed: boolean) => void
    claimRevealButton: () => () => void
  },
}))

vi.mock('../site-file-browser-layout', () => ({
  useSiteFileBrowserControls: () => fileBrowserControls.current,
}))

import {DocumentTopBar} from '../document-top-bar'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  fileBrowserControls.current = null
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
})

function render(node: React.ReactNode) {
  act(() => {
    root.render(
      <UniversalAppProvider
        openRoute={vi.fn()}
        openUrl={vi.fn()}
        universalClient={{request: vi.fn(), publish: vi.fn()} as any}
      >
        {node}
      </UniversalAppProvider>,
    )
  })
}

describe('DocumentTopBar', () => {
  it('renders the location trail and the page actions', () => {
    render(
      <DocumentTopBar
        breadcrumbs={[
          {id: hmId('site'), metadata: {name: 'Home'}},
          {id: hmId('site', {path: ['doc']}), metadata: {name: 'Doc'}},
        ]}
        actions={<button type="button">Publish</button>}
        isMobile
      />,
    )

    expect(container.querySelector('nav[aria-label="Breadcrumb"]')).not.toBeNull()
    expect(container.querySelector('[data-document-top-bar]')?.className).toContain('z-40')
    expect(container.querySelector('[aria-current="page"]')?.textContent).toBe('Doc')
    expect(Array.from(container.querySelectorAll('button')).some((b) => b.textContent === 'Publish')).toBe(true)
  })

  it('renders document status beside breadcrumbs and before page actions', () => {
    render(
      <DocumentTopBar
        breadcrumbs={[{id: hmId('site'), metadata: {name: 'Site'}}]}
        status={<span>Private</span>}
        actions={<button type="button">Publish</button>}
      />,
    )

    const status = container.querySelector('[data-document-status]')
    const breadcrumbs = container.querySelector('nav[aria-label="Breadcrumb"]')
    expect(container.querySelector('[data-document-top-bar]')?.className).toContain('relative')
    expect(container.querySelector('[data-document-top-bar]')?.className).toContain('z-40')
    expect(status?.textContent).toBe('Private')
    expect(status?.parentElement?.contains(breadcrumbs)).toBe(true)
    expect(breadcrumbs?.className).not.toContain('flex-1')
    expect(status!.compareDocumentPosition(container.querySelector('button')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
  })

  it('renders a home document as its own single crumb', () => {
    render(<DocumentTopBar breadcrumbs={[{id: hmId('site'), metadata: {name: 'Site'}}]} isMobile />)

    expect(container.querySelector('nav[aria-label="Breadcrumb"]')).not.toBeNull()
    expect(container.querySelectorAll('a')).toHaveLength(0)
  })

  it('reveals the file browser and claims the reveal button while it is collapsed', () => {
    const setCollapsed = vi.fn()
    const release = vi.fn()
    const claimRevealButton = vi.fn(() => release)
    fileBrowserControls.current = {collapsed: true, setCollapsed, claimRevealButton}

    render(<DocumentTopBar breadcrumbs={[{id: hmId('site'), metadata: {name: 'Site'}}]} />)

    expect(claimRevealButton).toHaveBeenCalledOnce()
    const revealButton = container.querySelector<HTMLButtonElement>('button[aria-label="Open file browser"]')
    expect(revealButton).not.toBeNull()
    expect(revealButton?.querySelector('.lucide-file-search-2')).not.toBeNull()

    act(() => {
      revealButton?.dispatchEvent(new MouseEvent('click', {bubbles: true}))
    })
    expect(setCollapsed).toHaveBeenCalledWith(false)
  })

  it('omits the reveal button when the file browser is already visible', () => {
    fileBrowserControls.current = {collapsed: false, setCollapsed: vi.fn(), claimRevealButton: vi.fn(() => vi.fn())}

    render(<DocumentTopBar breadcrumbs={[{id: hmId('site'), metadata: {name: 'Site'}}]} />)

    expect(container.querySelector('button[aria-label="Open file browser"]')).toBeNull()
    expect(fileBrowserControls.current.claimRevealButton).not.toHaveBeenCalled()
  })
})
