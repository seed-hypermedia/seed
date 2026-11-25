import React from 'react'
import {createRoot, Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {hmId} from '@shm/shared/utils/entity-id-url'

const {headerAddLinkMock, useIsSiteOwnerMock, useResourceMock} = vi.hoisted(() => ({
  headerAddLinkMock: vi.fn(),
  useIsSiteOwnerMock: vi.fn(),
  useResourceMock: vi.fn(),
}))

vi.mock('@shm/ui/space-settings-navigation', () => ({
  HeaderAddLink: (props: any) => {
    headerAddLinkMock(props)
    return <button>Add or edit links</button>
  },
}))
vi.mock('@shm/shared/models/capabilities', () => ({useIsSiteOwner: useIsSiteOwnerMock}))
vi.mock('@shm/shared/models/entity', () => ({useResource: useResourceMock}))
vi.mock('@/models/site', () => ({useUpdateHomeDocument: () => ({mutateAsync: vi.fn(), isPending: false})}))

import {EditNavHeaderPane} from '../edit-nav-header-pane'
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const home = {metadata: {name: 'Alice'}, detachedBlocks: {}}
let container: HTMLDivElement
let root: Root

function renderPane() {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(<EditNavHeaderPane homeId={hmId('alice')} />))
}

beforeEach(() => {
  headerAddLinkMock.mockReset()
  useIsSiteOwnerMock.mockReturnValue({isSiteOwner: true, isLoading: false})
  useResourceMock.mockReturnValue({data: {type: 'document', document: home}})
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('EditNavHeaderPane', () => {
  it('offers the owner the add-link button for their published home document', () => {
    renderPane()

    expect(container.textContent).toBe('Add or edit links')
    expect(headerAddLinkMock).toHaveBeenCalledWith(expect.objectContaining({siteId: hmId('alice'), document: home}))
  })

  it("offers nothing to someone who can't publish the space's home document", () => {
    useIsSiteOwnerMock.mockReturnValue({isSiteOwner: false, isLoading: false})
    renderPane()

    expect(container.textContent).toBe('')
  })

  it('waits for the home document before offering the button', () => {
    useResourceMock.mockReturnValue({data: undefined})
    renderPane()

    expect(container.textContent).toBe('')
  })
})
