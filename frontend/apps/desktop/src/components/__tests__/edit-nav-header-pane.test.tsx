import React from 'react'
import {createRoot, Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {beforeEach, describe, expect, it, vi} from 'vitest'
import {hmId} from '@shm/shared/utils/entity-id-url'
import type {HMNavigationItem} from '@seed-hypermedia/client/hm-types'

const {editNavPopoverMock, useEditorGateMock, useResourceMock, useDocumentNavigationOptionalMock, useDocumentSendMock} =
  vi.hoisted(() => ({
    editNavPopoverMock: vi.fn(),
    useEditorGateMock: vi.fn(),
    useResourceMock: vi.fn(),
    useDocumentNavigationOptionalMock: vi.fn(),
    useDocumentSendMock: vi.fn(),
  }))

vi.mock('@/components/edit-navigation-popover', () => ({
  EditNavPopover: (props: any) => {
    editNavPopoverMock(props)
    return <div data-testid="edit-nav-popover" />
  },
}))

vi.mock('@shm/shared/models/entity', () => ({
  useResource: useResourceMock,
}))

vi.mock('@shm/shared/models/use-editor-gate', () => ({
  useEditorGate: useEditorGateMock,
}))

vi.mock('@shm/shared/models/use-document-machine', () => ({
  useDocumentNavigationOptional: useDocumentNavigationOptionalMock,
  useDocumentSend: useDocumentSendMock,
}))

import {EditNavHeaderPane} from '../edit-nav-header-pane'
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

function renderPane() {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)

  act(() => {
    root.render(<EditNavHeaderPane homeId={hmId('alice')} />)
  })

  return {container, root}
}

function cleanup(root: Root, container: HTMLDivElement) {
  act(() => {
    root.unmount()
  })
  container.remove()
}

function makeNavigationItem(id: string, text: string, link: string): HMNavigationItem {
  return {id, type: 'Link', text, link}
}

describe('EditNavHeaderPane', () => {
  beforeEach(() => {
    editNavPopoverMock.mockReset()
    useEditorGateMock.mockReset()
    useResourceMock.mockReset()
    useDocumentNavigationOptionalMock.mockReset()
    useDocumentSendMock.mockReset()

    useEditorGateMock.mockReturnValue({
      canEdit: true,
      beginEditIfNeeded: vi.fn(),
    })
    useDocumentSendMock.mockReturnValue(vi.fn())
    useDocumentNavigationOptionalMock.mockReturnValue(undefined)
    useResourceMock.mockReturnValue({
      data: {
        type: 'document',
        document: {
          detachedBlocks: {},
        },
      },
    })
  })

  it('passes an empty navigation list when the top nav has never been configured', () => {
    const {container, root} = renderPane()

    try {
      expect(editNavPopoverMock).toHaveBeenCalledWith(
        expect.objectContaining({
          docNav: [],
          homeId: hmId('alice'),
        }),
      )
    } finally {
      cleanup(root, container)
    }
  })

  it('passes published explicit navigation items when present', () => {
    useResourceMock.mockReturnValue({
      data: {
        type: 'document',
        document: {
          detachedBlocks: {
            navigation: {
              children: [
                {block: makeNavigationItem('nav-1', 'Docs', 'hm://alice/docs')},
                {block: makeNavigationItem('nav-2', 'About', 'hm://alice/about')},
              ],
            },
          },
        },
      },
    })

    const {container, root} = renderPane()

    try {
      expect(editNavPopoverMock).toHaveBeenCalledWith(
        expect.objectContaining({
          docNav: [
            makeNavigationItem('nav-1', 'Docs', 'hm://alice/docs'),
            makeNavigationItem('nav-2', 'About', 'hm://alice/about'),
          ],
        }),
      )
    } finally {
      cleanup(root, container)
    }
  })

  it('prefers in-flight draft navigation over published navigation', () => {
    useDocumentNavigationOptionalMock.mockReturnValue([
      makeNavigationItem('draft-1', 'Draft Docs', 'hm://alice/draft-docs'),
    ])
    useResourceMock.mockReturnValue({
      data: {
        type: 'document',
        document: {
          detachedBlocks: {
            navigation: {
              children: [{block: makeNavigationItem('nav-1', 'Published Docs', 'hm://alice/docs')}],
            },
          },
        },
      },
    })

    const {container, root} = renderPane()

    try {
      expect(editNavPopoverMock).toHaveBeenCalledWith(
        expect.objectContaining({
          docNav: [makeNavigationItem('draft-1', 'Draft Docs', 'hm://alice/draft-docs')],
        }),
      )
    } finally {
      cleanup(root, container)
    }
  })
})
