// @vitest-environment jsdom
import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import type {HMDocumentInfo} from '@seed-hypermedia/client/hm-types'
import {hmId} from '@shm/shared'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {AllDocumentsPage} from '../all-documents-page'
;(globalThis as typeof globalThis & {React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean}).React = React
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const useDirectoryMock = vi.hoisted(() => vi.fn())
const useAccountsMetadataMock = vi.hoisted(() => vi.fn(() => ({data: {}})))

vi.mock('@shm/shared/models/entity', () => ({
  useAccountsMetadata: useAccountsMetadataMock,
  useDirectory: useDirectoryMock,
}))

vi.mock('@shm/shared/models/interaction-summary', () => ({
  useInteractionSummary: () => ({isLoading: false, data: {citations: 0}}),
}))

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
  vi.clearAllMocks()
})

function makeDoc(path: string[], name: string): HMDocumentInfo {
  const id = hmId('site', {path})
  return {
    type: 'document',
    id,
    path,
    authors: [],
    createTime: '2024-01-01T00:00:00Z',
    updateTime: '2024-01-01T00:00:00Z',
    sortTime: new Date('2024-01-01T00:00:00Z'),
    genesis: 'genesis',
    version: 'version-1',
    breadcrumbs: [],
    activitySummary: {
      commentCount: 0,
      latestCommentId: '',
      latestChangeTime: '2024-01-01T00:00:00Z',
      isUnread: false,
    },
    generationInfo: {genesis: 'genesis', generation: 1n},
    metadata: {name},
    visibility: 'PUBLIC',
  } as HMDocumentInfo
}

describe('AllDocumentsPage', () => {
  it('renders the document path in muted text below the title and keeps title navigation', () => {
    const document = makeDoc(['folder', 'doc'], 'Doc Title')
    const onNavigateToDocument = vi.fn()
    useDirectoryMock.mockReturnValue({
      data: [document],
      isLoading: false,
    })

    act(() => {
      root.render(<AllDocumentsPage siteId={hmId('site')} onNavigateToDocument={onNavigateToDocument} />)
    })

    expect(container.textContent).toContain('Doc Title')
    expect(container.textContent).toContain('/folder/doc')

    const titleButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Doc Title',
    )
    expect(titleButton).toBeTruthy()

    act(() => {
      titleButton?.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true}))
    })

    expect(onNavigateToDocument).toHaveBeenCalledWith(document.id)
  })

  it('passes newWindow when shift-clicking a document title', () => {
    const document = makeDoc(['folder', 'doc'], 'Doc Title')
    const onNavigateToDocument = vi.fn()
    useDirectoryMock.mockReturnValue({
      data: [document],
      isLoading: false,
    })

    act(() => {
      root.render(<AllDocumentsPage siteId={hmId('site')} onNavigateToDocument={onNavigateToDocument} />)
    })

    const titleButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Doc Title',
    )
    expect(titleButton).toBeTruthy()

    act(() => {
      titleButton?.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true, shiftKey: true}))
    })

    expect(onNavigateToDocument).toHaveBeenCalledWith(document.id, {newWindow: true})
  })
})
