// @vitest-environment jsdom
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

import {LinkTypeDropdown} from './hm-link-form'

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
  document.body.querySelectorAll('[data-testid="link-type-parent"]').forEach((node) => node.remove())
})

function dispatchMouseDown(element: Element) {
  act(() => {
    element.dispatchEvent(new MouseEvent('mousedown', {bubbles: true, cancelable: true}))
  })
}

function dispatchClick(element: Element) {
  act(() => {
    element.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true}))
  })
}

function getDropdownTrigger() {
  const trigger = container.querySelector('button[aria-haspopup="listbox"]')
  if (!trigger) throw new Error('Dropdown trigger not rendered')
  return trigger
}

function getPortalOption(label: string) {
  const option = Array.from(document.body.querySelectorAll('button')).find(
    (button) => button.textContent?.includes(label),
  )
  if (!option) throw new Error(`Option not rendered: ${label}`)
  return option
}

describe('LinkTypeDropdown', () => {
  it('opens without bubbling pointer events to a parent comment editor', () => {
    const onParentMouseDown = vi.fn()
    const onParentClick = vi.fn()

    act(() => {
      root.render(
        <div data-testid="link-type-parent" onMouseDown={onParentMouseDown} onClick={onParentClick}>
          <LinkTypeDropdown selected="embed" onSelect={vi.fn()} isHmLink />
        </div>,
      )
    })

    const trigger = getDropdownTrigger()
    dispatchMouseDown(trigger)
    dispatchClick(trigger)

    expect(onParentMouseDown).not.toHaveBeenCalled()
    expect(onParentClick).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('Card')
  })

  it('selects card and discussions embed types from the portal menu', () => {
    const onSelect = vi.fn()

    act(() => {
      root.render(<LinkTypeDropdown selected="embed" onSelect={onSelect} isHmLink />)
    })

    dispatchClick(getDropdownTrigger())
    dispatchMouseDown(getPortalOption('Card'))
    expect(onSelect).toHaveBeenCalledWith('card')

    dispatchClick(getDropdownTrigger())
    dispatchMouseDown(getPortalOption('Discussions Embed'))
    expect(onSelect).toHaveBeenCalledWith('comments')
  })
})
