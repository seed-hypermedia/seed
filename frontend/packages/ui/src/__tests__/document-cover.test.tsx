// @vitest-environment jsdom
import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {UniversalAppProvider} from '@shm/shared/routing'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {DocumentCover} from '../document-cover'
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

function renderCover(node: React.ReactNode) {
  act(() => {
    root.render(
      <UniversalAppProvider
        openRoute={vi.fn()}
        openUrl={vi.fn()}
        universalClient={{request: vi.fn(), publish: vi.fn()} as any}
        ipfsFileUrl="https://files.example/ipfs"
      >
        {node}
      </UniversalAppProvider>,
    )
  })
}

describe('DocumentCover', () => {
  it('renders editor cover actions on the actual cover image', () => {
    const onRemove = vi.fn()
    const onChangeCover = vi.fn()
    renderCover(<DocumentCover cover="ipfs://cover-cid" onRemove={onRemove} onChangeCover={onChangeCover} />)

    const removeButton = container.querySelector<HTMLButtonElement>('button[aria-label="Remove document cover image"]')
    const changeButton = container.querySelector<HTMLButtonElement>('button[aria-label="Change document cover image"]')
    const downloadLink = container.querySelector<HTMLAnchorElement>('a[aria-label="Download document cover image"]')

    expect(removeButton).not.toBeNull()
    expect(changeButton).not.toBeNull()
    expect(downloadLink).not.toBeNull()
    expect(downloadLink?.getAttribute('download')).toBe('')

    act(() => {
      removeButton?.dispatchEvent(new MouseEvent('click', {bubbles: true}))
    })

    expect(onRemove).toHaveBeenCalledOnce()
  })

  it('lets editors choose a replacement cover image from the cover picker', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({photos: []}))),
    )
    const onChangeCover = vi.fn()
    renderCover(<DocumentCover cover="ipfs://cover-cid" onChangeCover={onChangeCover} />)

    act(() => {
      container
        .querySelector('button[aria-label="Change document cover image"]')
        ?.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true}))
    })
    act(() => {
      Array.from(document.body.querySelectorAll('[role="tab"]'))
        .find((tab) => tab.textContent === 'Upload')
        ?.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true}))
    })
    const input = document.body.querySelector<HTMLInputElement>('input[aria-label="Choose document cover image"]')!
    const file = new File(['cover'], 'cover.png', {type: 'image/png'})
    await act(async () => {
      Object.defineProperty(input, 'files', {value: [file], configurable: true})
      input.dispatchEvent(new Event('change', {bubbles: true}))
    })

    expect(onChangeCover).toHaveBeenCalledWith(file)
    vi.unstubAllGlobals()
  })

  it('keeps cover actions visible on mobile and hover-gated on desktop', () => {
    renderCover(<DocumentCover cover="ipfs://cover-cid" onRemove={vi.fn()} onChangeCover={vi.fn()} />)

    const controls = container.querySelector<HTMLElement>('[data-document-cover-controls]')
    expect(controls?.className).toContain('opacity-100')
    expect(controls?.className).toContain('md:opacity-0')
    expect(controls?.className).toContain('md:group-hover/cover:opacity-100')
  })

  it('positions cover actions in the top-right corner', () => {
    renderCover(<DocumentCover cover="ipfs://cover-cid" onRemove={vi.fn()} onChangeCover={vi.fn()} />)

    const controls = container.querySelector<HTMLElement>('[data-document-cover-controls]')
    expect(controls?.classList.contains('top-4')).toBe(true)
    expect(controls?.classList.contains('right-4')).toBe(true)
    expect(controls?.classList.contains('bottom-4')).toBe(false)
  })
})
