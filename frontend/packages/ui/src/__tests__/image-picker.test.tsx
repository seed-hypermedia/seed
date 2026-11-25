// @vitest-environment jsdom
import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {ImagePickerPopover, type ImagePickerKind} from '../image-picker'
import {AVATAR_IMAGE_POLICY, processImage} from '../image-processing'
;(globalThis as typeof globalThis & {React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean}).React = React
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  fetchMock = vi.fn(async () => {
    throw new Error('The picker must not fetch remote photos')
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function Harness({
  kind,
  onFile,
  onRemove,
}: {
  kind: ImagePickerKind
  onFile: (file: File) => void | Promise<void>
  onRemove?: () => void
}) {
  const [open, setOpen] = React.useState(true)
  return (
    <ImagePickerPopover kind={kind} open={open} onOpenChange={setOpen} onFile={onFile} onRemove={onRemove}>
      <button type="button">Open picker</button>
    </ImagePickerPopover>
  )
}

function renderPicker(
  kind: ImagePickerKind,
  onFile: (file: File) => void | Promise<void> = vi.fn(),
  onRemove?: () => void,
) {
  act(() => root.render(<Harness kind={kind} onFile={onFile} onRemove={onRemove} />))
}

function bodyButton(text: string) {
  return Array.from(document.body.querySelectorAll<HTMLButtonElement>('button')).find(
    (button) => button.textContent?.trim() === text,
  )
}

function click(element: Element | null | undefined) {
  act(() => {
    element?.dispatchEvent(new MouseEvent('mousedown', {bubbles: true, cancelable: true, button: 0}))
    element?.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true}))
  })
}

async function chooseFile(file: File) {
  const input = document.body.querySelector<HTMLInputElement>('input[type="file"]')!
  await act(async () => {
    Object.defineProperty(input, 'files', {value: [file], configurable: true})
    input.dispatchEvent(new Event('change', {bubbles: true}))
  })
}

async function waitForEmoji(label: string) {
  await act(async () => {
    await vi.waitFor(() => expect(document.body.querySelector(`button[aria-label="${label}"]`)).not.toBeNull())
  })
}

function searchEmoji(query: string) {
  const input = document.body.querySelector<HTMLInputElement>('input[aria-label="Search emoji"]')!
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, query)
    input.dispatchEvent(new Event('input', {bubbles: true}))
  })
}

describe('ImagePickerPopover', () => {
  it.each([true, false])('opens covers directly on upload without photo requests (online: %s)', async (online) => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(online)
    const onFile = vi.fn()
    renderPicker('cover', onFile)
    expect(document.body.querySelector('input[aria-label="Choose document cover image"]')).not.toBeNull()
    expect(document.body.querySelector('[role="tablist"]')).toBeNull()
    const file = new File(['cover'], 'cover.png', {type: 'image/png'})
    await chooseFile(file)
    expect(onFile).toHaveBeenCalledWith(file)
    expect(document.body.querySelector('[role="dialog"]')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('uploads an icon from the Upload tab', async () => {
    const onFile = vi.fn()
    renderPicker('icon', onFile)
    click(bodyButton('Upload'))
    const file = new File(['icon'], 'icon.png', {type: 'image/png'})
    await chooseFile(file)
    expect(onFile).toHaveBeenCalledWith(file)
    expect(document.body.querySelector('[role="dialog"]')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    ['cover.png', 'image/png'],
    ['cover.heic', ''],
  ])('accepts dropped %s images', async (name, type) => {
    const onFile = vi.fn()
    renderPicker('cover', onFile)
    click(bodyButton('Upload'))
    const file = new File(['cover'], name, {type})
    const dropzone = document.body.querySelector('input[type="file"]')!.closest('label')!
    await act(async () => {
      const drop = new Event('drop', {bubbles: true, cancelable: true})
      Object.defineProperty(drop, 'dataTransfer', {value: {files: [file]}})
      dropzone.dispatchEvent(drop)
    })
    expect(onFile).toHaveBeenCalledWith(file)
  })

  it('keeps the picker open after an upload failure and allows retry', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const onFile = vi.fn().mockRejectedValueOnce(new Error('Upload failed')).mockResolvedValueOnce(undefined)
    renderPicker('cover', onFile)
    click(bodyButton('Upload'))
    const file = new File(['cover'], 'cover.png', {type: 'image/png'})
    await chooseFile(file)
    expect(document.body.querySelector('[role="alert"]')?.textContent).toContain('Could not add this image')
    expect(document.body.querySelector<HTMLInputElement>('input[type="file"]')?.disabled).toBe(false)
    await chooseFile(file)
    expect(onFile).toHaveBeenCalledTimes(2)
    expect(document.body.querySelector('[role="dialog"]')).toBeNull()
  })

  it('disables removal and duplicate uploads while an image is being saved', async () => {
    let finish!: () => void
    const upload = new Promise<void>((resolve) => {
      finish = resolve
    })
    const onFile = vi.fn(() => upload)
    const onRemove = vi.fn()
    renderPicker('cover', onFile, onRemove)
    click(bodyButton('Upload'))
    const file = new File(['cover'], 'cover.png', {type: 'image/png'})
    await chooseFile(file)
    expect(bodyButton('Remove')?.disabled).toBe(true)
    expect(document.body.querySelector<HTMLInputElement>('input[type="file"]')?.disabled).toBe(true)
    click(bodyButton('Remove'))
    expect(onRemove).not.toHaveBeenCalled()
    await act(async () => {
      finish()
      await upload
    })
    expect(onFile).toHaveBeenCalledOnce()
    expect(document.body.querySelector('[role="dialog"]')).toBeNull()
  })

  it('removes the existing image and closes the picker', () => {
    const onRemove = vi.fn()
    renderPicker('icon', vi.fn(), onRemove)
    click(bodyButton('Remove'))
    expect(onRemove).toHaveBeenCalledOnce()
    expect(document.body.querySelector('[role="dialog"]')).toBeNull()
  })

  it('supports arrow-key navigation and associates each icon tab with its panel', async () => {
    renderPicker('icon')
    const emoji = bodyButton('Emoji')!
    const upload = bodyButton('Upload')!
    act(() => {
      emoji.focus()
      emoji.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowRight', bubbles: true, cancelable: true}))
    })
    await vi.waitFor(() => expect(document.activeElement).toBe(upload))
    act(() => upload.dispatchEvent(new FocusEvent('focusin', {bubbles: true})))
    const panel = document.getElementById(upload.getAttribute('aria-controls')!)
    expect(panel?.getAttribute('role')).toBe('tabpanel')
    expect(panel?.getAttribute('aria-labelledby')).toBe(upload.id)
    expect(document.body.querySelector('input[aria-label="Choose document icon"]')).not.toBeNull()
  })

  it('finds emoji by English or Spanish name', async () => {
    renderPicker('icon')
    await waitForEmoji('hot beverage')
    searchEmoji('cafe')
    expect(document.body.querySelector('button[aria-label="hot beverage"]')).not.toBeNull()
    expect(document.body.querySelector('button[aria-label="seedling"]')).toBeNull()
    searchEmoji('planta joven')
    expect(document.body.querySelector('button[aria-label="seedling"]')).not.toBeNull()
    searchEmoji('seedling')
    expect(document.body.querySelector('button[aria-label="seedling"]')).not.toBeNull()
  })

  it('converts a selected emoji to a PNG through the normal upload callback', async () => {
    // jsdom has no canvas renderer; stub only the browser drawing boundary.
    const context = {
      font: '',
      textAlign: '',
      textBaseline: '',
      measureText: vi.fn(() => ({actualBoundingBoxAscent: 180, actualBoundingBoxDescent: 20})),
      fillText: vi.fn(),
    }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as any)
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) =>
      callback(new Blob(['png'], {type: 'image/png'})),
    )
    const onFile = vi.fn()
    renderPicker('icon', onFile)
    await waitForEmoji('seedling')
    await act(async () => {
      document.body.querySelector<HTMLButtonElement>('button[aria-label="seedling"]')!.click()
    })
    const file = onFile.mock.calls[0]![0] as File
    expect(file.name).toBe('emoji-1f331.png')
    expect(file.type).toBe('image/png')
    expect(await processImage(file, AVATAR_IMAGE_POLICY)).toBe(file)
    expect(context.fillText).toHaveBeenCalled()
    expect(document.body.querySelector('[role="dialog"]')).toBeNull()
  })
})
