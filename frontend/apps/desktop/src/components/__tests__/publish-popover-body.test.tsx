import React from 'react'
import {createRoot, Root} from 'react-dom/client'
;(globalThis as typeof globalThis & {React?: typeof React}).React = React
import {act} from 'react-dom/test-utils'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {beforeEach, describe, expect, it, vi} from 'vitest'

const {selectMock, useResourceMock, useAccountMock} = vi.hoisted(() => ({
  selectMock: {
    document: null as any,
    draftId: null as string | null,
    metadata: {} as Record<string, any>,
    renameState: 'idle' as 'idle' | 'renaming' | 'committing' | 'error',
    renameError: null as string | null,
    publishPath: null as string[] | null,
    effectivePublishPath: [] as string[],
  },
  useResourceMock: vi.fn(),
  useAccountMock: vi.fn(),
}))

// `useDocumentSelector` reads from the mocked snapshot. Each test rebinds
// `selectMock.document` / `draftId` / `metadata` to drive different code paths.
vi.mock('@shm/shared/models/use-document-machine', () => ({
  useDocumentSelector: (selector: (snapshot: any) => any) => {
    const snapshot = {
      context: {
        document: selectMock.document,
        draftId: selectMock.draftId,
        metadata: selectMock.metadata,
      },
    }
    return selector(snapshot)
  },
  useDocumentSend: () => vi.fn(),
  selectDocument: (s: any) => s.context.document,
  selectDraftId: (s: any) => s.context.draftId,
  selectMetadata: (s: any) => s.context.metadata,
  selectRenameState: () => selectMock.renameState,
  selectRenameError: () => selectMock.renameError,
  selectPublishPath: () => selectMock.publishPath,
  selectEffectivePublishPath: () => selectMock.effectivePublishPath,
  selectEditorBaseline: () => null,
  selectNavigation: () => undefined,
  selectSaveIndicatorStatus: () => 'hidden',
  selectSaveStatus: () => 'idle',
}))

vi.mock('@shm/shared/models/entity', () => ({
  useResource: useResourceMock,
  useAccount: useAccountMock,
}))

vi.mock('@/models/gateway-settings', () => ({
  useGatewayUrl: () => ({data: 'https://hyper.media'}),
}))

vi.mock('@shm/shared/models/editor-handlers-context', () => ({
  useEditorHandlersRef: () => ({current: {getCurrentBlocks: () => []}}),
}))

vi.mock('@/models/navigation', () => ({getNavigationChanges: () => []}))

vi.mock('@/trpc', () => ({
  client: {createAppWindow: {mutate: vi.fn()}},
}))

vi.mock('@/utils/useNavigate', () => ({useNavigate: () => vi.fn()}))

// Editor barrel pulls in BlockNote files that use bare `<JSX />` (legacy
// classic runtime). Stub them out so the popover test only loads what it
// actually exercises.
vi.mock('@shm/editor/blocknote', () => ({useBlockNote: vi.fn()}))
vi.mock('@shm/editor/blocknote/core', () => ({BlockNoteEditor: class {}}))
vi.mock('@shm/editor/hypermedia-link-plugin', () => ({createHypermediaDocLinkPlugin: vi.fn()}))
vi.mock('@shm/editor/slash-menu-items', () => ({getSlashMenuItems: () => []}))
vi.mock('@shm/editor/document-editor', () => ({DocumentEditor: () => null}))
vi.mock('@shm/editor/query-search-context', () => ({QuerySearchInputProvider: ({children}: any) => children}))

// `delete-draft-dialog` imports `@/models/documents`, which transitively
// imports the BlockNote editor (via slash-menu, draft-machine, etc.). The
// popover body uses the dialog only via `useDeleteDraftDialog`, so stub it.
vi.mock('../delete-draft-dialog', () => ({
  useDeleteDraftDialog: () => ({open: vi.fn(), content: null}),
}))
vi.mock('@/models/documents', () => ({
  useDeleteDraft: () => ({mutate: vi.fn()}),
}))

vi.mock('@shm/ui/copy-to-clipboard', () => ({copyTextToClipboard: vi.fn(() => Promise.resolve())}))

vi.mock('@shm/ui/toast', () => ({
  toast: {success: vi.fn(), error: vi.fn(), promise: vi.fn()},
}))

// Tooltip needs a TooltipProvider in scope; bypass it for the popover test.
vi.mock('@shm/ui/tooltip', async () => {
  const React = await import('react')
  return {
    Tooltip: ({children}: {children: React.ReactNode}) => React.createElement(React.Fragment, null, children),
  }
})

import {PublishPopoverBody} from '../editing-toolbar'
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

function setSnapshot(opts: {document?: any; draftId?: string | null; metadata?: Record<string, any>}) {
  selectMock.document = opts.document ?? null
  selectMock.draftId = opts.draftId ?? null
  selectMock.metadata = opts.metadata ?? {}
}

function renderPopover(docId: ReturnType<typeof hmId>, onPublish: () => void) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(
      <PublishPopoverBody
        docId={docId}
        changeCount={3}
        onPublish={onPublish}
        onClose={vi.fn()}
        publishDisabled={false}
        getDocumentUrl={() => 'https://example.com/parent/my-cool-doc'}
      />,
    )
  })
  return {container, root}
}

function cleanup(root: Root, container: HTMLDivElement) {
  act(() => {
    root.unmount()
  })
  container.remove()
}

function findInput(container: HTMLDivElement) {
  return container.querySelector('input') as HTMLInputElement | null
}

describe('PublishPopoverBody', () => {
  beforeEach(() => {
    selectMock.document = null
    selectMock.draftId = null
    selectMock.metadata = {}
    selectMock.renameState = 'idle'
    selectMock.renameError = null
    selectMock.publishPath = null
    selectMock.effectivePublishPath = ['parent', 'my-cool-doc']
    useResourceMock.mockReset()
    useAccountMock.mockReset()
    useResourceMock.mockReturnValue({data: undefined})
    useAccountMock.mockReturnValue({data: undefined})
  })

  it('shows a pencil button and no input for a published doc', () => {
    setSnapshot({
      document: {version: 'bafy123', metadata: {}},
      draftId: 'abc',
      metadata: {name: 'My Cool Doc'},
    })
    const docId = hmId('acct-1', {path: ['parent', 'my-cool-doc']})
    const {container, root} = renderPopover(docId, vi.fn())
    try {
      expect(findInput(container)).toBeNull()
      expect(container.querySelector('button[aria-label="Edit path"]')).toBeTruthy()
    } finally {
      cleanup(root, container)
    }
  })

  it('shows a pencil button and no input for a first-publish doc', () => {
    setSnapshot({
      document: {version: '', metadata: {}},
      draftId: 'abc',
      metadata: {name: 'My Cool Doc'},
    })
    const docId = hmId('acct-1', {path: ['parent', '-abc']})
    const {container, root} = renderPopover(docId, vi.fn())
    try {
      expect(findInput(container)).toBeNull()
      expect(container.querySelector('button[aria-label="Edit path"]')).toBeTruthy()
    } finally {
      cleanup(root, container)
    }
  })

  it('hides the pencil for home-doc edits (empty path)', () => {
    setSnapshot({
      document: {version: '', metadata: {}},
      draftId: 'abc',
      metadata: {name: 'Home'},
    })
    const docId = hmId('acct-1', {path: []})
    const {container, root} = renderPopover(docId, vi.fn())
    try {
      expect(container.querySelector('button[aria-label="Edit path"]')).toBeNull()
    } finally {
      cleanup(root, container)
    }
  })

  it('hides the pencil for private docs', () => {
    setSnapshot({
      document: {version: 'bafy123', metadata: {}, visibility: 'PRIVATE'},
      draftId: 'abc',
      metadata: {name: 'My Private Doc'},
    })
    const docId = hmId('acct-1', {path: ['my-cool-doc']})
    const {container, root} = renderPopover(docId, vi.fn())
    try {
      expect(container.querySelector('button[aria-label="Edit path"]')).toBeNull()
    } finally {
      cleanup(root, container)
    }
  })

  it('shows a non-clickable not-yet-published status for first publish docs', () => {
    setSnapshot({
      document: {version: '', metadata: {}},
      draftId: 'abc',
      metadata: {name: 'My Cool Doc'},
    })
    const docId = hmId('acct-1', {path: ['parent', '-abc']})
    const {container, root} = renderPopover(docId, vi.fn())
    try {
      expect(container.textContent).toContain('Not yet published')
      const matchingButton = Array.from(container.querySelectorAll('button')).find(
        (button) => button.textContent?.includes('Not yet published'),
      )
      expect(matchingButton).toBeUndefined()
    } finally {
      cleanup(root, container)
    }
  })

  it('renders an input with save and cancel buttons while renaming', () => {
    selectMock.renameState = 'renaming'
    setSnapshot({
      document: {version: '', metadata: {}},
      draftId: 'abc',
      metadata: {name: 'My Cool Doc'},
    })
    const docId = hmId('acct-1', {path: ['parent', '-abc']})
    const {container, root} = renderPopover(docId, vi.fn())
    try {
      expect(findInput(container)).toBeTruthy()
      expect(container.querySelector('button[aria-label="Save path"]')).toBeTruthy()
      expect(container.querySelector('button[aria-label="Cancel path edit"]')).toBeTruthy()
    } finally {
      cleanup(root, container)
    }
  })
})
