// @vitest-environment jsdom
import {act} from 'react-dom/test-utils'
import {createRoot, type Root} from 'react-dom/client'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {SidePanelSlotContent, useSidePanelSlot, type SidePanelEntry} from '../side-panel-slot'
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

type Key = 'a' | 'b'

let container: HTMLDivElement
let root: Root
let active: Key | null
let panels: Record<Key, SidePanelEntry>

function Probe() {
  active = useSidePanelSlot([
    ['a', panels.a],
    ['b', panels.b],
  ])
  return null
}

function render() {
  act(() => root.render(<Probe />))
}

beforeEach(() => {
  active = null
  panels = {
    a: {open: false, close: vi.fn()},
    b: {open: false, close: vi.fn()},
  }
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('useSidePanelSlot', () => {
  it('a later opening closes the panel that held the slot', () => {
    panels.a.open = true
    render()
    expect(active).toBe('a')

    panels.b.open = true
    render()
    expect(panels.a.close).toHaveBeenCalledTimes(1)
    expect(panels.b.close).not.toHaveBeenCalled()
  })

  it('a later opening closes the panel that held the slot, in the other direction', () => {
    panels.b.open = true
    render()

    panels.a.open = true
    render()
    expect(panels.b.close).toHaveBeenCalledTimes(1)
    expect(panels.a.close).not.toHaveBeenCalled()
  })

  it('two panels open at first render: the first in order wins and the other is closed', () => {
    panels.a.open = true
    panels.b.open = true
    render()
    expect(active).toBe('a')
    expect(panels.b.close).toHaveBeenCalledTimes(1)
    expect(panels.a.close).not.toHaveBeenCalled()
  })

  it('a restored panel appearing while another is open gives the slot up without closing it', () => {
    panels.a.open = true
    render()

    panels.b = {open: true, restored: true, close: vi.fn()}
    render()
    expect(panels.b.close).toHaveBeenCalledTimes(1)
    expect(panels.a.close).not.toHaveBeenCalled()
    expect(active).toBe('a')
  })

  it('a restored panel holding the slot gives it up to one that opens later', () => {
    panels.b = {open: true, restored: true, close: vi.fn()}
    render()
    expect(active).toBe('b')

    panels.a.open = true
    render()
    expect(panels.b.close).toHaveBeenCalledTimes(1)
    expect(active).toBe('a')
  })

  it('an async close does not bounce the panel that just opened', () => {
    // The "close" of `a` does not flip its open flag — like a route navigation that has
    // not committed yet — so the next render still sees both open.
    panels.a = {open: true, close: vi.fn()}
    render()

    panels.b.open = true
    render()
    expect(panels.a.close).toHaveBeenCalledTimes(1)

    render()
    render()
    expect(panels.b.close).not.toHaveBeenCalled()
    expect(panels.a.close).toHaveBeenCalledTimes(1)
  })

  it('returns the first open non-restored panel, else the first open panel, else null', () => {
    render()
    expect(active).toBeNull()

    panels.b = {open: true, restored: true, close: vi.fn()}
    render()
    expect(active).toBe('b')

    panels.a.open = true
    render()
    // `a` is open and not restored; it wins over the earlier restored `b` it just closed.
    expect(active).toBe('a')
  })
})

describe('SidePanelSlotContent', () => {
  function Content({active}: {active: 'a' | 'b' | null}) {
    return (
      <SidePanelSlotContent
        active={active}
        panels={{
          a: {render: () => <div data-testid="panel-a">A</div>},
          b: {keepMounted: true, render: () => <div data-testid="panel-b">B</div>},
        }}
      />
    )
  }

  it('keeps a keepMounted panel mounted and hidden across switches', () => {
    act(() => root.render(<Content active="b" />))
    const b = container.querySelector('[data-testid="panel-b"]')!
    expect(b).not.toBeNull()
    expect(b.closest('.hidden')).toBeNull()

    act(() => root.render(<Content active="a" />))
    expect(container.querySelector('[data-testid="panel-a"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="panel-b"]')).toBe(b)
    expect(b.closest('.hidden')).not.toBeNull()

    act(() => root.render(<Content active="b" />))
    expect(container.querySelector('[data-testid="panel-a"]')).toBeNull()
    expect(container.querySelector('[data-testid="panel-b"]')).toBe(b)
    expect(b.closest('.hidden')).toBeNull()
  })

  it('keeps showing the last panel while the slot is closed', () => {
    act(() => root.render(<Content active="a" />))
    act(() => root.render(<Content active={null} />))
    expect(container.querySelector('[data-testid="panel-a"]')).not.toBeNull()
  })
})
