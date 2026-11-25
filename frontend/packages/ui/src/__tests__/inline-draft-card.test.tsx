// @vitest-environment jsdom
import React from 'react'
import {createRoot, Root} from 'react-dom/client'
;(globalThis as typeof globalThis & {React?: typeof React}).React = React
import {act} from 'react-dom/test-utils'
import {describe, expect, it, vi} from 'vitest'
import {InlineDraftCard} from '../inline-draft-card'
import {InlineDraftListItem} from '../inline-draft-list-item'
import {toast} from '../toast'
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

function renderNode(node: React.ReactNode) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(node)
  })
  return {container, root}
}

function cleanup(root: Root, container: HTMLDivElement) {
  act(() => {
    root.unmount()
  })
  container.remove()
}

const draft = {
  id: 'draft-1',
  metadata: {name: 'Draft title'},
} as any

function pressEnter(input: HTMLInputElement) {
  act(() => {
    input.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true}))
  })
}

describe('draft card title input open action', () => {
  it.each([InlineDraftCard, InlineDraftListItem])(
    'keeps the draft open for retry when saving fails (%#)',
    async (Draft) => {
      const onUpdateDraftName = vi.fn().mockRejectedValueOnce(new Error('Save failed')).mockResolvedValue(undefined)
      const onOpenDraft = vi.fn()
      const showError = vi.spyOn(toast, 'error').mockImplementation(() => 'save-error')
      const {container, root} = renderNode(
        <Draft draft={draft} onUpdateDraftName={onUpdateDraftName} onOpenDraft={onOpenDraft} onDeleteDraft={vi.fn()} />,
      )

      try {
        const input = container.querySelector('input')!
        await act(async () => pressEnter(input))
        expect(onOpenDraft).not.toHaveBeenCalled()
        expect(input.value).toBe('Draft title')
        expect(showError).toHaveBeenCalledWith('Failed to save draft title')

        await act(async () => pressEnter(input))
        expect(onOpenDraft).toHaveBeenCalledExactlyOnceWith('draft-1')
      } finally {
        cleanup(root, container)
        showError.mockRestore()
      }
    },
  )

  it.each(['card', 'list', 'table'] as const)(
    'saves the complete title before opening the %s when Enter immediately follows typing',
    async (view) => {
      vi.useFakeTimers()
      let finishSave!: () => void
      let savedTitle = draft.metadata.name
      const save = new Promise<void>((resolve) => {
        finishSave = resolve
      })
      const onUpdateDraftName = vi.fn(async (_draftId: string, name: string) => {
        await save
        savedTitle = name
      })
      const onOpenDraft = vi.fn(() => savedTitle)
      const props = {draft, onUpdateDraftName, onOpenDraft, onDeleteDraft: vi.fn()}
      const {container, root} = renderNode(
        view === 'card' ? (
          <InlineDraftCard {...props} />
        ) : view === 'table' ? (
          <table>
            <tbody>
              <InlineDraftListItem {...props} tableColumns={[{id: 'title', size: 300}]} />
            </tbody>
          </table>
        ) : (
          <InlineDraftListItem {...props} />
        ),
      )

      try {
        const input = container.querySelector('input')!
        for (const title of ['A complete doc', 'A complete document title']) {
          act(() => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, title)
            input.dispatchEvent(new Event('input', {bubbles: true}))
          })
        }
        pressEnter(input)
        expect(onUpdateDraftName).toHaveBeenCalledExactlyOnceWith('draft-1', 'A complete document title')
        expect(onOpenDraft).not.toHaveBeenCalled()

        await act(async () => {
          finishSave()
        })
        expect(onOpenDraft).toHaveBeenCalledExactlyOnceWith('draft-1')
        expect(onOpenDraft).toHaveReturnedWith('A complete document title')

        await act(async () => {
          vi.runAllTimers()
        })
        expect(onUpdateDraftName).toHaveBeenCalledTimes(1)
      } finally {
        cleanup(root, container)
        vi.useRealTimers()
      }
    },
  )

  it('opens the inline draft card on Enter without bubbling to parent handlers', async () => {
    const onOpenDraft = vi.fn()
    const onUpdateDraftName = vi.fn()
    const onParentKeyDown = vi.fn()
    const {container, root} = renderNode(
      <div onKeyDown={onParentKeyDown}>
        <InlineDraftCard
          draft={draft}
          onOpenDraft={onOpenDraft}
          onUpdateDraftName={onUpdateDraftName}
          onDeleteDraft={vi.fn()}
        />
      </div>,
    )

    try {
      await act(async () => pressEnter(container.querySelector('input')!))

      expect(onUpdateDraftName).toHaveBeenCalledWith('draft-1', 'Draft title')
      expect(onOpenDraft).toHaveBeenCalledWith('draft-1')
      expect(onParentKeyDown).not.toHaveBeenCalled()
    } finally {
      cleanup(root, container)
    }
  })

  it('opens the inline draft list item on Enter without bubbling to parent handlers', async () => {
    const onOpenDraft = vi.fn()
    const onUpdateDraftName = vi.fn()
    const onParentKeyDown = vi.fn()
    const {container, root} = renderNode(
      <div onKeyDown={onParentKeyDown}>
        <InlineDraftListItem
          draft={draft}
          onOpenDraft={onOpenDraft}
          onUpdateDraftName={onUpdateDraftName}
          onDeleteDraft={vi.fn()}
        />
      </div>,
    )

    try {
      await act(async () => pressEnter(container.querySelector('input')!))

      expect(onUpdateDraftName).toHaveBeenCalledWith('draft-1', 'Draft title')
      expect(onOpenDraft).toHaveBeenCalledWith('draft-1')
      expect(onParentKeyDown).not.toHaveBeenCalled()
    } finally {
      cleanup(root, container)
    }
  })
})
