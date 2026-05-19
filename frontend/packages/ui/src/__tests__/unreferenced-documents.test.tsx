// @vitest-environment jsdom
import React from 'react'
import {createRoot, Root} from 'react-dom/client'
;(globalThis as typeof globalThis & {React?: typeof React}).React = React
import {act} from 'react-dom/test-utils'
import type {HMBlockNode, HMDocumentInfo, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

const canSeePrivateDocsMock = vi.hoisted(() => vi.fn(() => false))

vi.mock('@shm/shared/models/capabilities', () => ({
  useCanSeePrivateDocs: canSeePrivateDocsMock,
}))

vi.mock('../document-list-item', async () => {
  const React = await import('react')
  return {
    DocumentListItem: ({item}: {item: HMDocumentInfo}) =>
      React.createElement('div', {'data-testid': 'document-list-item'}, item.metadata.name || item.id.id),
  }
})

import {UnreferencedDocuments} from '../unreferenced-documents'
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

function makeId(uid: string, path?: string[]): UnpackedHypermediaId {
  const restPath = path?.length ? `/${path.join('/')}` : ''
  return {
    uid,
    path: path ?? null,
    version: null,
    blockRef: null,
    blockRange: null,
    hostname: null,
    scheme: null,
    latest: null,
    id: `hm://${uid}${restPath}`,
  }
}

function makeDocInfo(uid: string, path: string[], name: string): HMDocumentInfo {
  return {
    type: 'document',
    id: makeId(uid, path),
    path,
    authors: [uid],
    createTime: '2024-01-01T00:00:00Z',
    updateTime: '2024-01-01T00:00:00Z',
    sortTime: new Date('2024-01-01T00:00:00Z'),
    genesis: 'genesis',
    version: 'v1',
    breadcrumbs: [],
    activitySummary: {
      commentCount: 0,
      latestCommentId: '',
      latestChangeTime: '2024-01-01T00:00:00Z',
      isUnread: false,
    },
    generationInfo: {genesis: 'genesis', generation: 1n},
    metadata: {name},
    visibility: 'PUBLIC',
  }
}

function makeBlock(block: any, children?: HMBlockNode[]): HMBlockNode {
  return {block, children}
}

describe('UnreferencedDocuments', () => {
  let rendered: {container: HTMLDivElement; root: Root} | undefined

  beforeEach(() => {
    canSeePrivateDocsMock.mockReturnValue(false)
  })

  afterEach(() => {
    if (rendered) {
      cleanup(rendered.root, rendered.container)
      rendered = undefined
    }
  })

  it('renders unreferenced documents immediately without a section label or collapse control', () => {
    rendered = renderNode(
      <UnreferencedDocuments
        docId={makeId('uid1')}
        content={[makeBlock({type: 'Embed', id: 'embed-1', link: 'hm://uid1/linked-child', attributes: {}})]}
        directory={[
          makeDocInfo('uid1', ['linked-child'], 'Linked Child'),
          makeDocInfo('uid1', ['loose-child'], 'Loose Child'),
        ]}
      />,
    )

    expect(rendered.container.querySelectorAll('[data-testid="document-list-item"]')).toHaveLength(1)
    expect(rendered.container.textContent).toContain('Loose Child')
    expect(rendered.container.textContent).not.toContain('Linked Child')
    expect(rendered.container.textContent).not.toContain('Unreferenced Documents')
    expect(rendered.container.querySelector('button')).toBeNull()
  })

  it('returns null when there are no directory items', () => {
    rendered = renderNode(<UnreferencedDocuments docId={makeId('uid1')} content={[]} directory={[]} />)

    expect(rendered.container.innerHTML).toBe('')
  })

  it('returns null when all directory items are already referenced', () => {
    rendered = renderNode(
      <UnreferencedDocuments
        docId={makeId('uid1')}
        content={[makeBlock({type: 'Embed', id: 'embed-1', link: 'hm://uid1/linked-child', attributes: {}})]}
        directory={[makeDocInfo('uid1', ['linked-child'], 'Linked Child')]}
      />,
    )

    expect(rendered.container.innerHTML).toBe('')
  })

  it('returns null when the document already has a self-targeting query block', () => {
    rendered = renderNode(
      <UnreferencedDocuments
        docId={makeId('uid1')}
        content={[
          makeBlock({
            type: 'Query',
            id: 'query-1',
            attributes: {
              query: {
                includes: [{space: 'uid1', path: '', mode: 'Children'}],
              },
            },
          }),
        ]}
        directory={[makeDocInfo('uid1', ['loose-child'], 'Loose Child')]}
      />,
    )

    expect(rendered.container.innerHTML).toBe('')
  })
})
