// @vitest-environment jsdom
import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {ChildDeletionPublishDialog} from '../child-deletion-publish-dialog'
;(globalThis as typeof globalThis & {React?: typeof React}).React = React
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const {send, snapshot} = vi.hoisted(() => ({
  send: vi.fn(),
  snapshot: {
    matches: ({publishing}: {publishing: string}) => publishing === 'confirmingChildDeletion',
    context: {
      confirmedChildDeletions: [
        {
          documents: [
            {id: 'hm://alice/parent/child', version: 'v1', title: 'Child document'},
            {id: 'hm://alice/parent/child/nested', version: 'v2'},
          ],
        },
      ],
      childDeletionError: null,
    },
  },
}))

vi.mock('@shm/shared/models/use-document-machine', () => ({
  useDocumentSelector: (selector: (value: typeof snapshot) => unknown) => selector(snapshot),
  useDocumentSend: () => send,
}))

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  send.mockClear()
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
})

vi.mock('../document-deletion-references', () => ({DocumentDeletionReferences: () => null}))
