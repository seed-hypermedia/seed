// @vitest-environment jsdom
import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
;(globalThis as typeof globalThis & {React?: typeof React}).React = React
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const {machineMock, sendMock, navMock, routeLinkMock} = vi.hoisted(() => ({
  machineMock: {
    draftHidden: false,
    publishedVersion: 'bafypublished' as string | null,
  },
  sendMock: vi.fn(),
  navMock: {route: null as any},
  routeLinkMock: vi.fn((_route: any, opts?: {onClick?: () => void}) => ({
    href: '/hm/doc',
    tag: 'a',
    onClick: (e: any) => {
      opts?.onClick?.()
      e?.preventDefault?.()
    },
  })),
}))

vi.mock('@shm/shared/models/use-document-machine', () => ({
  useDocumentSelector: (selector: (snapshot: any) => any) =>
    selector({
      context: {
        draftHidden: machineMock.draftHidden,
        publishedVersion: machineMock.publishedVersion,
      },
    }),
  useDocumentSend: () => sendMock,
  selectDraftHidden: (s: any) => s.context.draftHidden,
  selectPublishedVersion: (s: any) => s.context.publishedVersion,
}))

vi.mock('@shm/shared/utils/navigation', () => ({
  useNavRoute: () => navMock.route,
}))

vi.mock('@shm/shared/routing', () => ({
  useRouteLink: (route: any, opts?: any) => routeLinkMock(route, opts),
}))

vi.mock('../tooltip', async () => {
  const React = await import('react')
  return {
    Tooltip: ({children}: {children: React.ReactNode}) => React.createElement(React.Fragment, null, children),
  }
})

import {DraftVersionItem} from '../feed'

const draft = {
  docId: hmId('alice', {path: ['my-doc']}),
  draftId: 'draft-1',
  deps: ['bafypublished'],
}

function latestDocRoute() {
  return {key: 'document', id: hmId('alice', {path: ['my-doc']})}
}

describe('DraftVersionItem', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    machineMock.draftHidden = false
    machineMock.publishedVersion = 'bafypublished'
    navMock.route = latestDocRoute()
    sendMock.mockReset()
    routeLinkMock.mockClear()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  function render() {
    act(() => {
      root.render(<DraftVersionItem draft={draft} hasNewerPublishedVersion={false} />)
    })
  }

  it('offers a published preview on the draft-visible route and toggles it', () => {
    render()
    const button = container.querySelector('button[aria-label="Preview published version"]') as HTMLButtonElement
    expect(button).not.toBeNull()

    act(() => {
      button.click()
    })
    expect(sendMock).toHaveBeenCalledWith({type: 'draftHidden.set', hidden: true})
  })

  it('shows the un-hide affordance while the draft is hidden', () => {
    machineMock.draftHidden = true
    render()
    const button = container.querySelector('button[aria-label="Show draft changes"]') as HTMLButtonElement
    expect(button).not.toBeNull()

    act(() => {
      button.click()
    })
    expect(sendMock).toHaveBeenCalledWith({type: 'draftHidden.set', hidden: false})
  })

  it('un-hides when the row itself is clicked while hidden', () => {
    machineMock.draftHidden = true
    render()
    const opts = routeLinkMock.mock.calls[0]?.[1] as {onClick?: () => void}
    act(() => {
      opts?.onClick?.()
    })
    expect(sendMock).toHaveBeenCalledWith({type: 'draftHidden.set', hidden: false})
  })

  it('offers no preview while viewing a pinned old version', () => {
    navMock.route = {key: 'document', id: hmId('alice', {path: ['my-doc'], version: 'bafyold'})}
    render()
    expect(container.querySelector('button[aria-label="Preview published version"]')).toBeNull()
    expect(container.querySelector('button[aria-label="Show draft changes"]')).toBeNull()
  })

  it('offers no preview when the document was never published', () => {
    machineMock.publishedVersion = null
    render()
    expect(container.querySelector('button[aria-label="Preview published version"]')).toBeNull()
  })
})
