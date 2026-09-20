// @vitest-environment jsdom
import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {UniversalAppProvider} from '@shm/shared/routing'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {DocumentCover, moveCoverPosition, normalizeCoverPosition} from '../document-cover'
;(globalThis as typeof globalThis & {React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean}).React = React
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
if (!('PointerEvent' in window)) (window as any).PointerEvent = MouseEvent
if (!HTMLElement.prototype.setPointerCapture) HTMLElement.prototype.setPointerCapture = () => {}
if (!HTMLElement.prototype.releasePointerCapture) HTMLElement.prototype.releasePointerCapture = () => {}

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

  it('lets editors choose a replacement cover image', async () => {
    const onChangeCover = vi.fn()
    renderCover(<DocumentCover cover="ipfs://cover-cid" onChangeCover={onChangeCover} />)

    const input = container.querySelector<HTMLInputElement>('input[aria-label="Choose replacement cover image"]')
    const file = new File(['cover'], 'cover.png', {type: 'image/png'})
    expect(input).not.toBeNull()

    Object.defineProperty(input, 'files', {
      value: [file],
      configurable: true,
    })

    await act(async () => {
      input?.dispatchEvent(new Event('change', {bubbles: true}))
      await Promise.resolve()
    })

    expect(onChangeCover).toHaveBeenCalledWith(file)
  })

  it('opens the file picker from the change cover button without canceling the click', () => {
    renderCover(<DocumentCover cover="ipfs://cover-cid" onChangeCover={vi.fn()} />)

    const changeButton = container.querySelector<HTMLButtonElement>('button[aria-label="Change document cover image"]')
    const input = container.querySelector<HTMLInputElement>('input[aria-label="Choose replacement cover image"]')
    const inputClick = vi.spyOn(input!, 'click').mockImplementation(() => {})
    const clickEvent = new MouseEvent('click', {bubbles: true, cancelable: true})

    act(() => {
      changeButton?.dispatchEvent(clickEvent)
    })

    expect(inputClick).toHaveBeenCalledOnce()
    expect(clickEvent.defaultPrevented).toBe(false)
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

describe('cover focal position', () => {
  it('normalizes invalid positions and clamps pointer movement to safe bounds', () => {
    expect(normalizeCoverPosition(undefined)).toEqual({x: 50, y: 50})
    expect(normalizeCoverPosition({x: -20, y: 130})).toEqual({x: 0, y: 100})
    expect(moveCoverPosition({x: 50, y: 50}, {x: 20, y: -30}, {x: 40, y: 60})).toEqual({x: 0, y: 100})
    expect(moveCoverPosition({x: 25, y: 75}, {x: 20, y: 20}, {x: 0, y: 0})).toEqual({x: 25, y: 75})
  })

  it('renders saved positioning and saves keyboard adjustments', () => {
    const onChangePosition = vi.fn()
    renderCover(
      <DocumentCover cover="ipfs://cover-cid" position={{x: 20, y: 70}} onChangePosition={onChangePosition} />,
    )
    const image = container.querySelector('img')!
    expect(image.style.objectPosition).toBe('20% 70%')

    const button = container.querySelector<HTMLButtonElement>('button[aria-label="Reposition document cover image"]')
    act(() => button?.dispatchEvent(new MouseEvent('click', {bubbles: true})))
    const repositioner = container.querySelector<HTMLElement>('[role="application"]')!
    expect(repositioner).not.toBeNull()
    expect(document.activeElement).toBe(repositioner)
    act(() => repositioner.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowRight', bubbles: true})))
    act(() => repositioner.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowUp', shiftKey: true, bubbles: true})))
    act(() => repositioner.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true})))

    expect(onChangePosition).toHaveBeenCalledWith({x: 21, y: 60})
    expect(container.querySelector('[role="application"]')).toBeNull()
  })

  it('drags the cover within image overflow and saves once', () => {
    const onChangePosition = vi.fn()
    renderCover(<DocumentCover cover="ipfs://cover-cid" onChangePosition={onChangePosition} />)
    const image = container.querySelector('img')!
    Object.defineProperties(image, {naturalWidth: {value: 1000}, naturalHeight: {value: 500}})
    const button = container.querySelector<HTMLButtonElement>('button[aria-label="Reposition document cover image"]')
    act(() => button?.dispatchEvent(new MouseEvent('click', {bubbles: true})))
    const repositioner = container.querySelector<HTMLElement>('[role="application"]')!
    repositioner.getBoundingClientRect = () => ({width: 500, height: 200}) as DOMRect

    act(() => {
      repositioner.dispatchEvent(
        new PointerEvent('pointerdown', {pointerId: 1, clientX: 100, clientY: 100, bubbles: true}),
      )
    })
    act(() => {
      repositioner.dispatchEvent(
        new PointerEvent('pointermove', {pointerId: 1, clientX: 100, clientY: 75, bubbles: true}),
      )
    })
    act(() => {
      repositioner.dispatchEvent(new PointerEvent('pointerup', {pointerId: 1, bubbles: true}))
    })
    const save = Array.from(container.querySelectorAll('button')).find(
      (candidate) => candidate.textContent?.includes('Save position'),
    )
    act(() => save?.dispatchEvent(new MouseEvent('click', {bubbles: true})))

    expect(onChangePosition).toHaveBeenCalledOnce()
    expect(onChangePosition).toHaveBeenCalledWith({x: 50, y: 100})
  })

  it('cancels repositioning without saving or changing the focal point', () => {
    const onChangePosition = vi.fn()
    renderCover(
      <DocumentCover cover="ipfs://cover-cid" position={{x: 35, y: 65}} onChangePosition={onChangePosition} />,
    )
    const button = container.querySelector<HTMLButtonElement>('button[aria-label="Reposition document cover image"]')
    act(() => button?.dispatchEvent(new MouseEvent('click', {bubbles: true})))
    const repositioner = container.querySelector<HTMLElement>('[role="application"]')!
    act(() => {
      repositioner.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowDown', bubbles: true}))
      repositioner.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}))
    })

    expect(onChangePosition).not.toHaveBeenCalled()
    expect(container.querySelector('img')!.style.objectPosition).toBe('35% 65%')
  })
})
