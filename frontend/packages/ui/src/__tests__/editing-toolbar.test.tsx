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
import {pathNameify} from '@shm/shared/utils/path'
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

function findButtonByText(container: HTMLDivElement, label: string) {
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
})

describe('PublishPopoverBody permalink editing', () => {
  beforeEach(() => {
    selectMock.document = {version: '', metadata: {}}
    selectMock.draftId = 'draft-1'
    selectMock.metadata = {name: 'My Doc'}
    sendMock.mockReset()
    unpublishedChangeCountMock.mockReset()
    unpublishedChangeCountMock.mockReturnValue(1)
    useAccountMock.mockReset()
    useAccountMock.mockReturnValue({data: undefined})
  })

  it('turns a typed trailing space into an editable dash separator', () => {
    const docId = hmId('acct-1', {path: ['parent', 'my']})
    const {container, root} = renderNode(
      <PublishPopoverBody
        docId={docId}
        changeCount={1}
        onPublish={vi.fn()}
        onClose={vi.fn()}
        publishDisabled={false}
        slugify={pathNameify}
      />,
    )

    try {
      const input = findInput(container)!
      act(() => {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
        setter.call(input, '/my ')
        input.dispatchEvent(new Event('input', {bubbles: true}))
      })

      expect(input.value).toBe('/my-')
    } finally {
      cleanup(root, container)
    }
  })

  it('does not create a leading dash from a leading space', () => {
    const docId = hmId('acct-1', {path: ['parent', 'my']})
    const {container, root} = renderNode(
      <PublishPopoverBody
        docId={docId}
        changeCount={1}
        onPublish={vi.fn()}
        onClose={vi.fn()}
        publishDisabled={false}
        slugify={pathNameify}
      />,
    )

    try {
      const input = findInput(container)!
      act(() => {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
        setter.call(input, '/ my doc')
        input.dispatchEvent(new Event('input', {bubbles: true}))
      })

      expect(input.value).toBe('/my-doc')
    } finally {
      cleanup(root, container)
    }
  })

  it('trims a trailing space-created dash from the publish override', () => {
    const docId = hmId('acct-1', {path: ['parent', 'my']})
    const onPublish = vi.fn()
    const {container, root} = renderNode(
      <PublishPopoverBody
        docId={docId}
        changeCount={1}
        onPublish={onPublish}
        onClose={vi.fn()}
        publishDisabled={false}
        slugify={pathNameify}
      />,
    )

    try {
      const input = findInput(container)!
      act(() => {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
        setter.call(input, '/my ')
        input.dispatchEvent(new Event('input', {bubbles: true}))
      })

      const publishButton = findButtonByText(container, 'Publish: Make it live now')
      act(() => {
        publishButton?.dispatchEvent(new MouseEvent('click', {bubbles: true}))
      })

      expect(onPublish).toHaveBeenCalledWith(['parent', 'my'])
    } finally {
      cleanup(root, container)
    }
  })
})
