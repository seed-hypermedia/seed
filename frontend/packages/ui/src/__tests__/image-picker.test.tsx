// @vitest-environment jsdom
import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {ImagePickerPopover, type ImagePickerKind, type StockPhoto} from '../image-picker'
;(globalThis as typeof globalThis & {React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean}).React = React
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const photo: StockPhoto = {
  id: 417074,
  alt: 'Lake and mountain',
  width: 5184,
  height: 3456,
  color: '#6E7B87',
  photographer: 'Jane Doe',
  photographerUrl: 'https://www.pexels.com/@jane',
  pageUrl: 'https://www.pexels.com/photo/417074/',
  thumbUrl: 'https://images.pexels.com/thumb.jpeg',
  downloadUrl: 'https://images.pexels.com/full.jpeg',
}

let container: HTMLDivElement
let root: Root
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/hm/api/stock-photos')) return new Response(JSON.stringify({photos: [photo]}))
    return new Response('jpeg', {headers: {'Content-Type': 'image/jpeg'}})
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function Harness({kind, onFile}: {kind: ImagePickerKind; onFile: (file: File) => void}) {
  const [open, setOpen] = React.useState(true)
  return (
    <ImagePickerPopover kind={kind} open={open} onOpenChange={setOpen} onFile={onFile}>
      <button type="button">Open picker</button>
    </ImagePickerPopover>
  )
}

function renderPicker(kind: ImagePickerKind, onFile: (file: File) => void = vi.fn(), key?: string) {
  act(() => {
    root.render(<Harness key={key} kind={kind} onFile={onFile} />)
  })
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 400))
  })
}

function bodyButton(text: string) {
  return Array.from(document.body.querySelectorAll('button')).find((button) => button.textContent?.includes(text))
}

function click(element: Element | null | undefined) {
  act(() => {
    element?.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true}))
  })
}

describe('ImagePickerPopover', () => {
  it('shows featured photos and delivers the chosen one as a file', async () => {
    const onFile = vi.fn()
    renderPicker('cover', onFile)
    await flush()

    expect(String(fetchMock.mock.calls[0]![0])).toBe('https://hyper.media/hm/api/stock-photos')
    expect(document.body.textContent).toContain('Featured')
    expect(document.body.textContent).toContain('Pexels')

    const photoButton = document.body.querySelector('button[aria-label="Use photo: Lake and mountain"]')
    await act(async () => {
      photoButton?.dispatchEvent(new MouseEvent('click', {bubbles: true}))
    })
    await flush()

    expect(fetchMock).toHaveBeenCalledWith(photo.downloadUrl)
    const file = onFile.mock.calls[0]![0] as File
    expect(file.name).toBe('pexels-417074.jpg')
    expect(file.type).toBe('image/jpeg')
    expect(document.body.querySelector('[aria-label="Search photos"]')).toBeNull()
  })

  it('searches photos by keyword', async () => {
    renderPicker('cover')
    await flush()
    const input = document.body.querySelector<HTMLInputElement>('input[aria-label="Search photos"]')!

    act(() => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setValue.call(input, 'mountain')
      input.dispatchEvent(new Event('input', {bubbles: true}))
    })
    await flush()

    expect(String(fetchMock.mock.calls.at(-1)![0])).toBe('https://hyper.media/hm/api/stock-photos?q=mountain')
    expect(document.body.textContent).toContain('Results for “mountain”')
  })

  it('offers a retry instead of failing when photos cannot load', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    renderPicker('cover')
    await flush()

    expect(document.body.textContent).toContain('Could not load photos.')
    click(bodyButton('Try again'))
    await flush()

    expect(document.body.querySelector('button[aria-label="Use photo: Lake and mountain"]')).not.toBeNull()
  })

  it('opens on upload and skips the photo search when offline', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const onFile = vi.fn()
    renderPicker('cover', onFile)
    await flush()

    expect(fetchMock).not.toHaveBeenCalled()
    const input = document.body.querySelector<HTMLInputElement>('input[aria-label="Choose document cover image"]')!
    const file = new File(['cover'], 'cover.png', {type: 'image/png'})
    await act(async () => {
      Object.defineProperty(input, 'files', {value: [file], configurable: true})
      input.dispatchEvent(new Event('change', {bubbles: true}))
    })
    expect(onFile).toHaveBeenCalledWith(file)

    renderPicker('cover', vi.fn(), 'reopened')
    click(bodyButton('Search photos'))
    expect(document.body.textContent).toContain('Photo search needs an internet connection.')
  })

  it('finds emoji by English or Spanish name', async () => {
    renderPicker('icon')
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
    })
    await flush()
    const input = document.body.querySelector<HTMLInputElement>('input[aria-label="Search emoji"]')!

    act(() => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setValue.call(input, 'cafe')
      input.dispatchEvent(new Event('input', {bubbles: true}))
    })

    expect(document.body.querySelector('button[aria-label="hot beverage"]')).not.toBeNull()
    expect(document.body.querySelector('button[aria-label="seedling"]')).toBeNull()

    act(() => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setValue.call(input, 'planta joven')
      input.dispatchEvent(new Event('input', {bubbles: true}))
    })
    expect(document.body.querySelector('button[aria-label="seedling"]')).not.toBeNull()
  })
})
