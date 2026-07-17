// @vitest-environment jsdom
import React from 'react'
import {createRoot, Root} from 'react-dom/client'
;(globalThis as typeof globalThis & {React?: typeof React}).React = React
import {act} from 'react-dom/test-utils'
import {hmBlocksToEditorContent} from '@seed-hypermedia/client/hmblock-to-editorblock'
import {beforeEach, describe, expect, it, vi} from 'vitest'

const {selectMock, handlersRefMock} = vi.hoisted(() => ({
  selectMock: {
    blocks: [] as any[],
    document: null as any,
    draftId: null as string | null,
    editorBaseline: null as any,
    metadata: {} as Record<string, any>,
    navigation: undefined as any,
    saveStatus: 'idle' as 'idle' | 'changed' | 'saving' | 'saved',
  },
  handlersRefMock: {current: null as any},
}))

vi.mock('../use-document-machine', () => ({
  useDocumentSelector: (selector: (snapshot: any) => any) => {
    const snapshot = {
      context: {
        blocks: selectMock.blocks,
        document: selectMock.document,
        draftId: selectMock.draftId,
        editorBaseline: selectMock.editorBaseline,
        metadata: selectMock.metadata,
        navigation: selectMock.navigation,
      },
      matches: () => false,
    }
    return selector(snapshot)
  },
  selectBlocks: (s: any) => s.context.blocks,
  selectDocument: (s: any) => s.context.document,
  selectDraftId: (s: any) => s.context.draftId,
  selectEditorBaseline: (s: any) => s.context.editorBaseline,
  selectMetadata: (s: any) => s.context.metadata,
  selectNavigation: (s: any) => s.context.navigation,
  selectSaveStatus: () => selectMock.saveStatus,
}))

vi.mock('../editor-handlers-context', () => ({
  useEditorHandlersRef: () => handlersRefMock,
}))

vi.mock('../../utils/navigation-changes', () => ({
  getNavigationChanges: () => [],
}))

import {useUnpublishedChangeCount} from '../use-unpublished-change-count'
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

function paragraphBlock(text: string) {
  return [
    {
      block: {
        id: 'block-1',
        type: 'Paragraph',
        text,
        annotations: [],
        attributes: {},
      },
      children: [],
    },
  ]
}

function emptyParagraphBlock() {
  return [
    {
      id: 'empty-1',
      type: 'paragraph',
      props: {},
      content: [],
      children: [],
    },
  ]
}

function CountProbe() {
  const count = useUnpublishedChangeCount()
  return <div data-count={count} />
}

function renderProbe() {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(<CountProbe />)
  })
  return {container, root}
}

function cleanup(root: Root, container: HTMLDivElement) {
  act(() => {
    root.unmount()
  })
  container.remove()
}

describe('useUnpublishedChangeCount', () => {
  beforeEach(() => {
    selectMock.blocks = []
    selectMock.document = {detachedBlocks: {}}
    selectMock.draftId = null
    selectMock.editorBaseline = null
    selectMock.metadata = {}
    selectMock.navigation = undefined
    selectMock.saveStatus = 'idle'
    handlersRefMock.current = null
  })

  it('falls back to machine draft blocks before editor handlers are ready', () => {
    const baselineBlocks = hmBlocksToEditorContent(paragraphBlock('Published text') as any)
    selectMock.editorBaseline = baselineBlocks
    selectMock.blocks = paragraphBlock('Draft text')

    const {container, root} = renderProbe()
    try {
      expect(container.firstElementChild?.getAttribute('data-count')).toBe('1')
    } finally {
      cleanup(root, container)
    }
  })

  it('keeps comparing against published content when a draft exists', () => {
    selectMock.document = {
      content: paragraphBlock('Published text'),
      detachedBlocks: {},
    }
    selectMock.draftId = 'draft-1'
    selectMock.editorBaseline = hmBlocksToEditorContent(paragraphBlock('Draft text') as any)
    selectMock.blocks = paragraphBlock('Draft text')

    const {container, root} = renderProbe()
    try {
      expect(container.firstElementChild?.getAttribute('data-count')).toBe('1')
    } finally {
      cleanup(root, container)
    }
  })

  it('ignores a trailing empty paragraph placeholder for an unchanged empty document', () => {
    selectMock.document = {
      content: [],
      detachedBlocks: {},
    }
    selectMock.editorBaseline = []
    handlersRefMock.current = {
      getCurrentBlocks: () => emptyParagraphBlock(),
    }

    const {container, root} = renderProbe()
    try {
      expect(container.firstElementChild?.getAttribute('data-count')).toBe('0')
    } finally {
      cleanup(root, container)
    }
  })

  // Regression: after a publish, the machine's baseline is rebuilt from the
  // published document via `hmBlocksToEditorContent`, which represents an empty
  // trailing paragraph as `content: [{type: 'text', text: ''}]` — NOT `content: []`
  // like the live editor. If `removeTrailingEmptyParagraphs` only stripped the
  // `content: []` form, the two representations diffed into a permanent phantom
  // "delete", leaving the Publish button green forever after publishing.
  it('does not count a trailing empty paragraph that carries an empty text node (post-publish baseline shape)', () => {
    const contentBlock = {
      id: 'c1',
      type: 'paragraph',
      props: {},
      content: [{type: 'text', text: 'Hello', styles: {}}],
      children: [],
    }
    const trailingEmptyWithTextNode = {
      id: 'e1',
      type: 'paragraph',
      props: {},
      content: [{type: 'text', text: '', styles: {}}],
      children: [],
    }
    // No active draft: the diff baseline comes from `editorBaseline`, which is
    // what `updatePublishedVersion` sets from the freshly published document.
    selectMock.draftId = null
    selectMock.editorBaseline = [contentBlock, trailingEmptyWithTextNode] as any
    handlersRefMock.current = {
      getCurrentBlocks: () => [contentBlock],
    }

    const {container, root} = renderProbe()
    try {
      expect(container.firstElementChild?.getAttribute('data-count')).toBe('0')
    } finally {
      cleanup(root, container)
    }
  })
})
