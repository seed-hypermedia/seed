// @vitest-environment jsdom
import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {DeleteDocumentDialog} from '../delete-document-dialog'
;(globalThis as typeof globalThis & {React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean}).React = React
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

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
})

describe('DeleteDocumentDialog', () => {
  it('uses concise destructive copy and removes the main document scroll list', () => {
    act(() => {
      root.render(
        <DeleteDocumentDialog
          document={{key: 'parent', title: '🔍 Design Analysis', path: ['design-analysis']}}
          onConfirm={vi.fn()}
        />,
      )
    })

    expect(container.textContent).toContain('Delete "🔍 Design Analysis"?')
    expect(container.textContent).toContain(
      'This permanently removes the document and all its content. Links pointing to it from other documents will break.',
    )
    expect(container.textContent).not.toContain('This feature is a work-in-progress')
    expect(container.querySelector('[data-testid="delete-document-scroll-list"]')).toBeNull()

    const deleteButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Delete document',
    )
    expect(deleteButton).toBeTruthy()
  })

  it('shows and hides the bounded child document list without including the parent document', () => {
    const childDocuments = Array.from({length: 80}, (_, index) => ({
      key: `child-${index}`,
      title: `Child ${index}`,
      path: ['parent', `child-${index}`],
    }))

    act(() => {
      root.render(
        <DeleteDocumentDialog
          document={{key: 'parent', title: 'Parent', path: ['parent']}}
          childDocuments={childDocuments}
          onConfirm={vi.fn()}
        />,
      )
    })

    expect(container.textContent).toContain('80 documents will also be deleted')
    expect(container.querySelector('[data-testid="delete-document-child-list"]')).toBeNull()

    const showButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Show',
    ) as HTMLButtonElement

    expect(showButton.getAttribute('aria-expanded')).toBe('false')

    act(() => {
      showButton.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true}))
    })

    const childList = container.querySelector('[data-testid="delete-document-child-list"]') as HTMLElement
    const footer = container.querySelector('[data-testid="delete-document-footer"]') as HTMLElement
    const childRows = Array.from(container.querySelectorAll('[data-testid="delete-document-child-item"]'))

    expect(childList).toBeTruthy()
    expect(footer).toBeTruthy()
    expect(childList.contains(footer)).toBe(false)
    expect(childList.className).toContain('overflow-y-auto')
    expect(childList.className).toContain('max-h-')
    expect(childRows).toHaveLength(80)
    expect(childRows[0]?.textContent).toContain('Child 0')
    expect(childRows[0]?.textContent).toContain('parent/child-0')

    const hideButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Hide',
    ) as HTMLButtonElement

    expect(hideButton.getAttribute('aria-expanded')).toBe('true')
    expect(hideButton.getAttribute('aria-controls')).toBe(childList.id)

    act(() => {
      hideButton.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true}))
    })

    expect(container.querySelector('[data-testid="delete-document-child-list"]')).toBeNull()
  })

  it('calls the injected confirm function before success and close callbacks', async () => {
    const events: string[] = []
    const onConfirm = vi.fn(async () => {
      events.push('confirm')
    })
    const onClose = vi.fn(() => events.push('close'))
    const onSuccess = vi.fn(() => events.push('success'))

    act(() => {
      root.render(
        <DeleteDocumentDialog
          document={{key: 'doc', title: 'Doc', path: ['doc']}}
          onConfirm={onConfirm}
          onClose={onClose}
          onSuccess={onSuccess}
        />,
      )
    })

    const deleteButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Delete document',
    ) as HTMLButtonElement

    await act(async () => {
      deleteButton.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true}))
      await Promise.resolve()
    })

    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onSuccess).toHaveBeenCalledTimes(1)
    expect(events).toEqual(['confirm', 'close', 'success'])
  })
})
