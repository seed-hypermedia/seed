import {act} from 'react-dom/test-utils'
import {createRoot} from 'react-dom/client'
import {expect, test, vi} from 'vitest'
import {useEffect} from 'react'

const mocks = vi.hoisted(() => ({process: vi.fn(), prepare: vi.fn(), crop: vi.fn(), upload: vi.fn(), save: vi.fn()}))
vi.mock('@/components/site-settings-agents', () => ({SpaceAgentsSettings: () => null}))
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
  useNavRoute: () => ({key: 'site-settings', id: {uid: 'test'}}),
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
import SiteSettings from './site-settings'
import {AVATAR_IMAGE_POLICY, COVER_IMAGE_POLICY} from '@shm/ui/image-processing'
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

test.each([
  [0, AVATAR_IMAGE_POLICY],
  [1, COVER_IMAGE_POLICY],
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
    expect(mocks.process).not.toHaveBeenCalled()

    // A second crop must block saving even when the form already has changes.
    await pick()
    expect(button('Save').disabled).toBe(true)
    await act(async () => button('Cancel').click())
    expect(button('Save').disabled).toBe(false)
    await act(async () => button('Save').click())
    expect(mocks.upload).toHaveBeenCalledWith(output, policy)
    expect(mocks.save).toHaveBeenCalledWith({
      metadata: expect.objectContaining(index === 0 ? {icon: 'ipfs://cropped-cid'} : {cover: 'ipfs://cropped-cid'}),
    })
  } finally {
    act(() => root.unmount())
    host.remove()
    vi.restoreAllMocks()
    vi.clearAllMocks()
  }
})
