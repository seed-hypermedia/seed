import React from 'react'
import {createRoot, Root} from 'react-dom/client'
;(globalThis as typeof globalThis & {React?: typeof React}).React = React
import {act} from 'react-dom/test-utils'
import {beforeEach, describe, expect, it, vi} from 'vitest'
import {hmId} from '@shm/shared/utils/entity-id-url'

const {
  moveDraftMutateAsyncMock,
  moveMutateAsyncMock,
  navigateMock,
  republishMutateAsyncMock,
  selectedAccountMock,
  useDirectoryMock,
  useResourceMock,
  useResourcesMock,
  writableDocumentsMock,
} = vi.hoisted(() => ({
  moveDraftMutateAsyncMock: vi.fn(),
  moveMutateAsyncMock: vi.fn(),
  navigateMock: vi.fn(),
  republishMutateAsyncMock: vi.fn(),
  selectedAccountMock: {id: {uid: 'alice'}},
  useDirectoryMock: vi.fn(),
  useResourceMock: vi.fn(),
  useResourcesMock: vi.fn(),
  writableDocumentsMock: [] as any[],
}))

vi.mock('@/models/access-control', () => ({
  useSelectedAccountWritableDocuments: () => writableDocumentsMock,
}))

vi.mock('@/models/documents', () => ({
  useMoveDocument: () => ({mutateAsync: moveMutateAsyncMock, isLoading: false}),
  useMoveDraft: () => ({mutateAsync: moveDraftMutateAsyncMock, isLoading: false}),
  useRepublishDocument: () => ({mutateAsync: republishMutateAsyncMock, isLoading: false}),
}))

vi.mock('@/models/gateway-settings', () => ({
  useGatewayUrl: () => ({data: 'https://gateway.test'}),
}))

vi.mock('@/selected-account', () => ({
  useSelectedAccount: () => selectedAccountMock,
}))

vi.mock('@/utils/useNavigate', () => ({
  useNavigate: () => navigateMock,
}))

vi.mock('@shm/shared', async () => {
  const actual = await vi.importActual<typeof import('@shm/shared')>('@shm/shared')
  return {
    ...actual,
    useSearch: () => ({data: {entities: []}, isLoading: false}),
  }
})

vi.mock('@shm/shared/models/entity', () => ({
  useDirectory: useDirectoryMock,
  useResource: useResourceMock,
  useResources: useResourcesMock,
}))

vi.mock('@shm/ui/components/dialog', () => ({
  DialogTitle: ({children, className}: {children: React.ReactNode; className?: string}) => (
    <h2 className={className}>{children}</h2>
  ),
}))

vi.mock('@shm/ui/components/scroll-area', () => ({
  ScrollArea: ({children, className}: {children: React.ReactNode; className?: string}) => (
    <div className={className}>{children}</div>
  ),
}))

vi.mock('@shm/ui/hm-icon', () => ({
  HMIcon: () => null,
}))

vi.mock('@shm/ui/tooltip', async () => {
  const React = await import('react')
  return {
    Tooltip: ({children}: {children: React.ReactNode}) => React.createElement(React.Fragment, null, children),
  }
})

vi.mock('@shm/ui/toast', () => ({
  toast: {success: vi.fn(), error: vi.fn()},
}))

import {DocumentDestinationDialog} from '../document-destination-dialog'
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

function resource(id: ReturnType<typeof hmId>, name: string) {
  return {
    data: {
      type: 'document',
      id,
      document: {
        metadata: {name},
        visibility: 'PUBLIC',
      },
    },
    isLoading: false,
    isError: false,
    error: null,
  }
}

function emptyResource() {
  return {
    data: null,
    isLoading: false,
    isError: false,
    error: null,
  }
}

function renderDialog(input: React.ComponentProps<typeof DocumentDestinationDialog>['input']) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)

  act(() => {
    root.render(<DocumentDestinationDialog input={input} onClose={vi.fn()} />)
  })

  return {container, root}
}

function cleanup(root: Root, container: HTMLDivElement) {
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

describe('DocumentDestinationDialog', () => {
  beforeEach(() => {
    moveDraftMutateAsyncMock.mockReset()
    moveMutateAsyncMock.mockReset()
    navigateMock.mockReset()
    republishMutateAsyncMock.mockReset()
    writableDocumentsMock.splice(0, writableDocumentsMock.length, {
      entity: {
        id: hmId('alice'),
        document: {metadata: {name: 'Alice Site'}, visibility: 'PUBLIC'},
      },
      accountsWithWrite: ['alice'],
    })

    useResourceMock.mockImplementation((id?: ReturnType<typeof hmId> | null) => {
      if (!id) return emptyResource()
      const pathKey = id.path?.join('/') || ''
      if (id.uid === 'alice' && pathKey === '') return resource(id, 'Alice Site')
      if (id.uid === 'alice' && pathKey === 'docs') return resource(id, 'Docs')
      if (id.uid === 'alice' && pathKey === 'docs/api') return resource(id, 'API')
      return emptyResource()
    })
    useResourcesMock.mockImplementation((ids: ReturnType<typeof hmId>[]) =>
      ids.map((id) => {
        const pathKey = id.path?.join('/') || ''
        if (pathKey === '') return resource(id, 'Alice Site')
        if (pathKey === 'docs') return resource(id, 'Docs')
        return resource(id, id.path?.at(-1) || id.uid)
      }),
    )
    useDirectoryMock.mockImplementation((id?: ReturnType<typeof hmId> | null) => {
      const pathKey = id?.path?.join('/') || ''
      if (pathKey === '') {
        return {
          data: [{id: hmId('alice', {path: ['docs']}), path: ['docs'], metadata: {name: 'Docs'}, visibility: 'PUBLIC'}],
          isLoading: false,
        }
      }
      if (pathKey === 'docs') {
        return {
          data: [
            {
              id: hmId('alice', {path: ['docs', 'guide']}),
              path: ['docs', 'guide'],
              metadata: {name: 'Guide'},
              visibility: 'PUBLIC',
            },
          ],
          isLoading: false,
        }
      }
      return {data: [], isLoading: false}
    })
  })

  it('opens nested documents at the source parent with the current slug selected', () => {
    const {container, root} = renderDialog({id: hmId('alice', {path: ['docs', 'api']}), mode: 'republish'})
    try {
      expect(container.textContent).toContain('Location')
      expect(container.textContent).toContain('Alice Site')
      expect(container.textContent).toContain('Docs')
      expect(container.textContent).toContain('Guide')
      expect(findButtonExact(container, 'Back')).toBeTruthy()
      expect(container.querySelector('input[placeholder="url-path"]')).toHaveProperty('value', 'api')
      expect(container.textContent).toContain('Choose a new location or URL path.')
    } finally {
      cleanup(root, container)
    }
  })

  it('opens top-level documents at the site root instead of the writable-root chooser', () => {
    const {container, root} = renderDialog({id: hmId('alice', {path: ['docs']}), mode: 'move'})
    try {
      expect(container.textContent).toContain('Location')
      expect(container.textContent).not.toContain('Choose a site')
      expect(findButtonExact(container, 'Back')).toBeTruthy()
      expect(container.querySelector('input[placeholder="url-path"]')).toHaveProperty('value', 'docs')
      expect(container.textContent).toContain('Choose a new location or URL path.')
    } finally {
      cleanup(root, container)
    }
  })
})
