import React from 'react'
import {createRoot, Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {describe, expect, it, vi} from 'vitest'
import {hmId} from '@shm/shared/utils/entity-id-url'

const {deleteMutateAsyncMock, toastErrorMock, toastPromiseMock} = vi.hoisted(() => ({
  deleteMutateAsyncMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastPromiseMock: vi.fn(),
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
  useListSite: () => ({data: []}),
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
  it('closes and navigates immediately while the delete toast tracks progress', async () => {
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

    const deleteButton = findButtonExact(container, 'Delete Document')

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
        loading: 'Deleting document...',
        success: 'Successfully deleted document',
        error: expect.any(Function),
      }),
    )
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onSuccess).toHaveBeenCalledTimes(1)
    expect(toastErrorMock).not.toHaveBeenCalled()

    resolveDelete?.()
    await act(async () => {
      await deletePromise
    })

    cleanupRendered(root, container)
  })
})
