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

import {pathNameify} from '@shm/shared/utils/path'
import {computeInlineDraftPublishPath} from '@shm/shared/utils/publish-paths'
import {PublishPopoverBody} from '../editing-toolbar'
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

function setSnapshot(opts: {document?: any; draftId?: string | null; metadata?: Record<string, any>}) {
  selectMock.document = opts.document ?? null
  selectMock.draftId = opts.draftId ?? null
  selectMock.metadata = opts.metadata ?? {}
}

function renderPopover(docId: ReturnType<typeof hmId>, onPublish: (override?: string[]) => void) {
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
        slugify={pathNameify}
        computeFirstPublishPath={computeInlineDraftPublishPath}
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

function findButtonByText(container: HTMLDivElement, label: string) {
  return Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.trim() === label) as
    | HTMLButtonElement
    | undefined
}

describe('PublishPopoverBody', () => {
  beforeEach(() => {
    selectMock.document = null
    selectMock.draftId = null
    selectMock.metadata = {}
    useResourceMock.mockReset()
    useAccountMock.mockReset()
    useResourceMock.mockReturnValue({data: undefined})
    useAccountMock.mockReturnValue({data: undefined})
  })

  it('shows the editable permalink input on first publish (no published version)', () => {
    setSnapshot({
      document: {version: '', metadata: {}},
      draftId: 'abc',
      metadata: {name: 'My Cool Doc'},
    })
    const docId = hmId('acct-1', {path: ['parent', '-abc']})
    const onPublish = vi.fn()

    const {container, root} = renderPopover(docId, onPublish)
    try {
      const input = findInput(container)
      expect(input).toBeTruthy()
      // Auto-filled from the title slug because the path is the placeholder.
      expect(input!.value).toBe('/my-cool-doc')
    } finally {
      cleanup(root, container)
    }
  })

  it('hides the editable permalink for re-publishes (existing published version)', () => {
    setSnapshot({
      document: {version: 'bafy123', metadata: {}},
      draftId: 'abc',
      metadata: {name: 'My Cool Doc'},
    })
    const docId = hmId('acct-1', {path: ['parent', 'my-cool-doc']})
    const onPublish = vi.fn()

    const {container, root} = renderPopover(docId, onPublish)
    try {
      expect(findInput(container)).toBeNull()
    } finally {
      cleanup(root, container)
    }
  })

  it('hides the editable permalink for home-doc edits (empty path)', () => {
    setSnapshot({
      document: {version: '', metadata: {}},
      draftId: 'abc',
      metadata: {name: 'Home'},
    })
    const docId = hmId('acct-1', {path: []})
    const onPublish = vi.fn()

    const {container, root} = renderPopover(docId, onPublish)
    try {
      expect(findInput(container)).toBeNull()
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
    const onPublish = vi.fn()

    const {container, root} = renderPopover(docId, onPublish)
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

  it('forwards the user-typed override to onPublish when Publish is clicked', () => {
    setSnapshot({
      document: {version: '', metadata: {}},
      draftId: 'abc',
      metadata: {name: 'My Cool Doc'},
    })
    const docId = hmId('acct-1', {path: ['parent', '-abc']})
    const onPublish = vi.fn()

    const {container, root} = renderPopover(docId, onPublish)
    try {
      const input = findInput(container)!
      // Simulate the user editing the permalink to a new slug.
      act(() => {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
        setter.call(input, '/my-typed-slug')
        input.dispatchEvent(new Event('input', {bubbles: true}))
      })
      const publishButton = findButtonByText(container, 'Publish: Make it live now')
      act(() => {
        publishButton?.dispatchEvent(new MouseEvent('click', {bubbles: true}))
      })
      expect(onPublish).toHaveBeenCalledWith(['parent', 'my-typed-slug'])
    } finally {
      cleanup(root, container)
    }
  })

  it('omits the override when the user has not edited the input', () => {
    setSnapshot({
      document: {version: '', metadata: {}},
      draftId: 'abc',
      metadata: {name: 'My Cool Doc'},
    })
    const docId = hmId('acct-1', {path: ['parent', '-abc']})
    const onPublish = vi.fn()

    const {container, root} = renderPopover(docId, onPublish)
    try {
      const publishButton = findButtonByText(container, 'Publish: Make it live now')
      act(() => {
        publishButton?.dispatchEvent(new MouseEvent('click', {bubbles: true}))
      })
      expect(onPublish).toHaveBeenCalledWith(undefined)
    } finally {
      cleanup(root, container)
    }
  })
})
