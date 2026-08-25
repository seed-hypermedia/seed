// @vitest-environment jsdom
import type {HMDocumentInfo} from '@seed-hypermedia/client/hm-types'
import {hmId} from '@shm/shared'
import {act} from 'react-dom/test-utils'
import {createRoot, type Root} from 'react-dom/client'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {SpaceFileBrowser} from '../space-file-browser'
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const useDirectoryMock = vi.hoisted(() => vi.fn())
vi.mock('@shm/shared/models/entity', () => ({useDirectory: useDirectoryMock}))

let container: HTMLDivElement
let root: Root

function makeDoc(path: string[], name: string, visibility: 'PUBLIC' | 'PRIVATE' = 'PUBLIC') {
  return {id: hmId('space', {path}), path, metadata: {name}, visibility} as HMDocumentInfo
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.clearAllMocks()
})

describe('SpaceFileBrowser', () => {
  it('reveals the active document and marks private rows', () => {
    useDirectoryMock.mockReturnValue({
      data: [makeDoc(['guides'], 'Guides'), makeDoc(['guides', 'private'], 'Private guide', 'PRIVATE')],
      isLoading: false,
      isError: false,
    })

    act(() => {
      root.render(
        <SpaceFileBrowser
          spaceId={hmId('space')}
          activeDocumentId={hmId('space', {path: ['guides', 'private']})}
          onNavigate={vi.fn()}
        />,
      )
    })

    expect(container.textContent).toContain('Private guide')
    expect(container.querySelector('[data-slot="scroll-area"]')).toBeTruthy()
    expect(container.querySelector('[aria-label="Private document"]')).toBeTruthy()
    expect(container.querySelector('[aria-current="page"]')?.textContent).toContain('Private guide')
    const caretButton = container.querySelector('[aria-label="Collapse Guides"]')
    expect(caretButton?.className).toContain('size-6')
    expect(caretButton?.className).toContain('p-0')
    expect(caretButton?.className).not.toContain('min-w-8')
    const activeDocumentButton = container.querySelector('[aria-current="page"]')
    expect(activeDocumentButton?.className).toContain('h-6')
    expect(activeDocumentButton?.className).toContain('text-sm')
    expect(activeDocumentButton?.className).not.toContain('text-xs')
  })

  it('shows title matches as a flat list and navigates', () => {
    const install = makeDoc(['guides', 'install'], 'Install Seed')
    const onNavigate = vi.fn()
    const onPrefetch = vi.fn()
    useDirectoryMock.mockReturnValue({data: [makeDoc(['guides'], 'Guides'), install], isLoading: false, isError: false})

    act(() => {
      root.render(
        <SpaceFileBrowser
          spaceId={hmId('space')}
          activeDocumentId={null}
          onNavigate={onNavigate}
          onPrefetch={onPrefetch}
        />,
      )
    })
    const input = container.querySelector('input')!
    act(() => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setValue?.call(input, 'INSTALL')
      input.dispatchEvent(new Event('input', {bubbles: true}))
    })

    expect(container.textContent).not.toContain('Guides')
    const result = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Install Seed'),
    )!
    act(() => result.dispatchEvent(new MouseEvent('pointerover', {bubbles: true})))
    act(() => result.focus())
    expect(onPrefetch).toHaveBeenNthCalledWith(1, install.id)
    expect(onPrefetch).toHaveBeenNthCalledWith(2, install.id)
    act(() => result.click())
    expect(onNavigate).toHaveBeenCalledWith(install.id)
  })
})
