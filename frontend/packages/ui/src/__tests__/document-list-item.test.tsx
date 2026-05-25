// @vitest-environment jsdom
import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import type {HMDocumentInfo} from '@seed-hypermedia/client/hm-types'
import {DocumentActionsProvider} from '@shm/shared/document-actions-context'
import {UniversalAppProvider} from '@shm/shared/routing'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {DocumentListItem} from '../document-list-item'
;(globalThis as typeof globalThis & {React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean}).React = React
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@shm/shared/models/interaction-summary', () => ({
  useInteractionSummary: () => ({data: null}),
}))

vi.mock('@shm/shared/utils/navigation', () => ({
  useNavigate: () => vi.fn(),
}))

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

function makeItem(name: string): HMDocumentInfo {
  const id = hmId('uid-1', {path: ['doc']})
  return {
    type: 'document',
    id,
    path: id.path,
    authors: ['uid-1'],
    createTime: '2024-01-01T00:00:00Z',
    updateTime: '2024-01-01T00:00:00Z',
    sortTime: new Date('2024-01-01T00:00:00Z'),
    genesis: 'genesis',
    version: 'version-1',
    metadata: {name},
    visibility: 'PUBLIC',
  } as HMDocumentInfo
}

function renderDocumentListItem(getDraft?: (id: ReturnType<typeof hmId>) => any) {
  const item = makeItem('Published title')
  act(() => {
    root.render(
      <UniversalAppProvider openRoute={vi.fn()} openUrl={vi.fn()} universalClient={{request: vi.fn()} as any}>
        <DocumentActionsProvider getDraft={getDraft}>
          <DocumentListItem item={item} />
        </DocumentActionsProvider>
      </UniversalAppProvider>,
    )
  })
}

describe('DocumentListItem draft metadata', () => {
  it('prefers the local draft title and shows draft state', () => {
    renderDocumentListItem(() => ({
      id: 'draft-1',
      metadata: {name: 'Draft list title'},
    }))

    expect(container.textContent).toContain('Draft list title')
    expect(container.textContent).not.toContain('Published title')
    expect(container.textContent).toContain('Draft')
  })
})
