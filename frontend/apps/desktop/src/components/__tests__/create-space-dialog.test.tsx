// @vitest-environment jsdom
import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

const state = vi.hoisted(() => ({
  selectedAccountId: null as string | null,
  home: {isLoading: false, data: undefined as {type: string} | undefined},
  homeTypes: {} as Record<string, string>,
  navigate: vi.fn(),
  writeDraft: vi.fn(),
  requireAccount: vi.fn(),
  openCreateAccount: vi.fn(),
}))

vi.mock('@/selected-account', () => ({useSelectedAccountId: () => state.selectedAccountId}))
vi.mock('@/utils/useNavigate', () => ({useNavigate: () => state.navigate}))
vi.mock('@/trpc', () => ({client: {drafts: {write: {mutate: state.writeDraft}}}}))
vi.mock('@/utils/file-upload', () => ({fileUpload: vi.fn()}))
vi.mock('@/models/entities', () => ({
  fetchResource: async (id: {uid: string}) => ({type: state.homeTypes[id.uid] ?? 'not-found'}),
}))
vi.mock('@shm/shared/models/entity', () => ({useResource: () => state.home}))
vi.mock('../desktop-intents', () => ({
  useDesktopAccountIntent: () => ({content: null, requireAccount: state.requireAccount}),
}))
vi.mock('../create-account', () => ({
  useCreateAccountDialog: () => ({open: state.openCreateAccount, content: null}),
}))
vi.mock('@shm/ui/create-space-form', () => ({
  CreateSpaceForm: ({onComplete}: {onComplete: (formState: unknown) => void}) => (
    <button onClick={() => onComplete({name: 'My space'})}>Create space</button>
  ),
}))
vi.mock('@shm/ui/create-space-platform', () => ({createSpaceMetadata: (formState: unknown) => formState}))

import {CreateSpaceFlow} from '../create-space-dialog'
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let container: HTMLDivElement
const onClose = vi.fn()

function render() {
  act(() => root.render(<CreateSpaceFlow onClose={onClose} />))
}

function button(label: string) {
  return Array.from(container.querySelectorAll('button')).find((b) => b.textContent === label)
}

async function click(label: string) {
  await act(async () => button(label)!.click())
}

beforeEach(() => {
  state.selectedAccountId = null
  state.home = {isLoading: false, data: undefined}
  state.homeTypes = {}
  state.navigate.mockReset()
  state.writeDraft.mockReset().mockResolvedValue(undefined)
  state.requireAccount.mockReset()
  state.openCreateAccount.mockReset()
  onClose.mockReset()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('CreateSpaceFlow', () => {
  it('shows the form without an identity and asks for one on submit, like the web page', async () => {
    state.requireAccount.mockImplementation((action: (uid: string) => Promise<void>) => action('new-account'))
    render()

    await click('Create space')

    expect(state.requireAccount).toHaveBeenCalledOnce()
    expect(state.writeDraft).toHaveBeenCalledWith(
      expect.objectContaining({editUid: 'new-account', editPath: [], metadata: {name: 'My space'}}),
    )
    expect(state.navigate).toHaveBeenCalledWith({key: 'document', id: expect.objectContaining({uid: 'new-account'})})
    expect(onClose).toHaveBeenCalled()
  })

  it('does not replace a space the identity signed in on submit already has', async () => {
    state.homeTypes = {'existing-account': 'document'}
    state.requireAccount.mockImplementation((action: (uid: string) => Promise<void>) => action('existing-account'))
    render()

    await click('Create space')

    expect(state.writeDraft).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('offers an account that already has a space its space or a different account', async () => {
    state.selectedAccountId = 'owner'
    state.home = {isLoading: false, data: {type: 'document'}}
    render()

    expect(container.textContent).toContain('You already have a space')
    expect(button('Create space')).toBeUndefined()

    await click('Use a different account')
    expect(state.openCreateAccount).toHaveBeenCalledOnce()

    await click('Go to your space')
    expect(state.navigate).toHaveBeenCalledWith({key: 'document', id: expect.objectContaining({uid: 'owner'})})
    expect(onClose).toHaveBeenCalled()
  })

  it('waits for the space check before showing the form to a signed-in account', () => {
    state.selectedAccountId = 'owner'
    state.home = {isLoading: true, data: undefined}
    render()

    expect(button('Create space')).toBeUndefined()
    expect(container.textContent).toContain('Checking for your space')
  })
})
