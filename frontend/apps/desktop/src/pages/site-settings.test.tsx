import {AVATAR_IMAGE_POLICY, CONTENT_IMAGE_POLICY, COVER_IMAGE_POLICY} from '@shm/ui/image-processing'
import {useEffect} from 'react'
import {createRoot} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {expect, test, vi} from 'vitest'
import SiteSettings from './site-settings'

const mocks = vi.hoisted(() => ({process: vi.fn(), prepare: vi.fn(), crop: vi.fn(), upload: vi.fn(), save: vi.fn()}))
vi.mock('@/components/site-settings-members', () => ({MembersSettings: () => null}))
vi.mock('@/components/site-settings-navigation', () => ({NavigationSettings: () => null}))
vi.mock('@/components/site-settings-web-domain', () => ({WebDomainSettings: () => null}))
vi.mock('@/models/site', () => ({useUpdateHomeDocument: () => ({mutateAsync: mocks.save})}))
vi.mock('@/utils/file-upload', () => ({fileUpload: mocks.upload}))
vi.mock('@/utils/useNavigate', () => ({useNavigate: () => vi.fn()}))
vi.mock('@shm/shared/models/capabilities', () => ({useIsSiteOwner: () => ({isSiteOwner: true})}))
vi.mock('@shm/shared/models/entity', () => ({
  useResource: () => ({data: {type: 'document', document: {metadata: {name: 'Test'}}}}),
}))
vi.mock('@shm/shared/utils/navigation', () => ({
  useNavRoute: () => ({key: 'site-settings', id: {uid: 'test', id: 'hm://test'}, tab: 'identity'}),
  useNavigationState: () => undefined,
  useNavigationDispatch: () => vi.fn(),
  findLastRouteInSpace: () => null,
}))
vi.mock('@shm/ui/image-processing', async (original) => ({
  ...(await original<typeof import('@shm/ui/image-processing')>()),
  processImage: mocks.process,
  prepareImageForCrop: mocks.prepare,
}))
vi.mock('@shm/ui/image-crop', () => ({cropImageFile: mocks.crop}))
vi.mock('react-easy-crop', () => ({
  default: ({onCropComplete}: any) => {
    useEffect(() => {
      onCropComplete({}, {x: 0, y: 0, width: 800, height: 800})
    }, [])
    return null
  },
}))
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

test.each([
  [1, AVATAR_IMAGE_POLICY],
  [2, COVER_IMAGE_POLICY],
])('keeps Save blocked until image %s is cropped, and preserves cancellation', async (index, policy) => {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:image')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  const source = new File(['source'], 'photo.heic', {type: 'image/heic'})
  const output = new File(['output'], 'photo.webp', {type: 'image/webp'})
  let prepare: (file: File) => void = () => {}
  let crop: (file: File) => void = () => {}
  mocks.prepare.mockImplementation(
    () =>
      new Promise<File>((resolve) => {
        prepare = resolve
      }),
  )
  mocks.crop.mockImplementation(
    () =>
      new Promise<File>((resolve) => {
        crop = resolve
      }),
  )
  mocks.upload.mockResolvedValue('cropped-cid')
  mocks.save.mockResolvedValue(undefined)
  const button = (label: string) =>
    Array.from(document.querySelectorAll('button')).find((item) => item.textContent === label)!
  try {
    await act(async () => root.render(<SiteSettings />))
    const input = host.querySelectorAll<HTMLInputElement>('input[type=file]')[index]!
    const pick = async () => {
      await act(async () => {
        Object.defineProperty(input, 'files', {value: [source], configurable: true})
        input.dispatchEvent(new Event('change', {bubbles: true}))
      })
    }
    await pick()
    expect(button('Save').disabled).toBe(true)
    expect(button('Apply').disabled).toBe(true)
    expect(mocks.process).not.toHaveBeenCalled()
    await act(async () => button('Cancel').click())
    expect(button('Save').disabled).toBe(true)
    expect(host.querySelector('img')).toBeNull()

    await pick()
    await act(async () => prepare(source))
    expect(button('Save').disabled).toBe(true)
    await act(async () => button('Apply').click())
    expect(button('Save').disabled).toBe(true)
    await act(async () => crop(output))
    expect(button('Save').disabled).toBe(false)
    expect(host.querySelector('img')?.src).toBe('blob:image')
    // A picked favicon also shows in the logo preview, in place of the generated icon.
    expect(host.querySelectorAll('img')).toHaveLength(index === 1 ? 2 : 1)
    expect(mocks.process).not.toHaveBeenCalled()

    // A second crop must block saving even when the form already has changes.
    await pick()
    expect(button('Save').disabled).toBe(true)
    await act(async () => button('Cancel').click())
    expect(button('Save').disabled).toBe(false)
    await act(async () => button('Save').click())
    expect(mocks.upload).toHaveBeenCalledWith(output, policy)
    expect(mocks.save).toHaveBeenCalledWith({
      metadata: expect.objectContaining(index === 1 ? {icon: 'ipfs://cropped-cid'} : {cover: 'ipfs://cropped-cid'}),
    })
  } finally {
    act(() => root.unmount())
    host.remove()
    vi.restoreAllMocks()
    vi.clearAllMocks()
  }
})

test('saves an uncropped space logo and previews it as the header shows it', async () => {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:logo')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  const source = new File(['source'], 'logo.png', {type: 'image/png'})
  const output = new File(['output'], 'logo.webp', {type: 'image/webp'})
  mocks.process.mockResolvedValue(output)
  mocks.upload.mockResolvedValue('logo-cid')
  mocks.save.mockResolvedValue(undefined)
  const button = (label: string) =>
    Array.from(document.querySelectorAll('button')).find((item) => item.textContent === label)!
  try {
    await act(async () => root.render(<SiteSettings />))
    // With no logo the preview shows what the header does: the space's icon and name.
    expect(host.querySelector('[data-jdenticon-value="hm://test"]')).not.toBeNull()
    expect(host.textContent).toContain('Test')
    const input = host.querySelectorAll<HTMLInputElement>('input[type=file]')[0]!
    await act(async () => {
      Object.defineProperty(input, 'files', {value: [source], configurable: true})
      input.dispatchEvent(new Event('change', {bubbles: true}))
    })
    expect(button('Apply')).toBeUndefined()
    expect(host.querySelector('img')?.style.objectFit).toBe('contain')
    expect(host.querySelector<HTMLImageElement>('img[alt="Space logo preview"]')?.src).toBe('blob:logo')
    expect(host.querySelector('[data-jdenticon-value]')).toBeNull()
    await act(async () => button('Save').click())
    expect(mocks.upload).toHaveBeenCalledWith(output, CONTENT_IMAGE_POLICY)
    expect(mocks.save).toHaveBeenCalledWith({
      metadata: expect.objectContaining({seedExperimentalLogo: 'ipfs://logo-cid'}),
    })
  } finally {
    act(() => root.unmount())
    host.remove()
    vi.restoreAllMocks()
    vi.clearAllMocks()
  }
})
