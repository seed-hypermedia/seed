// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {createElement, useState} from 'react'
import {createRoot} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {Group, Panel} from 'react-resizable-panels'
import {AnimatedPanel, PanelSeparator, transitionPanel} from '../resizable-panels'

let group: HTMLDivElement
let panel: HTMLDivElement
let separator: HTMLDivElement
let frames: FrameRequestCallback[]
let finish: () => void
let cancel: (() => void) | undefined

beforeEach(() => {
  group = document.createElement('div')
  panel = document.createElement('div')
  panel.setAttribute('data-panel', '')
  separator = document.createElement('div')
  separator.setAttribute('data-separator', '')
  group.append(panel, separator)
  document.body.append(group)
  frames = []
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    frames.push(callback)
    return frames.length
  })
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
  const finished = new Promise<void>((resolve) => {
    finish = resolve
  })
  group.getAnimations = () =>
    [{effect: {target: panel}, transitionProperty: 'flex-grow', finished}] as unknown as Animation[]
})
afterEach(() => {
  cancel?.()
  group.remove()
  vi.restoreAllMocks()
})
const flush = async () => {
  frames.splice(0).forEach((callback) => callback(0))
  await Promise.resolve()
  await Promise.resolve()
}

describe('programmatic panel transitions', () => {
  it('keeps closing content until the sizing transition finishes', async () => {
    let retained = true
    cancel = transitionPanel(
      group,
      () => {
        panel.style.flexGrow = '0'
      },
      () => {
        retained = false
      },
    )
    await flush()
    expect(retained).toBe(true)
    finish()
    await flush()
    expect(retained).toBe(false)
    expect(group.dataset.panelMotion).toBeUndefined()
  })
  it('ignores completion from an earlier toggle after reversal', async () => {
    let closed = false
    cancel = transitionPanel(
      group,
      () => {
        panel.style.flexGrow = '0'
      },
      () => {
        closed = true
      },
    )
    await flush()
    cancel = transitionPanel(
      group,
      () => {
        panel.style.flexGrow = '30'
      },
      () => {},
    )
    finish()
    await flush()
    expect(closed).toBe(false)
    expect(panel.style.flexGrow).toBe('30')
  })
  it('settles on pointer interruption before dragging starts', async () => {
    let settled = false
    cancel = transitionPanel(
      group,
      () => {},
      () => {
        settled = true
      },
    )
    separator.dispatchEvent(new MouseEvent('pointerdown', {bubbles: true}))
    expect(settled).toBe(true)
    expect(group.dataset.panelMotion).toBeUndefined()
  })
  it('settles unchanged sizes without waiting for an event that cannot occur', async () => {
    group.getAnimations = () => []
    let settled = false
    cancel = transitionPanel(
      group,
      () => {},
      () => {
        settled = true
      },
    )
    await flush()
    expect(settled).toBe(true)
  })
  it('cleans up on cancellation and ignores later animation completion', async () => {
    let count = 0
    cancel = transitionPanel(
      group,
      () => {},
      () => {
        count++
      },
    )
    await flush()
    cancel()
    finish()
    await flush()
    expect(count).toBe(1)
  })
})

describe('right-side panel keyboard close', () => {
  it('closes the controlled panel and removes focus from its separator on Enter', () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    )
    const root = createRoot(group)
    function Example() {
      const [open, setOpen] = useState(true)
      return createElement(
        Group,
        null,
        createElement(Panel, {id: 'main'}, 'Main'),
        createElement(PanelSeparator, {open, onCollapse: () => setOpen(false)}),
        createElement(AnimatedPanel, {id: 'right', open, defaultSize: '30%', minSize: '20%'}, createElement('input')),
      )
    }
    try {
      act(() => root.render(createElement(Example)))
      const handle = group.querySelector<HTMLElement>('[data-separator]')!
      handle.focus()
      act(() => {
        handle.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true, cancelable: true}))
      })
      expect(group.querySelector<HTMLElement>('#right')?.inert).toBe(true)
      expect(document.activeElement).not.toBe(handle)
    } finally {
      act(() => root.unmount())
      vi.unstubAllGlobals()
    }
  })
})
