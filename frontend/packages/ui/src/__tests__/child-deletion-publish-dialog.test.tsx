// @vitest-environment jsdom
import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {ChildDeletionPublishDialog} from '../child-deletion-publish-dialog'
;(globalThis as typeof globalThis & {React?: typeof React}).React = React
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const {send, snapshot, state} = vi.hoisted(() => ({
  send: vi.fn(),
  state: {publishing: 'confirmingChildDeletion', error: null as string | null},
  snapshot: {} as {
    matches: (value: {publishing: string} | string) => boolean
    context: {
      confirmedChildDeletions: Array<{documents: Array<{id: string; version: string; title?: string}>}>
      childDeletionError: string | null
    }
  },
}))
Object.assign(snapshot, {
  matches: (value: {publishing: string} | string) =>
    typeof value === 'string' ? state.publishing === value : value.publishing === state.publishing,
  context: {
    confirmedChildDeletions: [
      {
        documents: [
          {id: 'hm://alice/parent/child', version: 'v1', title: 'Child document'},
          {id: 'hm://alice/parent/child/nested', version: 'v2'},
        ],
      },
    ],
    get childDeletionError() {
      return state.error
    },
  },
})

vi.mock('@shm/shared/models/use-document-machine', () => ({
  useDocumentSelector: (selector: (value: typeof snapshot) => unknown) => selector(snapshot),
  useDocumentSend: () => send,
}))

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  send.mockClear()
  state.publishing = 'confirmingChildDeletion'
  state.error = null
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('ChildDeletionPublishDialog', () => {
  it('shows titles and relative paths in a collapsed Show/Hide list instead of full HM URLs', () => {
    act(() => root.render(<ChildDeletionPublishDialog />))
    const dialog = document.querySelector('[role="alertdialog"]')!
    expect(dialog.textContent).toContain('2 documents will be deleted')
    expect(dialog.textContent).not.toContain('hm://')
    expect(dialog.querySelector('[data-testid="delete-document-child-list"]')).toBeNull()
    const toggle = Array.from(dialog.querySelectorAll('button')).find((button) => button.textContent === 'Show')!
    expect(toggle).toBeTruthy()
    act(() => toggle.click())
    const rows = dialog.querySelectorAll('[data-testid="delete-document-child-item"]')
    expect(rows).toHaveLength(2)
    expect(rows[0]?.textContent).toBe('Child documentparent/child')
    expect(rows[1]?.textContent).toBe('nestedparent/child/nested')
    expect(toggle.textContent).toBe('Hide')
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    act(() => toggle.click())
    expect(dialog.querySelector('[data-testid="delete-document-child-list"]')).toBeNull()
    expect(send).not.toHaveBeenCalled()
  })

  it('preserves explicit destructive confirmation', () => {
    act(() => root.render(<ChildDeletionPublishDialog />))
    const confirm = Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent === 'Publish and delete 2 documents',
    )!
    act(() => confirm.click())
    expect(send).toHaveBeenCalledWith({type: 'publish.confirmChildDeletion'})
    expect(send).not.toHaveBeenCalledWith({type: 'publish.cancelChildDeletion'})
  })

  it('replaces the footer cancel button with a top-right close X', () => {
    act(() => root.render(<ChildDeletionPublishDialog />))
    const dialog = document.querySelector('[role="alertdialog"]')!
    const footer = dialog.querySelector('[data-slot="alert-dialog-footer"]')!
    expect(
      Array.from(dialog.querySelectorAll('button')).some((button) => button.textContent === 'Back to editing'),
    ).toBe(false)
    const close = dialog.querySelector('button[aria-label="Back to editing"]')!
    expect(footer.contains(close)).toBe(false)
    act(() => (close as HTMLButtonElement).click())
    expect(send).toHaveBeenCalledWith({type: 'publish.cancelChildDeletion'})
  })

  it('cancels through onOpenChange when Escape is pressed', () => {
    act(() => root.render(<ChildDeletionPublishDialog />))
    const dialog = document.querySelector('[role="alertdialog"]')!
    act(() => {
      dialog.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}))
    })
    expect(send).toHaveBeenCalledWith({type: 'publish.cancelChildDeletion'})
  })

  it('shows only the two publish actions in the confirming footer', () => {
    act(() => root.render(<ChildDeletionPublishDialog />))
    const buttons = Array.from(document.querySelectorAll('[data-slot="alert-dialog-footer"] button')).map(
      (button) => button.textContent,
    )
    expect(buttons).toEqual(['Publish without deleting', 'Publish and delete 2 documents'])
  })

  it('offers publishing without deleting while confirming', () => {
    act(() => root.render(<ChildDeletionPublishDialog />))
    const skip = Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent === 'Publish without deleting',
    )!
    expect(skip).toBeTruthy()
    act(() => skip.click())
    expect(send).toHaveBeenCalledWith({type: 'publish.skipChildDeletion'})
    expect(send).not.toHaveBeenCalledWith({type: 'publish.cancelChildDeletion'})
    expect(send).not.toHaveBeenCalledWith({type: 'publish.confirmChildDeletion'})
  })

  it('offers publishing without deleting after inspection failed, without a delete option', () => {
    state.publishing = 'childDeletionFailed'
    state.error = 'offline'
    act(() => root.render(<ChildDeletionPublishDialog />))
    const dialog = document.querySelector('[role="alertdialog"]')!
    expect(dialog.textContent).toContain('offline')
    expect(
      Array.from(dialog.querySelectorAll('button')).some(
        (button) => button.textContent?.startsWith('Publish and delete'),
      ),
    ).toBe(false)
    const buttons = Array.from(dialog.querySelectorAll('[data-slot="alert-dialog-footer"] button')).map(
      (button) => button.textContent,
    )
    expect(buttons).toEqual(['Publish without deleting'])
    const skip = Array.from(dialog.querySelectorAll('button')).find(
      (button) => button.textContent === 'Publish without deleting',
    )!
    expect(skip).toBeTruthy()
    act(() => skip.click())
    expect(send).toHaveBeenCalledWith({type: 'publish.skipChildDeletion'})
    expect(send).not.toHaveBeenCalledWith({type: 'publish.cancelChildDeletion'})
  })
})

vi.mock('../document-deletion-references', () => ({DocumentDeletionReferences: () => null}))
