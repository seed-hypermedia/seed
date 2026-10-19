// @vitest-environment jsdom
import {useEffect} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, expect, test, vi} from 'vitest'

const processing = vi.hoisted(() => ({prepare: vi.fn(), crop: vi.fn()}))
vi.mock('../image-processing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../image-processing')>()),
  prepareImageForCrop: processing.prepare,
}))
vi.mock('../image-crop', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../image-crop')>()),
  cropImageFile: processing.crop,
}))
// jsdom cannot measure a crop viewport; report the selection a real cropper emits.
vi.mock('react-easy-crop', () => ({
  default: ({onCropComplete}: {onCropComplete: (a: unknown, b: unknown) => void}) => {
    useEffect(() => {
      onCropComplete({}, {x: 0, y: 0, width: 512, height: 512})
    }, [])
    return <div>Crop viewport</div>
  },
}))

import {AccountProfileForm} from '../components/account-profile-form'
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
let container: HTMLDivElement
let root: Root
const original = new File(['source'], 'avatar.jpg', {type: 'image/jpeg'})
const cropped = new File(['cropped'], 'avatar-crop.jpg', {type: 'image/jpeg'})

beforeEach(() => {
  processing.prepare.mockReset().mockImplementation(async (file) => file)
  processing.crop.mockReset().mockResolvedValue(cropped)
  vi.spyOn(URL, 'createObjectURL').mockImplementation((file) => `blob:${(file as File).name}`)
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.restoreAllMocks()
})

async function choose(file = original) {
  const input = container.querySelector<HTMLInputElement>('input[type=file]')!
  Object.defineProperty(input, 'files', {configurable: true, value: [file]})
  await act(async () => input.dispatchEvent(new Event('change', {bubbles: true})))
}
async function click(label: string) {
  const button = [...document.querySelectorAll('button')].find((button) => button.textContent === label)!
  expect(button).toBeTruthy()
  await act(async () => button.click())
}

test('submits only the confirmed crop and keeps the original resolution until confirmation', async () => {
  const onSubmit = vi.fn()
  await act(async () => root.render(<AccountProfileForm initialName="Ada" onSubmit={onSubmit} />))
  await choose()
  expect(processing.prepare).toHaveBeenCalledWith(original)
  expect(processing.crop).not.toHaveBeenCalled()
  await act(async () => container.querySelector('form')!.requestSubmit())
  expect(onSubmit).not.toHaveBeenCalled()
  await click('Apply')
  expect(processing.crop).toHaveBeenCalledWith(
    original,
    expect.anything(),
    expect.objectContaining({maxDimension: 512}),
  )
  expect(container.querySelector('img')?.getAttribute('src')).toBe('blob:avatar-crop.jpg')
  await act(async () => container.querySelector('form')!.requestSubmit())
  expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({imageFile: cropped}))
})

test('cancel keeps the existing avatar and does not submit the selected source', async () => {
  const onSubmit = vi.fn()
  await act(async () =>
    root.render(<AccountProfileForm initialName="Ada" initialImageUrl="/old.jpg" onSubmit={onSubmit} />),
  )
  await choose()
  await click('Cancel')
  expect(container.querySelector('img')?.getAttribute('src')).toBe('/old.jpg')
  await act(async () => container.querySelector('form')!.requestSubmit())
  expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({imageFile: undefined}))
  expect(processing.crop).not.toHaveBeenCalled()
})

test('shows preparation errors without allowing a crop export', async () => {
  processing.prepare.mockRejectedValue(new Error('Animated images cannot be cropped'))
  await act(async () => root.render(<AccountProfileForm initialName="Ada" onSubmit={vi.fn()} />))
  await choose()
  expect(document.body.textContent).toContain('Animated images cannot be cropped')
  expect(processing.crop).not.toHaveBeenCalled()
  const apply = [...document.querySelectorAll('button')].find((button) => button.textContent === 'Apply')!
  expect(apply.disabled).toBe(true)
})

test('ignores preparation and crop results after switching accounts', async () => {
  let finish!: (file: File) => void
  processing.crop.mockReturnValueOnce(
    new Promise<File>((resolve) => {
      finish = resolve
    }),
  )
  const onSubmit = vi.fn()
  await act(async () => root.render(<AccountProfileForm initialName="Ada" onSubmit={onSubmit} />))
  await choose()
  await click('Apply')
  await act(async () => root.render(<AccountProfileForm initialName="Grace" onSubmit={onSubmit} />))
  await act(async () => finish(cropped))
  await act(async () => container.querySelector('form')!.requestSubmit())
  expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({name: 'Grace', imageFile: undefined}))
  expect(container.querySelector('img')).toBeNull()
})

test('ignores a pending preview when a newer image is selected', async () => {
  let finish!: (file: File) => void
  processing.prepare.mockReturnValueOnce(
    new Promise<File>((resolve) => {
      finish = resolve
    }),
  )
  const newer = new File(['new'], 'new.jpg', {type: 'image/jpeg'})
  const onSubmit = vi.fn()
  await act(async () => root.render(<AccountProfileForm initialName="Ada" onSubmit={onSubmit} />))
  await choose()
  await choose(newer)
  await act(async () => finish(original))
  await click('Apply')
  expect(processing.crop).toHaveBeenCalledWith(newer, expect.anything(), expect.anything())
  expect(vi.mocked(URL.createObjectURL).mock.calls.some(([file]) => file === original)).toBe(false)
})
