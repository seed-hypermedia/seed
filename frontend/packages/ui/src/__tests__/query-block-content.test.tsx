// @vitest-environment jsdom
import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {QueryBlockContent} from '../query-block-content'
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

function renderQueryBlock(style: 'Card' | 'List') {
  act(() => {
    root.render(<QueryBlockContent items={[]} style={style} accountsMetadata={{}} isDiscovering />)
  })
}

describe('QueryBlockContent loading state', () => {
  it('shows a spinner while a list query block is loading', () => {
    renderQueryBlock('List')

    expect(container.textContent).toContain('Searching for documents…')
    expect(container.querySelector('.animate-spin')).toBeTruthy()
  })

  it('shows a spinner while a card query block is loading', () => {
    renderQueryBlock('Card')

    expect(container.textContent).toContain('Searching for documents…')
    expect(container.querySelector('.animate-spin')).toBeTruthy()
  })
})
