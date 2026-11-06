// @vitest-environment jsdom
import React from 'react'
import {act} from 'react-dom/test-utils'
import {createRoot} from 'react-dom/client'
import {describe, expect, it, vi} from 'vitest'
import {fromPromise, waitFor} from 'xstate'
import type {Action} from 'sonner'
import type {HMDocument} from '@seed-hypermedia/client/hm-types'
import {documentMachine} from '@shm/shared/models/document-machine'
import {
  DocumentMachineProvider,
  useDocumentMachineRef,
  type DocumentMachineActorRef,
} from '@shm/shared/models/use-document-machine'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {usePublishError} from '../editing-toolbar'
import {toast} from '../toast'

vi.mock('../toast', () => ({toast: {error: vi.fn()}}))
;(globalThis as typeof globalThis & {React?: typeof React}).React = React
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

describe('document publication error feedback', () => {
  it('opens a details dialog from the error toast and copies the full error while retaining the draft', async () => {
    const failure = new Error('HTTP 500 from PrepareDocumentChange: underlying server error')
    const retryFailure = new Error('HTTP 500 from PrepareDocumentChange: error from the latest attempt')
    const doc = {
      account: 'alice',
      path: '/empty',
      content: [],
      metadata: {},
      version: 'published-empty',
    } as unknown as HMDocument
    const publish = vi.fn().mockRejectedValueOnce(failure).mockRejectedValueOnce(retryFailure).mockResolvedValue(doc)
    const machine = documentMachine.provide({actors: {publishDocument: fromPromise(publish)}})
    const writeText = vi.fn().mockResolvedValue(undefined)
    const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
    Object.defineProperty(navigator, 'clipboard', {configurable: true, value: {writeText}})
    let actor: DocumentMachineActorRef
    function CaptureActor() {
      actor = useDocumentMachineRef()
      return null
    }
    const root = createRoot(document.createElement('div'))
    function Harness() {
      const publishError = usePublishError()
      return (
        <>
          <DocumentMachineProvider
            input={{documentId: hmId('alice', {path: ['empty']}), canEdit: true, existingDraftId: 'draft-1'}}
            machine={machine}
            onPublishError={publishError.showError}
          >
            <CaptureActor />
          </DocumentMachineProvider>
          {publishError.content}
        </>
      )
    }
    const render = () => root.render(<Harness />)

    vi.mocked(toast.error).mockClear()
    try {
      act(render)
      act(() => actor.send({type: 'document.loaded', document: doc}))
      for (let attempt = 1; attempt <= 2; attempt++) {
        await act(async () => {
          actor.send({type: 'publish.start'})
          await waitFor(actor, (snapshot) => snapshot.matches('editing'))
        })
        expect(toast.error).toHaveBeenCalledTimes(attempt)
        expect(actor!.getSnapshot().context.draftId).toBe('draft-1')
        act(render)
        expect(toast.error).toHaveBeenCalledTimes(attempt)
      }

      expect(toast.error).toHaveBeenLastCalledWith('Failed to publish', {
        id: 'document-publish-error',
        duration: 10_000,
        closeButton: true,
        action: {label: 'Show error details', onClick: expect.any(Function)},
      })
      const action = vi.mocked(toast.error).mock.calls[1]![1]!.action as Action
      expect(document.querySelector('[role="dialog"]')).toBeNull()
      expect(writeText).not.toHaveBeenCalled()
      act(() => action.onClick({} as React.MouseEvent<HTMLButtonElement>))
      const dialog = document.querySelector('[role="dialog"]')!
      expect(dialog.textContent).toContain('Error details')
      expect(dialog.querySelector('pre')?.textContent).toBe(retryFailure.stack)
      const copyButton = Array.from(dialog.querySelectorAll('button')).find(
        (button) => button.textContent?.trim() === 'Copy',
      )!
      await act(async () => copyButton.click())
      expect(writeText).toHaveBeenCalledWith(retryFailure.stack)
      const closeButton = dialog.querySelector('[data-slot="dialog-close"]') as HTMLButtonElement
      act(() => closeButton.click())
      expect(document.querySelector('[role="dialog"]')).toBeNull()

      act(() => action.onClick({} as React.MouseEvent<HTMLButtonElement>))
      expect(document.querySelector('[role="dialog"] pre')?.textContent).toBe(retryFailure.stack)
      act(() => document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true})))
      expect(document.querySelector('[role="dialog"]')).toBeNull()

      await act(async () => {
        actor.send({type: 'publish.start'})
        await waitFor(actor, (snapshot) => snapshot.matches('loaded'))
      })
      expect(toast.error).toHaveBeenCalledTimes(2)
      expect(actor!.getSnapshot().context.draftId).toBeNull()
    } finally {
      act(() => root.unmount())
      if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard)
      else Reflect.deleteProperty(navigator, 'clipboard')
    }
  })
})
