import React from 'react'
import {createRoot, Root} from 'react-dom/client'
;(globalThis as typeof globalThis & {React?: typeof React}).React = React
import {act} from 'react-dom/test-utils'
import {beforeEach, describe, expect, it, vi} from 'vitest'
import {hmId} from '@shm/shared/utils/entity-id-url'

const {createDraftMock, capabilityRoleMock, useResourceMock} = vi.hoisted(() => ({
  createDraftMock: vi.fn(async (_params?: unknown) => {}),
  capabilityRoleMock: {role: 'owner' as string | undefined},
  useResourceMock: vi.fn(),
}))

vi.mock('@/models/access-control', () => ({
  roleCanWrite: (role?: string) => role === 'owner' || role === 'writer',
  useSelectedAccountCapability: () => ({role: capabilityRoleMock.role}),
}))
vi.mock('@/models/daemon', () => ({useMyAccountIds: () => ({data: ['alice']})}))
vi.mock('@/models/documents', () => ({
  useCreateDraft: () => createDraftMock,
  useChildDrafts: () => [],
}))
vi.mock('@/models/experiments', () => ({useExperiments: () => ({data: {}})}))
vi.mock('@shm/shared/models/entity', () => ({useResource: (id: unknown) => useResourceMock(id)}))
vi.mock('@shm/shared/models/queries', () => ({queryQueryBlock: () => ({queryKey: ['noop'], enabled: false})}))
vi.mock('@shm/shared/routing', () => ({useUniversalClient: () => ({})}))
vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>()
  return {...actual, useQuery: () => ({data: undefined, isLoading: false})}
})
vi.mock('@shm/ui/toast', () => ({toast: {error: vi.fn(), success: vi.fn()}}))
vi.mock('../import-doc-button', () => ({
  useImportDialog: () => ({open: vi.fn(), content: null}),
  useImporting: () => ({content: null}),
}))

import {DesktopDocumentCreateButton} from '../create-doc-button'
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const docId = hmId('alice', {path: ['notes']})

async function renderButton() {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(<DesktopDocumentCreateButton locationId={docId} />)
  })
  // Let the creation machine's async resolution settle so the button becomes ready.
  await act(async () => {
    await Promise.resolve()
  })
  return {container, root}
}

function cleanup(root: Root, container: HTMLDivElement) {
  act(() => {
    root.unmount()
  })
  container.remove()
}

function pressNewShortcut(init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', {
    key: 'N',
    code: 'KeyN',
    metaKey: true,
    shiftKey: true,
    bubbles: true,
    cancelable: true,
    ...init,
  })
  act(() => {
    window.dispatchEvent(event)
  })
  return event
}

describe('DesktopDocumentCreateButton Cmd+Shift+N', () => {
  beforeEach(() => {
    createDraftMock.mockClear()
    capabilityRoleMock.role = 'owner'
    useResourceMock.mockReset()
    useResourceMock.mockImplementation(() => ({
      isLoading: false,
      data: {type: 'document', document: {content: [], metadata: {}}},
    }))
  })

  it('creates a document like the primary New button', async () => {
    const {container, root} = await renderButton()
    try {
      const newButton = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'New')
      expect(newButton?.disabled).toBe(false)

      const event = pressNewShortcut()
      await act(async () => {
        await Promise.resolve()
      })

      expect(event.defaultPrevented).toBe(true)
      expect(createDraftMock).toHaveBeenCalledTimes(1)
      expect(createDraftMock.mock.calls[0]?.[0]).toMatchObject({
        location: {locationUid: 'alice', locationPath: ['notes']},
      })
    } finally {
      cleanup(root, container)
    }
  })

  it('ignores the shortcut without Shift or when already handled', async () => {
    const {container, root} = await renderButton()
    try {
      pressNewShortcut({shiftKey: false})
      const handled = new KeyboardEvent('keydown', {
        key: 'N',
        code: 'KeyN',
        metaKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      })
      handled.preventDefault()
      act(() => {
        window.dispatchEvent(handled)
      })
      await act(async () => {
        await Promise.resolve()
      })
      expect(createDraftMock).not.toHaveBeenCalled()
    } finally {
      cleanup(root, container)
    }
  })

  it('does nothing when the button is not shown', async () => {
    capabilityRoleMock.role = undefined
    const {container, root} = await renderButton()
    try {
      expect(container.querySelector('button')).toBeNull()
      pressNewShortcut()
      await act(async () => {
        await Promise.resolve()
      })
      expect(createDraftMock).not.toHaveBeenCalled()
    } finally {
      cleanup(root, container)
    }
  })
})
