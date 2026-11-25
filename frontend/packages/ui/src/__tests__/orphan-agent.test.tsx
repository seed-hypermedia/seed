// @vitest-environment jsdom
import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {UniversalAppProvider} from '@shm/shared/routing'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import type {MenuItemType} from '../options-dropdown'
;(globalThis as typeof globalThis & {React?: typeof React}).React = React
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

/**
 * "Orphan agent" is a developer tool for undoing an adoption. It must never show outside developer
 * mode, on a document that is not a mounted agent, or to anybody but the agent's owner: orphaning
 * deletes the document and changes the agent's id for everyone who links to it.
 */

const mocks = vi.hoisted(() => ({
  open: vi.fn(),
  agent: null as null | {id: string; accessRole: string; definition: {name: string}},
}))

vi.mock('../agents/platform', () => ({getAgentsPlatform: () => ({useAccountUid: () => 'alice'})}))
vi.mock('../agents/models', () => ({
  describeAgentServer: (url: string) => url,
  useAgentDetail: () => ({data: mocks.agent ? {agent: mocks.agent} : undefined}),
  useLocalAgentServerUrl: () => ({data: null}),
  useUnmountAgent: () => ({mutateAsync: vi.fn()}),
}))
vi.mock('../agents/navigation', () => ({useNavigate: () => vi.fn()}))
vi.mock('../universal-dialog', () => ({useAppDialog: () => ({open: mocks.open, content: null})}))

import {useOrphanAgentMenu} from '../agents/orphan-agent'

const docId = hmId('z6MkSpace', {path: ['scout']})
const metadata = {type: 'hm://hyper.media/agent', agentServerUrl: 'https://agents.example.com'} as any

describe('useOrphanAgentMenu', () => {
  let container: HTMLDivElement
  let root: Root
  let item: MenuItemType | null = null

  function Probe() {
    item = useOrphanAgentMenu(docId, metadata).item
    return null
  }

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    item = null
    vi.clearAllMocks()
    mocks.agent = {id: docId.id, accessRole: 'owner', definition: {name: 'Scout'}}
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  function render(developerTools: boolean) {
    act(() =>
      root.render(
        <UniversalAppProvider
          openRoute={vi.fn()}
          openUrl={vi.fn()}
          origin="http://localhost:3000"
          universalClient={{request: vi.fn()} as any}
          experiments={{developerTools}}
        >
          <Probe />
        </UniversalAppProvider>,
      ),
    )
  }

  it('offers the item only in developer mode', () => {
    render(false)
    expect(item).toBeNull()
    render(true)
    expect(item?.label).toBe('Orphan agent')
    act(() => item!.onClick!({} as never))
    expect(mocks.open).toHaveBeenCalledWith(
      expect.objectContaining({serverUrl: 'https://agents.example.com', accountUid: 'alice', docId}),
    )
  })

  it('hides the item for a collaborator and for a document the server does not confirm', () => {
    mocks.agent = {id: docId.id, accessRole: 'collaborator', definition: {name: 'Scout'}}
    render(true)
    expect(item).toBeNull()
    mocks.agent = {id: 'legacy-other', accessRole: 'owner', definition: {name: 'Scout'}}
    render(true)
    expect(item).toBeNull()
    mocks.agent = null
    render(true)
    expect(item).toBeNull()
  })
})
