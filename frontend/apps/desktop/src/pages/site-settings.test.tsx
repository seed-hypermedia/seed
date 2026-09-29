import {act} from 'react-dom/test-utils'
import {createRoot} from 'react-dom/client'
import {expect, test, vi} from 'vitest'

const mocks = vi.hoisted(() => ({process: vi.fn()}))
vi.mock('@/components/site-settings-agents', () => ({SpaceAgentsSettings: () => null}))
vi.mock('@/components/site-settings-members', () => ({MembersSettings: () => null}))
vi.mock('@/components/site-settings-navigation', () => ({NavigationSettings: () => null}))
vi.mock('@/models/site', () => ({useUpdateHomeDocument: () => ({})}))
vi.mock('@/utils/file-upload', () => ({fileUpload: vi.fn()}))
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
}))
import SiteSettings from './site-settings'
import {AVATAR_IMAGE_POLICY, COVER_IMAGE_POLICY} from '@shm/ui/image-processing'
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

test('prepares logo and cover images before creating their previews', async () => {
  const host = document.createElement('div')
  const root = createRoot(host)
  const createURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:processed')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  const source = new File(['source'], 'photo.heic', {type: 'image/heic'})
  const output = new File(['output'], 'photo.webp', {type: 'image/webp'})
  let finish: (file: File) => void = () => {}
  mocks.process.mockImplementation(
    () =>
      new Promise<File>((resolve) => {
        finish = resolve
      }),
  )
  try {
    await act(async () => root.render(<SiteSettings />))
    const inputs = host.querySelectorAll<HTMLInputElement>('input[type=file]')
    expect(inputs).toHaveLength(2)
    for (const [index, policy] of Array.from([AVATAR_IMAGE_POLICY, COVER_IMAGE_POLICY].entries())) {
      await act(async () => {
        Object.defineProperty(inputs[index], 'files', {value: [source], configurable: true})
        inputs[index]!.dispatchEvent(new Event('change', {bubbles: true}))
      })
      const save = Array.from(host.querySelectorAll('button')).find((button) => button.textContent === 'Save')!
      expect(save.disabled).toBe(true)
      await act(async () => finish(output))
      expect(save.disabled).toBe(false)
      expect(mocks.process).toHaveBeenCalledWith(source, policy)
    }
    expect(createURL).toHaveBeenCalledWith(output)
    expect(createURL.mock.calls.every(([file]) => file === output)).toBe(true)
  } finally {
    act(() => root.unmount())
    vi.restoreAllMocks()
  }
})
