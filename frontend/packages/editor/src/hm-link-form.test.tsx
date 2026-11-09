// @vitest-environment jsdom
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

// Pass an empty object for search results.
vi.mock('@shm/shared/models/search', () => ({useSearch: () => ({data: undefined})}))
vi.mock('@shm/shared/models/entity', () => ({
  useResource: () => ({data: undefined}),
  useAccount: () => ({data: undefined}),
}))
vi.mock('@shm/ui/highlight-context', () => ({useHighlighter: () => () => ({})}))

import {HypermediaLinkForm, LinkTypeDropdown} from './hm-link-form'

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

describe('HypermediaLinkForm button alignment', () => {
  it('highlights a clicked alignment before the toolbar reports the new value', () => {
    const editor = {updateBlock: vi.fn(), hyperlinkToolbar: {updatePosition: vi.fn()}}

    act(() => {
      root.render(
        <HypermediaLinkForm
          editor={editor as any}
          id="button-1"
          url="https://example.com"
          text="Go"
          isHmLink={false}
          type="button"
          hasName
          updateLink={vi.fn()}
          resetLink={vi.fn()}
          toolbarProps={{alignment: 'flex-start'}}
        />,
      )
    })

    const center = container.querySelector('button[aria-label="Align center"]')
    if (!center) throw new Error('Alignment buttons not rendered')
    dispatchClick(center)

    expect(center.getAttribute('aria-pressed')).toBe('true')
    expect(container.querySelector('button[aria-label="Align left"]')?.getAttribute('aria-pressed')).toBe('false')
    expect(editor.updateBlock).toHaveBeenCalledWith('button-1', {props: {alignment: 'center'}})
  })
})
