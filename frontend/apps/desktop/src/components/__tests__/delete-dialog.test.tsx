import React from 'react'
import {createRoot, Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {describe, expect, it, vi} from 'vitest'
import {hmId} from '@shm/shared/utils/entity-id-url'

const {deleteMutateAsyncMock, listSiteDataMock, toastErrorMock, toastPromiseMock, agentDeletion} = vi.hoisted(() => ({
  deleteMutateAsyncMock: vi.fn(),
  listSiteDataMock: [] as any[],
  toastErrorMock: vi.fn(),
  toastPromiseMock: vi.fn(),
  /** What the mounted-agent hook reports; a test flips `isAgent` to delete an agent's document. */
  agentDeletion: {isAgent: false, serverUrl: undefined as string | undefined, deleteAgent: vi.fn(async () => {})},
}))

vi.mock('@shm/ui/agents/delete-mounted-agent', () => ({
  useMountedAgentDeletion: () => agentDeletion,
}))

vi.mock('@/models/access-control', () => ({
  roleCanWrite: () => true,
  useSelectedAccountCapability: () => ({
    role: 'writer',
    accountUid: 'alice',
    capabilityId: 'cap-1',
  }),
}))

vi.mock('@/models/daemon', () => ({
  useDeleteKey: () => ({mutate: vi.fn()}),
}))

vi.mock('@/models/documents', () => ({
  useListSite: () => ({data: listSiteDataMock}),
}))

vi.mock('../../models/entities', () => ({
  useDeleteEntities: () => ({
    mutateAsync: deleteMutateAsyncMock,
  }),
}))

vi.mock('@shm/shared/models/entity', () => ({
  useResource: () => ({
    isLoading: false,
    data: {
      type: 'document',
      document: {
        metadata: {
          name: 'My Doc',
        },
      },
    },
  }),
}))

vi.mock('@shm/ui/toast', () => ({
  toast: {
    error: toastErrorMock,
    promise: toastPromiseMock,
  },
}))

import {DeleteDocumentDialog} from '../delete-dialog'
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

function renderDialog(props: React.ComponentProps<typeof DeleteDocumentDialog>) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)

  act(() => {
    root.render(<DeleteDocumentDialog {...props} />)
  })

  return {container, root}
}

function cleanupRendered(root: Root, container: HTMLDivElement) {
  act(() => {
    root.unmount()
  })
  container.remove()
}

function findButtonExact(container: HTMLDivElement, label: string) {
  return Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.trim() === label) as
    | HTMLButtonElement
    | undefined
}

describe('DeleteDocumentDialog', () => {
  it('closes and navigates after the delete completes while the delete toast tracks progress', async () => {
    let resolveDelete: (() => void) | undefined
    const deletePromise = new Promise<void>((resolve) => {
      resolveDelete = resolve
    })
    const onClose = vi.fn()
    const onSuccess = vi.fn()
    const id = hmId('alice', {path: ['my-doc']})

    deleteMutateAsyncMock.mockReset()
    toastErrorMock.mockReset()
    toastPromiseMock.mockReset()
    deleteMutateAsyncMock.mockReturnValue(deletePromise)

    const {container, root} = renderDialog({
      input: {id, onSuccess},
      onClose,
    })

    const deleteButton = findButtonExact(container, 'Delete document')

    await act(async () => {
      deleteButton?.dispatchEvent(new MouseEvent('click', {bubbles: true}))
      await Promise.resolve()
    })

    expect(deleteMutateAsyncMock).toHaveBeenCalledWith({
      ids: [id],
      signingAccountUid: 'alice',
      capabilityId: 'cap-1',
    })
    expect(toastPromiseMock).toHaveBeenCalledWith(
      deletePromise,
      expect.objectContaining({
        loading: 'Deleting document…',
        success: 'Successfully deleted document',
        error: expect.any(Function),
      }),
    )
    expect(onClose).not.toHaveBeenCalled()
    expect(onSuccess).not.toHaveBeenCalled()
    expect(toastErrorMock).not.toHaveBeenCalled()

    resolveDelete?.()
    await act(async () => {
      await deletePromise
    })

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onSuccess).toHaveBeenCalledTimes(1)

    cleanupRendered(root, container)
  })

  it("deletes a mounted agent's document as the agent: server first, then the document", async () => {
    const id = hmId('alice', {path: ['helper']})
    deleteMutateAsyncMock.mockReset()
    toastPromiseMock.mockReset()
    agentDeletion.deleteAgent.mockClear()
    const order: string[] = []
    agentDeletion.isAgent = true
    agentDeletion.deleteAgent.mockImplementation(async () => {
      order.push('agent')
    })
    deleteMutateAsyncMock.mockImplementation(async () => {
      order.push('document')
    })

    const {container, root} = renderDialog({input: {id}, onClose: vi.fn()})
    expect(findButtonExact(container, 'Delete document')).toBeUndefined()
    expect(container.textContent).toContain('its sessions, memory and triggers on its server')
    const deleteButton = findButtonExact(container, 'Delete agent')

    await act(async () => {
      deleteButton?.dispatchEvent(new MouseEvent('click', {bubbles: true}))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(order).toEqual(['agent', 'document'])
    expect(toastPromiseMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({loading: 'Deleting agent…', success: 'Successfully deleted agent'}),
    )
    agentDeletion.isAgent = false
    cleanupRendered(root, container)
  })

  it('includes every listed child document when deleting the home document', async () => {
    const deletePromise = Promise.resolve()
    const onClose = vi.fn()
    const id = {...hmId('alice'), path: null}

    listSiteDataMock.splice(
      0,
      listSiteDataMock.length,
      {
        id: hmId('alice', {path: ['child']}),
        path: ['child'],
        metadata: {name: 'Child'},
      },
      {
        id: hmId('alice', {path: ['child', 'grandchild']}),
        path: ['child', 'grandchild'],
        metadata: {name: 'Grandchild'},
      },
    )
    deleteMutateAsyncMock.mockReset()
    toastErrorMock.mockReset()
    toastPromiseMock.mockReset()
    deleteMutateAsyncMock.mockReturnValue(deletePromise)

    const {container, root} = renderDialog({
      input: {id},
      onClose,
    })

    const deleteButton = findButtonExact(container, 'Delete document')

    await act(async () => {
      deleteButton?.dispatchEvent(new MouseEvent('click', {bubbles: true}))
      await deletePromise
    })

    expect(deleteMutateAsyncMock).toHaveBeenCalledWith({
      ids: [id, hmId('alice', {path: ['child']}), hmId('alice', {path: ['child', 'grandchild']})],
      signingAccountUid: 'alice',
      capabilityId: 'cap-1',
    })

    cleanupRendered(root, container)
    listSiteDataMock.splice(0, listSiteDataMock.length)
  })
})

vi.mock('@shm/ui/document-deletion-references', () => ({DocumentDeletionReferences: () => null}))
