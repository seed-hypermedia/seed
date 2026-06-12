// @vitest-environment jsdom
import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {OptionsDropdown, type MenuItemType} from '../options-dropdown'
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
  document.body.querySelectorAll('[data-slot="dropdown-menu-content"]').forEach((node) => node.remove())
})

function renderMenu(items: MenuItemType[], props: Partial<React.ComponentProps<typeof OptionsDropdown>> = {}) {
  act(() => {
    root.render(<OptionsDropdown menuItems={items} {...props} />)
  })
}

function openMenu() {
  const trigger = container.querySelector('[data-slot="dropdown-menu-trigger"]') as HTMLElement
  act(() => {
    trigger.dispatchEvent(new PointerEvent('pointerdown', {bubbles: true, cancelable: true, button: 0, ctrlKey: false}))
  })
}

function basicItem(overrides: Partial<MenuItemType> = {}): MenuItemType {
  return {
    key: 'item',
    label: 'Item',
    icon: <span data-testid="icon" />,
    onClick: vi.fn(),
    ...overrides,
  }
}

describe('OptionsDropdown shared action menu', () => {
  it('uses a provided custom trigger button', () => {
    renderMenu([basicItem()], {
      button: <button aria-label="Custom actions">Custom trigger</button>,
    })

    expect(container.querySelector('[aria-label="Custom actions"]')?.textContent).toBe('Custom trigger')
  })

  it('keeps hidden hover triggers visible while the dropdown is open', () => {
    renderMenu([basicItem()])

    expect(container.querySelector('[data-slot="dropdown-menu-trigger"]')?.className).toContain(
      'data-[state=open]:opacity-100',
    )
  })

  it('renders disabled items as disabled and does not invoke them', () => {
    const onClick = vi.fn()
    renderMenu([basicItem({label: 'Disabled item', disabled: true, onClick})])

    openMenu()
    const disabledItem = document.body.querySelector('[role="menuitem"][data-disabled]') as HTMLElement | null

    expect(disabledItem?.textContent).toContain('Disabled item')
    act(() => {
      disabledItem?.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true}))
    })
    expect(onClick).not.toHaveBeenCalled()
  })

  it('orders destructive items after non-destructive items with a separator', () => {
    renderMenu([
      basicItem({key: 'delete', label: 'Delete', variant: 'destructive'}),
      basicItem({key: 'open', label: 'Open'}),
    ])

    openMenu()
    const content = document.body.querySelector('[data-slot="dropdown-menu-content"]')
    const labels = Array.from(content?.querySelectorAll('[role="menuitem"]') ?? []).map((node) => node.textContent)

    expect(labels).toEqual(['Open', 'Delete'])
    expect(content?.querySelector('[data-slot="dropdown-menu-separator"]')).not.toBeNull()
  })
})

import {SidebarMenuAction, SidebarMenuItem} from '../components/sidebar'

describe('OptionsDropdown sidebar trigger integration', () => {
  it('opens when using SidebarMenuAction as the custom trigger', () => {
    renderMenu([basicItem({label: 'Sidebar Action'})], {
      side: 'right',
      align: 'start',
      button: (
        <SidebarMenuAction aria-label="Sidebar options" onClick={(event) => event.stopPropagation()}>
          Actions
        </SidebarMenuAction>
      ),
    })

    openMenu()

    expect(document.body.querySelector('[data-slot="dropdown-menu-content"]')?.textContent).toContain('Sidebar Action')
  })
})

describe('SidebarMenuAction ref integration', () => {
  it('forwards refs to its underlying button for Radix asChild positioning', () => {
    const ref = React.createRef<HTMLButtonElement>()

    act(() => {
      root.render(
        <SidebarMenuItem>
          <SidebarMenuAction ref={ref}>Actions</SidebarMenuAction>
        </SidebarMenuItem>,
      )
    })

    expect(ref.current?.tagName).toBe('BUTTON')
  })
})
