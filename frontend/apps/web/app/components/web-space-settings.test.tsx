// @vitest-environment jsdom
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

const state = vi.hoisted(() => ({
  identity: {} as any,
  identityLoaded: true,
  access: {} as any,
  resource: {} as any,
  update: vi.fn(),
  upload: vi.fn(),
  navigate: vi.fn(),
  toastError: vi.fn(),
}))
vi.mock('@shm/shared/utils/navigation', async (original) => ({
  ...(await original<typeof import('@shm/shared/utils/navigation')>()),
  useNavigate: () => state.navigate,
}))
vi.mock('@/auth', () => ({
  useLocalKeyPair: () => state.identity,
  useLocalKeyPairLoaded: () => state.identityLoaded,
}))
vi.mock('@/document-edit/use-web-can-edit', () => ({useWebCanEdit: () => state.access}))
vi.mock('@/models/site', () => ({
  useUpdateHomeDocument: () => ({
    isPending: false,
    mutateAsync: (input: any) =>
      state.update({
        metadata: input.updateMetadata({
          ...state.resource.data.document.metadata,
          siteUrl: 'https://concurrent.example',
        }),
        ...(input.navigation === undefined ? {} : {navigation: input.navigation}),
      }),
  }),
}))
vi.mock('@/document-edit/web-image-upload', () => ({
  makeWebFileUpload: (_client: unknown, policy: unknown) => (file: File) => state.upload(file, policy),
}))
vi.mock('@shm/shared', async (original) => ({
  ...(await original<typeof import('@shm/shared')>()),
  useUniversalClient: () => ({}),
}))
vi.mock('@shm/shared/models/entity', async (original) => ({
  ...(await original<typeof import('@shm/shared/models/entity')>()),
  useResource: () => state.resource,
}))
vi.mock('@shm/shared/models/query-client', () => ({
  getQueryClient: () => ({refetchQueries: vi.fn()}),
  invalidateQueries: vi.fn(),
}))
vi.mock('@shm/ui/toast', () => ({toast: {success: vi.fn(), error: state.toastError}}))
vi.mock('@shm/ui/get-file-url', () => ({useImageUrl: () => (url: string) => url}))
vi.mock('@shm/ui/universal-dialog', () => ({useAppDialog: vi.fn()}))
vi.mock('@shm/ui/image-form', () => ({
  ImageForm: ({url, onImageUpload}: any) => (
    <div>
      <span>{url}</span>
      <button type="button" onClick={() => onImageUpload(new File(['image'], 'logo.png'))}>
        Pick image
      </button>
    </div>
  ),
}))
vi.mock('./web-hosting', () => ({WebDomainSettings: ({siteId}: any) => <div>Hosting controls for {siteId.uid}</div>}))
import {TooltipProvider} from '@shm/ui/tooltip'
import {CONTENT_IMAGE_POLICY} from '@shm/ui/image-processing'
import {WebSpaceSettingsPage} from './web-space-settings'
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
const queryClient = new QueryClient({defaultOptions: {mutations: {retry: false}}})
let root: Root
let container: HTMLDivElement
let section: 'general' | 'identity' | 'navigation' | 'web-domain' | undefined
function render() {
  act(() =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <WebSpaceSettingsPage siteUid="owner" section={section} />
        </TooltipProvider>
      </QueryClientProvider>,
    ),
  )
}
async function click(label: string) {
  const button = [...container.querySelectorAll('button')].find(
    (button) => button.textContent === label || button.getAttribute('aria-label') === label,
  )
  expect(button, label).toBeTruthy()
  await act(async () => {
    button!.dispatchEvent(new MouseEvent('mousedown', {bubbles: true}))
    button!.click()
  })
}
async function tab(name: string) {
  const element = [...container.querySelectorAll('nav button')].find((element) => element.textContent === name)!
  await act(async () => (element as HTMLElement).click())
  const route = state.navigate.mock.lastCall![0]
  expect(route).toMatchObject({key: 'site-settings', id: {uid: 'owner'}})
  section = route.tab
  render()
}
async function input(id: string, value: string) {
  const element = container.querySelector(`#${id}`)!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value)
    element.dispatchEvent(new Event('input', {bubbles: true}))
  })
}
beforeEach(() => {
  vi.clearAllMocks()
  state.identityLoaded = true
  section = undefined
  state.identity = {id: 'device-key', delegatedAccountUid: 'owner', capabilityCid: 'delegation'}
  // An owner can manage their space even when the current site's editor scope excludes it.
  state.access = {canEdit: false, signingAccountId: 'owner'}
  state.resource = {
    data: {
      type: 'document',
      document: {
        metadata: {
          name: 'Original',
          siteUrl: 'https://example.com',
          icon: 'ipfs://favicon',
          seedExperimentalLogo: 'ipfs://old',
          theme: {headerLayout: '', other: 'preserved'},
        },
        detachedBlocks: {
          navigation: {
            children: [
              {block: {id: 'first', type: 'Link', text: 'First', link: 'https://first.test'}},
              {block: {id: 'second', type: 'Link', text: 'Second', link: 'https://second.test'}},
            ],
          },
        },
      },
    },
  }
  state.update.mockResolvedValue(undefined)
  state.upload.mockResolvedValue('uploaded-cid')
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  vi.stubGlobal('URL', URL)
  URL.createObjectURL = vi.fn(() => 'blob:preview')
  URL.revokeObjectURL = vi.fn()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

describe('web space settings', () => {
  it('opens on General, with the same tabs as desktop that web supports', () => {
    render()
    expect([...container.querySelectorAll('nav button')].map((item) => item.textContent)).toEqual([
      'Back to space',
      'General',
      'Identity',
      'Navigation',
      'Web Domain',
    ])
    expect(container.querySelector('nav [aria-current="page"]')?.textContent).toBe('General')
  })
  it('saves General settings through the delegated owner over the latest metadata', async () => {
    section = 'general'
    render()
    await act(async () => (container.querySelector('#space-document-browser') as HTMLElement).click())
    await click('Save')
    expect(state.update).toHaveBeenCalledWith({
      metadata: expect.objectContaining({showDocumentBrowser: false, siteUrl: 'https://concurrent.example'}),
    })
  })
  it('saves identity while preserving publication and theme metadata', async () => {
    section = 'identity'
    render()
    await input('space-settings-name', ' Updated ')
    await click('Save')
    expect(state.update).toHaveBeenCalledWith({
      metadata: expect.objectContaining({
        name: 'Updated',
        siteUrl: 'https://concurrent.example',
        icon: 'ipfs://favicon',
        seedExperimentalLogo: 'ipfs://old',
        theme: {headerLayout: '', other: 'preserved'},
      }),
    })
  })
  it('uploads a picked logo with the browser client before publishing its IPFS reference', async () => {
    section = 'identity'
    render()
    await click('Pick image')
    await click('Save')
    expect(state.upload).toHaveBeenCalledWith(expect.any(File), CONTENT_IMAGE_POLICY)
    expect(state.update).toHaveBeenCalledWith({
      metadata: expect.objectContaining({seedExperimentalLogo: 'ipfs://uploaded-cid', icon: 'ipfs://favicon'}),
    })
  })
  it('keeps edits and offers a retry when publishing fails', async () => {
    state.update.mockRejectedValue(new Error('Publishing failed'))
    section = 'identity'
    render()
    await input('space-settings-name', 'Updated')
    await click('Save')
    expect(state.toastError).toHaveBeenCalledWith(
      'Publishing failed',
      expect.objectContaining({action: expect.anything()}),
    )
    expect((container.querySelector('#space-settings-name') as HTMLInputElement).value).toBe('Updated')
  })
  it('shows published links by name and saves navigation through the delegated owner', async () => {
    section = 'navigation'
    render()
    expect(container.textContent).toContain('First')
    expect(container.textContent).not.toContain('https://first.test')
    await click('Remove First')
    await click('Save')
    expect(state.update).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          siteUrl: 'https://concurrent.example',
          theme: {headerLayout: '', other: 'preserved'},
        }),
        navigation: [expect.objectContaining({id: 'second'})],
      }),
    )
  })
  it('asks before a tab switch drops unsaved edits', async () => {
    section = 'identity'
    render()
    await input('space-settings-name', 'Unsaved')
    await click('Navigation')
    expect(state.navigate).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('You have unsaved changes')
  })
  it('puts the window back once the iOS keyboard closes, but not while it is open', () => {
    const viewport = Object.assign(new EventTarget(), {height: 400})
    vi.stubGlobal('visualViewport', viewport)
    const scrollTo = vi.fn()
    vi.stubGlobal('scrollTo', scrollTo)
    vi.stubGlobal('scrollY', 114)
    vi.stubGlobal('innerHeight', 800)
    render()

    viewport.dispatchEvent(new Event('resize'))
    expect(scrollTo).not.toHaveBeenCalled()

    viewport.height = 800
    viewport.dispatchEvent(new Event('resize'))
    expect(scrollTo).toHaveBeenCalledWith(0, 0)
  })
  it.each(['general', undefined] as const)('goes back to the space from section %s', async (current) => {
    section = current
    render()
    await click('Back to space')
    expect(state.navigate.mock.lastCall![0]).toMatchObject({key: 'document', id: {uid: 'owner'}})
  })
  it('connects its domain tab to the existing owned-space hosting controls', async () => {
    render()
    await tab('Web Domain')
    expect(container.textContent).toContain('Hosting controls for owner')
  })
  it.each([
    {id: 'key', delegatedAccountUid: 'writer', capabilityCid: 'writer-cap'},
    null,
    {id: 'owner'},
    {id: 'key', delegatedAccountUid: 'owner'},
  ])('does not expose controls without an owner delegation: %j', (identity) => {
    state.identity = identity
    render()
    expect(container.textContent).toContain('Sign in as the space owner')
    expect(container.querySelector('input')).toBeNull()
    expect(container.querySelector('[role="tab"]')).toBeNull()
  })
  it('waits for the browser identity before deciding ownership', () => {
    state.identity = null
    state.identityLoaded = false
    render()
    expect(container.querySelector('[role="status"]')?.getAttribute('aria-label')).toBe('Loading account')
    expect(container.textContent).not.toContain('Sign in as the space owner')
  })
  it('removes the owner controls when the account changes', () => {
    section = 'identity'
    render()
    expect(container.querySelector('input')).not.toBeNull()
    state.identity = {id: 'other-key', delegatedAccountUid: 'other', capabilityCid: 'other-cap'}
    render()
    expect(container.textContent).toContain('Sign in as the space owner')
    expect(container.querySelector('input')).toBeNull()
  })
  it('clears unsaved edits when the active delegation changes', async () => {
    section = 'identity'
    render()
    await input('space-settings-name', 'Unsaved')
    state.identity = {...state.identity, capabilityCid: 'new-delegation'}
    render()
    expect((container.querySelector('#space-settings-name') as HTMLInputElement).value).toBe('Original')
  })
})
