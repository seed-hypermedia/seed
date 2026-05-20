// @vitest-environment jsdom
import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {UniversalAppProvider} from '@shm/shared/routing'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
;(globalThis as typeof globalThis & {React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean}).React = React
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../tooltip', async () => {
  const React = await import('react')
  return {
    Tooltip: ({children}: {children: React.ReactNode}) => React.createElement(React.Fragment, null, children),
  }
})

import {Breadcrumbs, type BreadcrumbEntry} from '../document-header'

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

function renderBreadcrumbs(breadcrumbs: BreadcrumbEntry[], openRoute = vi.fn()) {
  act(() => {
    root.render(
      <UniversalAppProvider
        openRoute={openRoute}
        openUrl={vi.fn()}
        universalClient={{request: vi.fn(), publish: vi.fn()} as any}
      >
        <Breadcrumbs breadcrumbs={breadcrumbs} />
      </UniversalAppProvider>,
    )
  })
  return {openRoute}
}

describe('DocumentHeader Breadcrumbs', () => {
  it('links ancestor documents and renders the current document as aria-current text', () => {
    const homeId = hmId('site')
    const parentId = hmId('site', {path: ['parent']})
    const currentId = hmId('site', {path: ['parent', 'child']})
    const {openRoute} = renderBreadcrumbs([
      {id: homeId, metadata: {name: 'Home'}},
      {id: parentId, metadata: {name: 'Parent'}},
      {id: currentId, metadata: {name: 'Child'}},
    ])

    const parentLink = Array.from(container.querySelectorAll('a')).find((link) => link.textContent === 'Parent')
    expect(parentLink).toBeTruthy()
    expect(Array.from(container.querySelectorAll('a')).some((link) => link.textContent === 'Child')).toBe(false)
    expect(container.querySelector('[aria-current="page"]')?.textContent).toBe('Child')

    act(() => {
      parentLink?.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true}))
    })

    expect(openRoute).toHaveBeenCalledWith({key: 'document', id: parentId}, undefined)
  })

  it('links draft ancestor breadcrumbs to the draft route', () => {
    const homeId = hmId('site')
    const draftSectionId = hmId('site', {path: ['-draft-1']})
    const {openRoute} = renderBreadcrumbs([
      {id: homeId, metadata: {name: 'Home'}},
      {
        id: draftSectionId,
        metadata: {name: 'Draft Section'},
        draftId: 'draft-1',
        isUnpublishedDraft: true,
      },
      {label: 'Comments'},
    ])

    const draftLink = Array.from(container.querySelectorAll('a')).find((link) => link.textContent === 'Draft Section')
    expect(draftLink).toBeTruthy()

    act(() => {
      draftLink?.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true}))
    })

    expect(openRoute).toHaveBeenCalledWith({key: 'draft', id: 'draft-1'}, undefined)
  })

  it('does not link the current draft breadcrumb', () => {
    const homeId = hmId('site')
    const draftSectionId = hmId('site', {path: ['-draft-1']})
    renderBreadcrumbs([
      {id: homeId, metadata: {name: 'Home'}},
      {
        id: draftSectionId,
        metadata: {name: 'Draft Section'},
        draftId: 'draft-1',
        isUnpublishedDraft: true,
      },
    ])

    expect(Array.from(container.querySelectorAll('a')).some((link) => link.textContent === 'Draft Section')).toBe(false)
    expect(container.querySelector('[aria-current="page"]')?.textContent).toBe('Draft Section')
  })

  it('does not show the path fallback while a breadcrumb title is loading', () => {
    const homeId = hmId('site')
    const loadingId = hmId('site', {path: ['path-slug']})
    renderBreadcrumbs([
      {id: homeId, metadata: {name: 'Home'}},
      {id: loadingId, metadata: {}, fallbackName: 'path-slug', isLoading: true},
      {label: 'Current'},
    ])

    expect(container.textContent).toContain('Loading…')
    expect(container.textContent).not.toContain('path-slug')
  })

  it('uses the path fallback only after the loaded title is empty', () => {
    const homeId = hmId('site')
    const untitledId = hmId('site', {path: ['path-slug']})
    renderBreadcrumbs([
      {id: homeId, metadata: {name: 'Home'}},
      {id: untitledId, metadata: {}, fallbackName: 'path-slug'},
      {label: 'Current'},
    ])

    expect(container.textContent).toContain('path-slug')
    expect(container.textContent).not.toContain('Loading…')
  })
})
