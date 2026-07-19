// @vitest-environment jsdom
import {TooltipProvider} from '@shm/ui/tooltip'
import {OmnibarUrl} from '@shm/ui/url-omnibar'
import {createRoot, Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function render(node: React.ReactNode) {
  act(() => {
    root.render(<TooltipProvider>{node}</TooltipProvider>)
  })
}

describe('OmnibarUrl', () => {
  it('shows the resting URL and reveals the copy URL on focus', () => {
    render(<OmnibarUrl restingUrl="ipfs://bafyCID" copyUrl="https://hyper.media/ipfs/bafyCID" />)
    const input = container.querySelector('input') as HTMLInputElement
    expect(input.value).toBe('ipfs://bafyCID')

    act(() => input.focus())
    expect(input.value).toBe('https://hyper.media/ipfs/bafyCID')

    // Reverts to the resting URL on blur.
    act(() => input.blur())
    expect(input.value).toBe('ipfs://bafyCID')
  })

  it('copies the copy URL (gateway link), not the resting ipfs:// URL', () => {
    const writeText = vi.fn()
    Object.assign(navigator, {clipboard: {writeText}})
    render(<OmnibarUrl restingUrl="ipfs://bafyCID" copyUrl="https://hyper.media/ipfs/bafyCID" />)
    const copy = container.querySelector('button[aria-label="Copy link"]') as HTMLButtonElement
    act(() => copy.click())
    expect(writeText).toHaveBeenCalledWith('https://hyper.media/ipfs/bafyCID')
  })

  it('falls back to the resting URL when no copyUrl is given', () => {
    const writeText = vi.fn()
    Object.assign(navigator, {clipboard: {writeText}})
    render(<OmnibarUrl restingUrl="ipfs://only" />)
    const copy = container.querySelector('button[aria-label="Copy link"]') as HTMLButtonElement
    act(() => copy.click())
    expect(writeText).toHaveBeenCalledWith('ipfs://only')
  })
})
