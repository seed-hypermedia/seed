// @vitest-environment jsdom
import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {DocumentCreateButton} from '../document-create-button'
;(globalThis as typeof globalThis & {React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean}).React = React
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

if (typeof PointerEvent === 'undefined') {
  ;(globalThis as typeof globalThis & {PointerEvent: typeof MouseEvent}).PointerEvent = MouseEvent
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function openMenu() {
  const trigger = container.querySelector('[aria-label="Choose what to create"]') as HTMLElement
  act(() => {
    trigger.dispatchEvent(new PointerEvent('pointerdown', {bubbles: true, cancelable: true, button: 0, ctrlKey: false}))
  })
}

function menuItem(label: string) {
  return Array.from(document.querySelectorAll('[role="menuitem"]')).find(
    (item) => item.textContent?.trim() === label,
  ) as HTMLElement | undefined
}

describe('DocumentCreateButton', () => {
  it('renders both split controls disabled while resolving', () => {
    act(() => root.render(<DocumentCreateButton disabled onCreate={vi.fn()} onImport={vi.fn()} />))
    const buttons = container.querySelectorAll('button')
    expect(buttons).toHaveLength(2)
    expect(Array.from(buttons).every((button) => button.disabled)).toBe(true)
  })

  it('renders both actions inside one bordered, rounded button', () => {
    act(() => root.render(<DocumentCreateButton onCreate={vi.fn()} onImport={vi.fn()} />))

    const group = container.firstElementChild as HTMLDivElement
    expect(group.className).toContain('rounded-md')
    expect(group.className).toContain('border')
    expect(group.className).toContain('overflow-hidden')
    expect(container.querySelectorAll('button')[1]?.className).toContain('border-l')
    expect(container.querySelectorAll('button')[1]?.className).toContain('w-7')
  })

  it('sends a document request from the primary action', () => {
    const onCreate = vi.fn()
    act(() => root.render(<DocumentCreateButton onCreate={onCreate} onImport={vi.fn()} />))
    act(() => (container.querySelector('button') as HTMLButtonElement).click())
    expect(onCreate).toHaveBeenCalledWith('document')
  })

  it('omits Agent from the menu when agent creation is not wired', () => {
    act(() => root.render(<DocumentCreateButton onCreate={vi.fn()} onImport={vi.fn()} />))
    openMenu()
    expect(menuItem('Collection')).toBeDefined()
    expect(menuItem('Agent')).toBeUndefined()
  })

  it('offers Agent in the menu when agent creation is wired', () => {
    const onCreateAgent = vi.fn()
    act(() => root.render(<DocumentCreateButton onCreate={vi.fn()} onImport={vi.fn()} onCreateAgent={onCreateAgent} />))
    openMenu()
    act(() => menuItem('Agent')!.click())
    expect(onCreateAgent).toHaveBeenCalledTimes(1)
  })

  it('renders nothing when hidden', () => {
    act(() => root.render(<DocumentCreateButton hidden onCreate={vi.fn()} onImport={vi.fn()} />))
    expect(container.innerHTML).toBe('')
  })
})
