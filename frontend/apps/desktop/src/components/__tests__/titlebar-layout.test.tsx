import React from 'react'
import {createRoot, Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, describe, expect, it} from 'vitest'
import {TitlebarMainRow} from '../titlebar-layout'
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let container: HTMLDivElement | null = null

function renderLayout(props: {sidebarLocked: boolean; sidebarWidth?: string}) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)

  act(() => {
    root?.render(
      <TitlebarMainRow
        sidebarLocked={props.sidebarLocked}
        sidebarWidth={props.sidebarWidth}
        sidebarControl={<button type="button">sidebar toggle</button>}
        navigation={<button type="button">back</button>}
        omnibar={<input aria-label="omnibar" />}
        actions={<button type="button">account</button>}
      />,
    )
  })

  return container
}

afterEach(() => {
  if (root) {
    act(() => root?.unmount())
  }
  container?.remove()
  root = null
  container = null
})

describe('TitlebarMainRow', () => {
  it('sizes and right-aligns the sidebar region when the sidebar is locked', () => {
    const rendered = renderLayout({sidebarLocked: true, sidebarWidth: '284px'})

    const sidebarRegion = rendered.querySelector('[data-titlebar-sidebar-region]') as HTMLDivElement
    const navigationRegion = rendered.querySelector('[data-titlebar-navigation-region]') as HTMLDivElement
    const omnibarRegion = rendered.querySelector('[data-titlebar-omnibar-region]') as HTMLDivElement

    expect(sidebarRegion.style.width).toBe('284px')
    expect(sidebarRegion.className).toContain('justify-end')
    expect(sidebarRegion.contains(navigationRegion)).toBe(false)
    expect(navigationRegion.compareDocumentPosition(omnibarRegion) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('leaves the sidebar region unsized when the sidebar is closed', () => {
    const rendered = renderLayout({sidebarLocked: false, sidebarWidth: '284px'})

    const sidebarRegion = rendered.querySelector('[data-titlebar-sidebar-region]') as HTMLDivElement

    expect(sidebarRegion.style.width).toBe('')
    expect(sidebarRegion.className).toContain('justify-start')
    expect(sidebarRegion.className).toContain('pl-2')
  })
})
