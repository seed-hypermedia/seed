// @vitest-environment jsdom
import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

const state = vi.hoisted(() => ({
  identity: {} as any,
  access: {} as any,
  resource: {} as any,
  update: vi.fn(),
  upload: vi.fn(),
}))
vi.mock('@/auth', () => ({useLocalKeyPair: () => state.identity}))
vi.mock('@/document-edit/use-web-can-edit', () => ({useWebCanEdit: () => state.access}))
vi.mock('@/models/site', () => ({
  useUpdateHomeDocument: () => ({
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
vi.mock('@/document-edit/web-image-upload', () => ({makeWebFileUpload: () => state.upload}))
vi.mock('@shm/shared', () => ({
  hmId: (uid: string) => ({uid, id: `hm://${uid}`, path: []}),
  useUniversalClient: () => ({}),
}))
vi.mock('@shm/shared/models/entity', () => ({useResource: () => state.resource}))
vi.mock('@shm/ui/toast', () => ({toast: {success: vi.fn()}}))
vi.mock('@shm/ui/get-file-url', () => ({useImageUrl: () => (url: string) => url}))
vi.mock('@shm/ui/universal-dialog', () => ({useAppDialog: vi.fn()}))
vi.mock('@shm/ui/components/dialog', () => ({
  DialogTitle: ({children}: any) => <h2>{children}</h2>,
  DialogDescription: ({children}: any) => <p>{children}</p>,
}))
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
import {WebSpaceSettingsDialog} from './web-space-settings'
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
let root: Root
let container: HTMLDivElement
function render() {
  act(() => root.render(<WebSpaceSettingsDialog input={{siteUid: 'owner'}} onClose={() => {}} />))
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
  const element = [...container.querySelectorAll('[role="tab"]')].find((element) => element.textContent === name)!
  await act(async () => {
    element.dispatchEvent(new MouseEvent('mousedown', {bubbles: true, button: 0}))
    ;(element as HTMLElement).focus()
    ;(element as HTMLElement).click()
  })
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
  state.identity = {id: 'device-key', delegatedAccountUid: 'owner', capabilityCid: 'delegation'}
  state.access = {canEdit: true, signingAccountId: 'owner'}
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
  it('saves the delegated owner identity while preserving publication and theme metadata', async () => {
    render()
    await input('space-settings-name', ' Updated ')
    await click('Save identity')
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
  it('uploads a picked logo before publishing its IPFS reference', async () => {
    render()
    await click('Pick image')
    await click('Save identity')
    expect(state.upload).toHaveBeenCalledWith(expect.any(File))
    expect(state.update).toHaveBeenCalledWith({
      metadata: expect.objectContaining({seedExperimentalLogo: 'ipfs://uploaded-cid', icon: 'ipfs://favicon'}),
    })
  })
  it('removes an image and surfaces publication failure without discarding edits', async () => {
    state.update.mockRejectedValue(new Error('Publishing failed'))
    render()
    await click('Remove space logo')
    await click('Save identity')
    expect(state.update).toHaveBeenCalledWith({metadata: expect.objectContaining({seedExperimentalLogo: ''})})
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Publishing failed')
    expect(container.textContent).not.toContain('Remove space logo')
  })
  it('preserves link IDs and metadata while reordering navigation and changing activity', async () => {
    render()
    await tab('Navigation')
    await click('Move link 2 up')
    const activity = container.querySelector('#space-show-activity') as HTMLElement
    await act(async () => activity.click())
    await click('Save navigation')
    expect(state.update).toHaveBeenCalledWith({
      metadata: expect.objectContaining({
        siteUrl: 'https://concurrent.example',
        showActivity: false,
        theme: {headerLayout: '', other: 'preserved'},
      }),
      navigation: [expect.objectContaining({id: 'second'}), expect.objectContaining({id: 'first'})],
    })
  })
  it('can remove all navigation and prevents unsafe link protocols', async () => {
    render()
    await tab('Navigation')
    await input('nav-url-first', 'javascript:alert(1)')
    expect(
      [...container.querySelectorAll('button')].find((button) => button.textContent === 'Save navigation')?.disabled,
    ).toBe(true)
    await click('Remove link 1')
    await click('Remove link 1')
    await click('Save navigation')
    expect(state.update).toHaveBeenCalledWith(expect.objectContaining({navigation: []}))
  })
  it('connects its domain tab to the existing owned-space hosting controls', async () => {
    render()
    await tab('Web Domain')
    expect(container.textContent).toContain('Hosting controls for owner')
  })
  it.each([
    [
      {canEdit: true, signingAccountId: 'writer'},
      {id: 'key', capabilityCid: 'writer-cap'},
    ],
    [{canEdit: false, signingAccountId: null}, null],
    [{canEdit: true, signingAccountId: 'owner'}, {id: 'key'}],
  ])('does not expose controls without an owner delegation', (access, identity) => {
    state.access = access
    state.identity = identity
    render()
    expect(container.textContent).toContain('Sign in as the space owner')
    expect(container.querySelector('input')).toBeNull()
    expect(container.querySelector('[role="tab"]')).toBeNull()
  })
  it('clears unsaved edits when the active delegation changes', async () => {
    render()
    await input('space-settings-name', 'Unsaved')
    state.identity = {...state.identity, capabilityCid: 'new-delegation'}
    render()
    expect((container.querySelector('#space-settings-name') as HTMLInputElement).value).toBe('Original')
  })
})
