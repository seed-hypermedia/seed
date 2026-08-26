// @vitest-environment jsdom
import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {OptionsPanel} from '../options-panel'
import {TooltipProvider} from '../tooltip'
;(globalThis as typeof globalThis & {React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean}).React = React
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

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

function renderOptionsPanel(isHomeDoc: boolean) {
  act(() => {
    root.render(
      <TooltipProvider>
        <OptionsPanel
          draftId="draft-1"
          isHomeDoc={isHomeDoc}
          metadata={
            {
              name: isHomeDoc ? 'Home' : 'Document',
              summary: 'Summary',
              icon: 'ipfs://icon-cid',
              cover: 'ipfs://cover-cid',
              showActivity: true,
            } as any
          }
          onMetadata={vi.fn()}
          fileUpload={vi.fn()}
        />
      </TooltipProvider>,
    )
  })
}

describe('OptionsPanel document metadata fields', () => {
  it('offers the agents server field on the home document only, saving a trimmed URL on blur', () => {
    const onMetadata = vi.fn()
    act(() => {
      root.render(
        <TooltipProvider>
          <OptionsPanel draftId="draft" metadata={{name: 'Site'}} isHomeDoc onMetadata={onMetadata} />
        </TooltipProvider>,
      )
    })
    const input = container.querySelector('#agent-server-url') as HTMLInputElement
    expect(input).not.toBeNull()
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, '  https://agentic.example.com  ')
      input.dispatchEvent(new Event('input', {bubbles: true}))
    })
    act(() => {
      // React's onBlur listens to the bubbling focusout event.
      input.dispatchEvent(new FocusEvent('focusout', {bubbles: true}))
    })
    expect(onMetadata).toHaveBeenCalledWith({agentServerUrl: 'https://agentic.example.com'})

    act(() => {
      root.render(
        <TooltipProvider>
          <OptionsPanel draftId="draft" metadata={{name: 'Doc'}} isHomeDoc={false} onMetadata={onMetadata} />
        </TooltipProvider>,
      )
    })
    expect(container.querySelector('#agent-server-url')).toBeNull()
  })

  it('keeps home document title and icon controls but removes summary and cover controls', () => {
    renderOptionsPanel(true)

    expect(container.textContent).toContain('Name')
    expect(container.textContent).toContain('Icon')
    expect(container.textContent).toContain('Header Logo')
    expect(container.textContent).toContain('Header Layout')
    expect(container.textContent).not.toContain('Summary')
    expect(container.textContent).not.toContain('Cover Image')
    expect(container.textContent).not.toContain('Document Options')
  })

  it('removes title, icon, cover, and summary controls for regular documents', () => {
    renderOptionsPanel(false)

    expect(container.textContent).not.toContain('Name')
    expect(container.textContent).not.toContain('Icon')
    expect(container.textContent).not.toContain('Summary')
    expect(container.textContent).not.toContain('Cover Image')
    expect(container.textContent).toContain('Show Outline')
    expect(container.textContent).toContain('Enable Activity Tabs')
    expect(container.textContent).toContain('Content Width')
  })
})
