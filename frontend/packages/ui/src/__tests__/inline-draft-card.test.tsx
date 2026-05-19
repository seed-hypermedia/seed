// @vitest-environment jsdom
import React from 'react'
import {createRoot, Root} from 'react-dom/client'
;(globalThis as typeof globalThis & {React?: typeof React}).React = React
import {act} from 'react-dom/test-utils'
import {describe, expect, it, vi} from 'vitest'
import {InlineDraftCard} from '../inline-draft-card'
import {InlineDraftListItem} from '../inline-draft-list-item'
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
  it('opens the inline draft card on Enter without bubbling to parent handlers', () => {
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
      pressEnter(container.querySelector('input')!)

      expect(onUpdateDraftName).toHaveBeenCalledWith('draft-1', 'Draft title')
      expect(onOpenDraft).toHaveBeenCalledWith('draft-1')
      expect(onParentKeyDown).not.toHaveBeenCalled()
    } finally {
      cleanup(root, container)
    }
  })

  it('opens the inline draft list item on Enter without bubbling to parent handlers', () => {
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
      pressEnter(container.querySelector('input')!)

      expect(onUpdateDraftName).toHaveBeenCalledWith('draft-1', 'Draft title')
      expect(onOpenDraft).toHaveBeenCalledWith('draft-1')
      expect(onParentKeyDown).not.toHaveBeenCalled()
    } finally {
      cleanup(root, container)
    }
  })
})
