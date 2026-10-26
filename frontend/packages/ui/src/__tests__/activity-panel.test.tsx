// @vitest-environment jsdom
import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {ActivityHeader} from '../activity-panel'
import {TooltipProvider} from '../tooltip'
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

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

function render(element: React.ReactElement) {
  act(() => root.render(<TooltipProvider>{element}</TooltipProvider>))
}

function tab(label: string) {
  return Array.from(container.querySelectorAll('[role="tab"]')).find((el) => el.textContent?.trim() === label)
}

describe('ActivityHeader', () => {
  it('treats a missing tab as All updates and switches to To you', () => {
    const onTabChange = vi.fn()
    render(<ActivityHeader tab={undefined} onTabChange={onTabChange} />)
    expect(tab('All updates')?.getAttribute('aria-selected')).toBe('true')
    expect(tab('To you')?.getAttribute('aria-selected')).toBe('false')
    act(() => tab('To you')!.dispatchEvent(new MouseEvent('click', {bubbles: true})))
    expect(onTabChange).toHaveBeenCalledWith('to-you')
  })

  it('offers Expand and Close in the side panel, and only Collapse on the full page', () => {
    render(<ActivityHeader tab="to-you" onTabChange={vi.fn()} onExpand={vi.fn()} onClose={vi.fn()} />)
    expect(container.querySelector('[aria-label="Expand Activity"]')).not.toBeNull()
    expect(container.querySelector('[aria-label="Close Activity"]')).not.toBeNull()
    expect(container.querySelector('[aria-label="Collapse Activity"]')).toBeNull()

    render(<ActivityHeader tab="to-you" onTabChange={vi.fn()} onCollapse={vi.fn()} />)
    expect(container.querySelector('[aria-label="Collapse Activity"]')).not.toBeNull()
    expect(container.querySelector('[aria-label="Expand Activity"]')).toBeNull()
    expect(container.querySelector('[aria-label="Close Activity"]')).toBeNull()
  })
})
