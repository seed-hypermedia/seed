// @vitest-environment jsdom
import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {DocumentCreateButton} from '../document-create-button'
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
  act(() => root.unmount())
  container.remove()
})

describe('DocumentCreateButton', () => {
  it('renders both split controls disabled while resolving', () => {
    act(() => root.render(<DocumentCreateButton disabled onCreate={vi.fn()} onImport={vi.fn()} />))
    const buttons = container.querySelectorAll('button')
    expect(buttons).toHaveLength(2)
    expect(Array.from(buttons).every((button) => button.disabled)).toBe(true)
  })

  it('sends a document request from the primary action', () => {
    const onCreate = vi.fn()
    act(() => root.render(<DocumentCreateButton onCreate={onCreate} onImport={vi.fn()} />))
    act(() => (container.querySelector('button') as HTMLButtonElement).click())
    expect(onCreate).toHaveBeenCalledWith('document')
  })

  it('renders nothing when hidden', () => {
    act(() => root.render(<DocumentCreateButton hidden onCreate={vi.fn()} onImport={vi.fn()} />))
    expect(container.innerHTML).toBe('')
  })
})
