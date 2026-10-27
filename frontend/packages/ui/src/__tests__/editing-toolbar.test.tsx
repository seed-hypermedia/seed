// @vitest-environment jsdom
import React from 'react'
import {createRoot, Root} from 'react-dom/client'
;(globalThis as typeof globalThis & {React?: typeof React}).React = React
import {act} from 'react-dom/test-utils'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {beforeEach, describe, expect, it, vi} from 'vitest'

const {selectMock, sendMock, unpublishedChangeCountMock, useAccountMock} = vi.hoisted(() => ({
  selectMock: {
    document: null as any,
    draftId: null as string | null,
    metadata: {} as Record<string, any>,
    renameState: 'idle' as 'idle' | 'renaming' | 'committing' | 'error',
    renameError: null as string | null,
    publishPath: null as string[] | null,
    effectivePublishPath: [] as string[],
  },
  sendMock: vi.fn(),
  unpublishedChangeCountMock: vi.fn(() => 0),
  useAccountMock: vi.fn(),
}))

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
  useDocumentSend: () => sendMock,
  selectDocument: (s: any) => s.context.document,
  selectDraftId: (s: any) => s.context.draftId,
  selectMetadata: (s: any) => s.context.metadata,
  selectSaveIndicatorStatus: () => 'hidden',
  selectRenameState: () => selectMock.renameState,
  selectRenameError: () => selectMock.renameError,
  selectPublishPath: () => selectMock.publishPath,
  selectEffectivePublishPath: () => selectMock.effectivePublishPath,
}))

vi.mock('@shm/shared/models/use-unpublished-change-count', () => ({
  useUnpublishedChangeCount: () => unpublishedChangeCountMock(),
}))

vi.mock('@shm/shared/models/entity', () => ({
  useAccount: useAccountMock,
}))

vi.mock('../copy-to-clipboard', () => ({copyTextToClipboard: vi.fn(() => Promise.resolve())}))

vi.mock('../toast', () => ({
  toast: {success: vi.fn(), error: vi.fn(), promise: vi.fn()},
}))

vi.mock('../tooltip', async () => {
  const React = await import('react')
  return {
    Tooltip: ({children}: {children: React.ReactNode}) => React.createElement(React.Fragment, null, children),
  }
})

import {PublishButtonWithPopover, PublishPopoverBody} from '../editing-toolbar'
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

function renderNode(node: React.ReactNode) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(node)
  })
  return {container, root}
}

function cleanup(root: Root, container: HTMLDivElement) {
  act(() => {
    root.unmount()
  })
  container.remove()
}

function findButtonByText(container: HTMLElement, label: string) {
  return Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.trim() === label) as
    | HTMLButtonElement
    | undefined
}

function findInput(container: HTMLDivElement) {
  return container.querySelector('input') as HTMLInputElement | null
}

describe('editing-toolbar publish disabled states', () => {
  beforeEach(() => {
    selectMock.document = {version: 'bafy123', metadata: {}}
    selectMock.draftId = 'draft-1'
    selectMock.metadata = {}
    sendMock.mockReset()
    unpublishedChangeCountMock.mockReset()
    unpublishedChangeCountMock.mockReturnValue(0)
    useAccountMock.mockReset()
    useAccountMock.mockReturnValue({data: undefined})
  })

  it('greys out the trigger when publish is unavailable', () => {
    const docId = hmId('acct-1', {path: ['my-doc']})
    const {container, root} = renderNode(
      <PublishButtonWithPopover docId={docId} existingMenuItems={[]} unpublishedChildCount={0} />,
    )

    try {
      const publishTrigger = findButtonByText(container, 'Publish')
      expect(publishTrigger).toBeTruthy()
      expect(publishTrigger?.className).toContain('bg-neutral-100')
      expect(publishTrigger?.className).toContain('text-neutral-500')
    } finally {
      cleanup(root, container)
    }
  })

  it('always shows the Publish label and spaces it from the options trigger', () => {
    const docId = hmId('acct-1', {path: ['my-doc']})
    const {container, root} = renderNode(
      <PublishButtonWithPopover docId={docId} existingMenuItems={[]} unpublishedChildCount={0} />,
    )

    try {
      const publishTrigger = findButtonByText(container, 'Publish')
      expect(publishTrigger).toBeTruthy()
      expect(publishTrigger?.querySelector('svg')).toBeNull()
      expect(container.firstElementChild?.className).toContain('gap-2')
    } finally {
      cleanup(root, container)
    }
  })

  it('keeps the trigger active when changes can be published', () => {
    unpublishedChangeCountMock.mockReturnValue(2)
    const docId = hmId('acct-1', {path: ['my-doc']})
    const {container, root} = renderNode(
      <PublishButtonWithPopover docId={docId} existingMenuItems={[]} unpublishedChildCount={0} />,
    )

    try {
      const publishTrigger = findButtonByText(container, 'Publish')
      expect(publishTrigger).toBeTruthy()
      expect(publishTrigger?.className).not.toContain('bg-neutral-100')
      expect(publishTrigger?.className).not.toContain('text-neutral-500')
    } finally {
      cleanup(root, container)
    }
  })

  it('opens the popover instead of immediately publishing after a previous publish', () => {
    unpublishedChangeCountMock.mockReturnValue(2)
    const docId = hmId('acct-1', {path: ['always-popover']})
    const {container, root} = renderNode(
      <PublishButtonWithPopover docId={docId} existingMenuItems={[]} unpublishedChildCount={0} />,
    )

    try {
      const publishTrigger = findButtonByText(container, 'Publish')!

      act(() => {
        publishTrigger.dispatchEvent(new MouseEvent('click', {bubbles: true}))
      })

      const popoverPublishButton = findButtonByText(document.body, 'Publish: Make it live now')
      expect(popoverPublishButton).toBeTruthy()

      act(() => {
        popoverPublishButton?.dispatchEvent(new MouseEvent('click', {bubbles: true}))
      })

      expect(sendMock).toHaveBeenCalledWith({type: 'publish.start'})
      sendMock.mockClear()

      act(() => {
        publishTrigger.dispatchEvent(new MouseEvent('click', {bubbles: true}))
      })

      expect(findButtonByText(document.body, 'Publish: Make it live now')).toBeTruthy()
      expect(sendMock).not.toHaveBeenCalled()
    } finally {
      cleanup(root, container)
    }
  })

  it('greys out the popover publish action when disabled', () => {
    const docId = hmId('acct-1', {path: ['my-doc']})
    const onPublish = vi.fn()
    const {container, root} = renderNode(
      <PublishPopoverBody
        docId={docId}
        changeCount={0}
        onPublish={onPublish}
        onClose={vi.fn()}
        publishDisabled={true}
      />,
    )

    try {
      const publishButton = findButtonByText(container, 'Publish: Make it live now')
      expect(publishButton).toBeTruthy()
      expect(publishButton?.disabled).toBe(true)
      expect(publishButton?.className).toContain('bg-neutral-100')
      expect(publishButton?.className).toContain('text-neutral-500')
    } finally {
      cleanup(root, container)
    }
  })

  it('uses a roomier publish popover layout', () => {
    unpublishedChangeCountMock.mockReturnValue(2)
    const docId = hmId('acct-1', {path: ['my-doc']})
    const {container, root} = renderNode(
      <PublishButtonWithPopover docId={docId} existingMenuItems={[]} unpublishedChildCount={0} />,
    )

    try {
      const publishTrigger = findButtonByText(container, 'Publish')!

      act(() => {
        publishTrigger.dispatchEvent(new MouseEvent('click', {bubbles: true}))
      })

      const popoverContent = document.body.querySelector('[data-slot="popover-content"]')
      const publishButton = findButtonByText(document.body, 'Publish: Make it live now')
      const body = popoverContent?.firstElementChild
      const title = Array.from(document.body.querySelectorAll('p')).find(
        (node) => node.textContent === 'Your document will be available at',
      )

      expect(popoverContent?.className).toContain('w-[26rem]')
      expect(popoverContent?.className).toContain('p-6')
      expect(body?.className).toContain('gap-5')
      expect(title?.className).toContain('text-base')
      expect(publishButton?.className).toContain('h-11')
    } finally {
      cleanup(root, container)
    }
  })
})

describe('PublishPopoverBody rename path editing', () => {
  beforeEach(() => {
    selectMock.document = {version: 'bafy123', metadata: {}}
    selectMock.draftId = 'draft-1'
    selectMock.metadata = {}
    selectMock.renameState = 'idle'
    selectMock.renameError = null
    selectMock.publishPath = null
    selectMock.effectivePublishPath = ['parent', 'my-doc']
    sendMock.mockReset()
    unpublishedChangeCountMock.mockReset()
    unpublishedChangeCountMock.mockReturnValue(1)
    useAccountMock.mockReset()
    useAccountMock.mockReturnValue({data: undefined})
  })

  function renderBody(docId: ReturnType<typeof hmId>) {
    return renderNode(
      <PublishPopoverBody
        docId={docId}
        changeCount={1}
        onPublish={vi.fn()}
        onClose={vi.fn()}
        publishDisabled={false}
        getDocumentUrl={() => 'https://example.com/parent/my-doc'}
      />,
    )
  }

  it('shows a pencil button and no input by default for a published doc', () => {
    const {container, root} = renderBody(hmId('acct-1', {path: ['parent', 'my-doc']}))
    try {
      expect(findInput(container)).toBeNull()
      expect(container.querySelector('button[aria-label="Edit path"]')).toBeTruthy()
    } finally {
      cleanup(root, container)
    }
  })

  it('hides the pencil for home documents', () => {
    const {container, root} = renderBody(hmId('acct-1', {path: []}))
    try {
      expect(container.querySelector('button[aria-label="Edit path"]')).toBeNull()
    } finally {
      cleanup(root, container)
    }
  })

  it('hides the pencil for private documents', () => {
    selectMock.document = {version: 'bafy123', metadata: {}, visibility: 'PRIVATE'}
    const {container, root} = renderBody(hmId('acct-1', {path: ['parent', 'my-doc']}))
    try {
      expect(container.querySelector('button[aria-label="Edit path"]')).toBeNull()
    } finally {
      cleanup(root, container)
    }
  })

  it('sends rename.start when the pencil is clicked', () => {
    const {container, root} = renderBody(hmId('acct-1', {path: ['parent', 'my-doc']}))
    try {
      const pencil = container.querySelector('button[aria-label="Edit path"]') as HTMLButtonElement
      act(() => {
        pencil.dispatchEvent(new MouseEvent('click', {bubbles: true}))
      })
      expect(sendMock).toHaveBeenCalledWith({type: 'rename.start'})
    } finally {
      cleanup(root, container)
    }
  })

  it('renders an input with save and cancel buttons while renaming', () => {
    selectMock.renameState = 'renaming'
    const {container, root} = renderBody(hmId('acct-1', {path: ['parent', 'my-doc']}))
    try {
      expect(findInput(container)).toBeTruthy()
      expect(container.querySelector('button[aria-label="Save path"]')).toBeTruthy()
      expect(container.querySelector('button[aria-label="Cancel path edit"]')).toBeTruthy()
    } finally {
      cleanup(root, container)
    }
  })

  it('shows an error and retry button in the error state', () => {
    selectMock.renameState = 'error'
    selectMock.renameError = 'A document already exists at this path.'
    const {container, root} = renderBody(hmId('acct-1', {path: ['parent', 'my-doc']}))
    try {
      expect(container.textContent).toContain('A document already exists at this path.')
      expect(container.querySelector('button[aria-label="Retry rename"]')).toBeTruthy()
    } finally {
      cleanup(root, container)
    }
  })
})
