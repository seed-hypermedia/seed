import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {AlertDialog, AlertDialogContent} from '@shm/ui/components/alert-dialog'

let dialogComponent: React.ComponentType<any> | null = null

vi.mock('@/models/accounts', () => ({
  useDraft: () => ({data: {editId: 'document-id'}}),
}))

vi.mock('@/models/documents', () => ({
  useDeleteDraft: () => ({mutate: vi.fn()}),
}))

vi.mock('@/models/drafts', () => ({
  draftEditId: () => 'document-id',
}))

vi.mock('@shm/ui/universal-dialog', () => ({
  useAppDialog: (component: React.ComponentType<any>) => {
    dialogComponent = component
    return {open: vi.fn(), content: null}
  },
}))

import {useDeleteDraftDialog} from '../delete-draft-dialog'
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let container: HTMLDivElement | null = null

afterEach(() => {
  if (root) {
    act(() => root?.unmount())
  }
  container?.remove()
  root = null
  container = null
  dialogComponent = null
})

describe('DeleteDraftDialog', () => {
  it('visually distinguishes cancel from the destructive confirmation', () => {
    useDeleteDraftDialog()
    const DialogComponent = dialogComponent
    if (!DialogComponent) throw new Error('Dialog component was not registered')

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    act(() => {
      root?.render(
        <AlertDialog open>
          <AlertDialogContent>
            <DialogComponent input={{draftId: 'draft-id'}} onClose={vi.fn()} />
          </AlertDialogContent>
        </AlertDialog>,
      )
    })

    const buttons = Array.from(document.querySelectorAll('button'))
    const cancel = buttons.find((button) => button.textContent?.trim() === 'Cancel')
    const confirm = buttons.find((button) => button.textContent?.trim() === 'Yes, discard changes')

    expect(cancel?.className).toContain('border')
    expect(confirm?.className).toContain('bg-destructive')
  })

  it('offers delete/keep child draft actions and the child-draft sentence when childDraftCount > 0', () => {
    useDeleteDraftDialog()
    const DialogComponent = dialogComponent
    if (!DialogComponent) throw new Error('Dialog component was not registered')

    const onConfirm = vi.fn()
    const onConfirmKeepDrafts = vi.fn()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    act(() => {
      root?.render(
        <AlertDialog open>
          <AlertDialogContent>
            <DialogComponent
              input={{draftId: 'draft-id', childDraftCount: 2, onConfirm, onConfirmKeepDrafts}}
              onClose={vi.fn()}
            />
          </AlertDialogContent>
        </AlertDialog>,
      )
    })

    expect(document.body.textContent).toContain(
      'This draft contains 2 unpublished child document(s). Discarding removes their cards.',
    )
    const labels = Array.from(document.querySelectorAll('button')).map((button) => button.textContent?.trim())
    expect(labels).toEqual(
      expect.arrayContaining(['Cancel', 'Discard and keep drafts (not recommended)', 'Discard and delete drafts']),
    )
    const keep = Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Discard and keep drafts (not recommended)',
    )
    act(() => {
      keep?.dispatchEvent(new MouseEvent('click', {bubbles: true}))
    })
    expect(onConfirmKeepDrafts).toHaveBeenCalled()
    expect(onConfirm).not.toHaveBeenCalled()
  })
})
