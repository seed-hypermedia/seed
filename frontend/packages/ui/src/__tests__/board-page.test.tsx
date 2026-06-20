// @vitest-environment jsdom
import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import type {HMDocumentInfo} from '@seed-hypermedia/client/hm-types'
import {hmId} from '@shm/shared'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {BOARD_COLUMNS, BoardPage, getBoardColumnIdForDocument} from '../board-page'
;(globalThis as typeof globalThis & {React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean}).React = React
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const useAccountsMetadataMock = vi.hoisted(() => vi.fn(() => ({data: {}})))

vi.mock('@shm/shared/models/entity', () => ({
  useAccountsMetadata: useAccountsMetadataMock,
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

function makeDoc(path: string[], name: string, summary?: string): HMDocumentInfo {
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
      commentCount: 2,
      latestCommentId: '',
      latestChangeTime: '2024-01-01T00:00:00Z',
      isUnread: false,
    },
    generationInfo: {genesis: 'genesis', generation: 1n},
    metadata: {name, summary},
    visibility: 'PUBLIC',
  } as HMDocumentInfo
}

function renderBoard(props: Partial<React.ComponentProps<typeof BoardPage>> = {}) {
  const onNavigateToDocument = vi.fn()
  const onAddCard = vi.fn()
  const items = props.items ?? [makeDoc(['board', 'stories'], 'Board Stories', 'User stories for a board app view')]
  act(() => {
    root.render(
      <BoardPage
        boardId={hmId('site', {path: ['board']})}
        items={items}
        onNavigateToDocument={onNavigateToDocument}
        canAddCard
        onAddCard={onAddCard}
        {...props}
      />,
    )
  })
  return {onNavigateToDocument, onAddCard}
}

describe('BoardPage', () => {
  it('renders workflow columns, card counts, and child document cards', () => {
    renderBoard({
      items: [makeDoc(['board', 'stories'], 'Board Stories'), makeDoc(['board', 'concepts'], 'Board Concepts')],
    })

    for (const column of BOARD_COLUMNS) {
      expect(container.textContent).toContain(column.title)
      expect(container.querySelector(`[data-board-column="${column.id}"]`)).toBeTruthy()
    }
    expect(container.textContent).toContain('2 of 2 cards')
    expect(container.textContent).toContain('Board Stories')
    expect(container.textContent).toContain('/board/stories')
    expect(container.textContent).toMatch(/High|Medium|Low/)
  })

  it('filters cards by visible text and fake metadata', () => {
    renderBoard({
      items: [makeDoc(['board', 'stories'], 'Board Stories'), makeDoc(['board', 'concepts'], 'Board Concepts')],
    })

    const input = container.querySelector('input[aria-label="Filter board cards"]') as HTMLInputElement
    act(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      valueSetter?.call(input, 'concepts')
      input.dispatchEvent(new Event('input', {bubbles: true}))
    })

    expect(container.textContent).toContain('1 of 2 cards')
    expect(container.textContent).toContain('Board Concepts')
    expect(container.textContent).not.toContain('Board Stories')
  })

  it('opens document cards and supports shift-click new-window intent', () => {
    const document = makeDoc(['board', 'stories'], 'Board Stories')
    const {onNavigateToDocument} = renderBoard({items: [document]})

    const card = container.querySelector('button[aria-label="Open Board Stories"]')
    expect(card).toBeTruthy()

    act(() => {
      card?.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true}))
    })
    expect(onNavigateToDocument).toHaveBeenCalledWith(document.id)

    act(() => {
      card?.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true, shiftKey: true}))
    })
    expect(onNavigateToDocument).toHaveBeenCalledWith(document.id, {newWindow: true})
  })

  it('shows an empty board state and invokes Add Card', () => {
    const {onAddCard} = renderBoard({items: []})

    expect(container.textContent).toContain('No cards yet.')
    expect(container.textContent).toContain('Add a child document to start this board.')

    const addCard = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Add Card')
    expect(addCard).toBeTruthy()

    act(() => {
      addCard?.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true}))
    })
    expect(onAddCard).toHaveBeenCalled()
  })

  it('assigns documents to stable deterministic columns', () => {
    const document = makeDoc(['board', 'stories'], 'Board Stories')
    expect(getBoardColumnIdForDocument(document)).toBe(getBoardColumnIdForDocument(document))
  })
})
