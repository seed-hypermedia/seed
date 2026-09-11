import {createRoot} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {MobileMentionsDialog} from './mobile-mentions-dialog'
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

describe('mobile mention viewport', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('resizes and repositions with the visible keyboard viewport', () => {
    const viewport = Object.assign(new EventTarget(), {height: 600, offsetTop: 0})
    vi.stubGlobal('visualViewport', viewport)
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    act(() =>
      root.render(
        <MobileMentionsDialog
          isOpen
          onClose={() => {}}
          onSelect={() => {}}
          mode="document"
          query=""
          onQuery={() => {}}
          results={[]}
          loading={false}
          error={false}
          onRetry={() => {}}
          onRestoreFocus={() => {}}
        />,
      ),
    )
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement
    expect(dialog.style.height).toBe('600px')
    act(() => {
      viewport.height = 320
      viewport.offsetTop = 40
      viewport.dispatchEvent(new Event('resize'))
    })
    expect(dialog.style.height).toBe('320px')
    expect(dialog.style.top).toBe('40px')
    act(() => root.unmount())
    container.remove()
  })
})
