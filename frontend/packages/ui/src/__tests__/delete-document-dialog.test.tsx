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
  it('keeps the action footer outside the scrollable document list', () => {
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

    const scrollList = container.querySelector('[data-testid="delete-document-scroll-list"]') as HTMLElement
    const footer = container.querySelector('[data-testid="delete-document-footer"]') as HTMLElement

    expect(scrollList).toBeTruthy()
    expect(footer).toBeTruthy()
    expect(scrollList.contains(footer)).toBe(false)
    expect(scrollList.className).toContain('overflow-y-auto')
    expect(container.firstElementChild?.className).toContain('max-h-')
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
      (button) => button.textContent?.includes('Delete Document'),
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
