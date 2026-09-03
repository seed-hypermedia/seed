// @vitest-environment jsdom
import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

const updateBlockMock = vi.hoisted(() => vi.fn())

vi.mock('./blocknote/react', () => ({
  createReactBlockSpec: (spec: any) => spec,
}))
vi.mock('./block-selection-wrapper', () => ({
  BlockSelectionWrapper: ({children}: {children: React.ReactNode}) => <>{children}</>,
}))
vi.mock('@shm/shared/routing', () => ({
  useUniversalClient: () => ({request: vi.fn()}),
}))
vi.mock('@shm/shared/models/use-editor-gate', () => ({
  useEditorGate: () => ({canEdit: false, beginEditIfNeeded: vi.fn()}),
}))
vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>()
  return {
    ...actual,
    useQuery: () => ({
      data: {
        results: [
          {
            type: 'document',
            id: {id: 'hm://table-note', uid: 'alice', path: ['table-note']},
            path: ['table-note'],
            authors: ['alice'],
            createTime: '2026-01-01T00:00:00Z',
            updateTime: '2026-01-02T00:00:00Z',
            sortTime: new Date('2026-01-02'),
            genesis: 'g',
            version: 'v',
            breadcrumbs: [],
            activitySummary: {commentCount: 0, latestCommentTime: null},
            generationInfo: {},
            metadata: {name: 'Visible Table Note'},
            visibility: 'PUBLIC',
          },
        ],
        interactionSummaries: {},
        accountsMetadata: {},
      },
      isLoading: false,
      status: 'success',
      fetchStatus: 'idle',
      error: null,
    }),
  }
})
vi.mock('@shm/ui/query-block-content', () => ({
  QueryBlockContent: ({style, items, onTableSortingChange}: any) => (
    <div data-style={style}>
      {items.map((item: any) => item.metadata.name).join(', ')}
      <button onClick={() => onTableSortingChange([{id: 'authors', desc: false}])}>Sort authors</button>
    </div>
  ),
}))

import {QueryBlock} from './query-block'

function RenderQueryBlock() {
  return QueryBlock.render({
    block: {
      id: 'q-table',
      props: {
        style: 'Table',
        queryIncludes: '[{"space":"alice","path":"","mode":"Children"}]',
        querySort: '[{"term":"updated","reverse":true}]',
        banner: 'false',
        columnCount: '3',
        tableConfig: '',
      },
    } as any,
    editor: {
      renderType: 'document',
      _tiptapEditor: {isEditable: false},
      updateBlock: updateBlockMock,
    } as any,
  })
}

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
  act(() => root.unmount())
  container.remove()
  updateBlockMock.mockClear()
})

describe('QueryBlock web table rendering', () => {
  it('mounts table view content immediately in the web document renderer', () => {
    act(() => {
      root.render(<RenderQueryBlock />)
    })

    expect(container.textContent).toContain('Visible Table Note')
  })

  it('persists table sorting as query sort', () => {
    act(() => {
      root.render(<RenderQueryBlock />)
    })

    const sortButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Sort authors',
    )
    act(() => sortButton?.dispatchEvent(new MouseEvent('click', {bubbles: true})))

    expect(updateBlockMock).toHaveBeenCalledWith('q-table', {
      props: {
        querySort: JSON.stringify([{term: 'authors', reverse: false}]),
      },
    })
  })
})
