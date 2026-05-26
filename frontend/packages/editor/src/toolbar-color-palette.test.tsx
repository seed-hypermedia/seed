// @vitest-environment jsdom
import {TooltipProvider} from '@shm/ui/tooltip'
import {ReactNode} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

import {HighlightPalette, TextColorPalette} from './toolbar-color-palette'

function withProviders(node: ReactNode) {
  return <TooltipProvider>{node}</TooltipProvider>
}

function makeEditor() {
  return {
    addStyles: vi.fn(),
    removeStyles: vi.fn(),
    focus: vi.fn(),
  } as any
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
})

function click(testId: string) {
  const el = container.querySelector<HTMLElement>(`[data-testid="${testId}"]`)
  if (!el) throw new Error(`Element with testid="${testId}" not found`)
  act(() => {
    el.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true}))
  })
}

describe('TextColorPalette', () => {
  it('applies a named color via addStyles', () => {
    const editor = makeEditor()
    act(() => {
      root.render(withProviders(<TextColorPalette editor={editor} current="default" />))
    })
    click('text-color-red')
    expect(editor.addStyles).toHaveBeenCalledWith({textColor: 'red'})
    expect(editor.removeStyles).not.toHaveBeenCalled()
  })

  it('clears color via removeStyles when selecting default', () => {
    const editor = makeEditor()
    act(() => {
      root.render(withProviders(<TextColorPalette editor={editor} current="red" />))
    })
    click('text-color-default')
    expect(editor.removeStyles).toHaveBeenCalledWith({textColor: true})
    expect(editor.addStyles).not.toHaveBeenCalled()
  })

  it('calls onSelect after applying a color', () => {
    const editor = makeEditor()
    const onSelect = vi.fn()
    act(() => {
      root.render(withProviders(<TextColorPalette editor={editor} current="default" onSelect={onSelect} />))
    })
    click('text-color-blue')
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('applies a Tailwind-only accent (amber) that did not exist in the old palette', () => {
    const editor = makeEditor()
    act(() => {
      root.render(withProviders(<TextColorPalette editor={editor} current="default" />))
    })
    click('text-color-amber')
    expect(editor.addStyles).toHaveBeenCalledWith({textColor: 'amber'})
  })
})

describe('HighlightPalette', () => {
  it('applies a Tailwind-only accent (emerald)', () => {
    const editor = makeEditor()
    act(() => {
      root.render(withProviders(<HighlightPalette editor={editor} current="default" />))
    })
    click('highlight-emerald')
    expect(editor.addStyles).toHaveBeenCalledWith({backgroundColor: 'emerald'})
  })

  it('applies a named background color via addStyles', () => {
    const editor = makeEditor()
    act(() => {
      root.render(withProviders(<HighlightPalette editor={editor} current="default" />))
    })
    click('highlight-yellow')
    expect(editor.addStyles).toHaveBeenCalledWith({backgroundColor: 'yellow'})
  })

  it('clears highlight via removeStyles when selecting default', () => {
    const editor = makeEditor()
    act(() => {
      root.render(withProviders(<HighlightPalette editor={editor} current="yellow" />))
    })
    click('highlight-default')
    expect(editor.removeStyles).toHaveBeenCalledWith({backgroundColor: true})
  })
})
