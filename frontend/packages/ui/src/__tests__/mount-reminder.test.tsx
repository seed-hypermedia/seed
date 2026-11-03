// @vitest-environment jsdom
import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import type {AgentInfo} from '../agents/client'
;(globalThis as typeof globalThis & {React?: typeof React}).React = React
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

/**
 * The assistant panel's sticky "give your agents a home" card.
 *
 * Agents became documents and the pages that listed them are gone, so this card is the one place a
 * user with agents from before finds them to mount. It must show exactly the agents that need it
 * (owned, legacy id, mountable server), never flash while lists load, and vanish once nothing is
 * left, so a new account never sees it.
 */

const mocks = vi.hoisted(() => ({
  open: vi.fn(),
  navigate: vi.fn(),
}))

vi.mock('../agents/platform', () => ({getAgentsPlatform: () => ({useAccountUid: () => 'alice'})}))
vi.mock('../agents/models', () => ({
  describeAgentServer: (url: string) => url.replace(/^https?:\/\//, ''),
  useLocalAgentServerUrl: () => ({data: null}),
}))
vi.mock('../agents/navigation', () => ({useNavigate: () => mocks.navigate}))
vi.mock('../universal-dialog', () => ({useAppDialog: () => ({open: mocks.open, content: null})}))
vi.mock('../toast', () => ({toast: {success: vi.fn(), error: vi.fn()}}))
vi.mock('@shm/shared/models/query-client', () => ({invalidateQueries: vi.fn()}))

import {AgentMountReminder} from '../agents/mount-reminder'
import {unmountedOwnedAgents} from '../agents/mount'

const agent = (id: string, name: string, accessRole: AgentInfo['accessRole'] = 'owner'): AgentInfo =>
  ({id, accessRole, definition: {name}}) as AgentInfo

const HOSTED = 'https://agents.example.com'

describe('unmountedOwnedAgents', () => {
  it('keeps owned legacy agents on mountable servers only', () => {
    const options = [
      {serverUrl: HOSTED, agent: agent('legacy', 'Scout')},
      {serverUrl: HOSTED, agent: agent('hm://z6Mk/scout', 'Mounted')},
      {serverUrl: HOSTED, agent: agent('shared', 'Shared', 'collaborator')},
      {serverUrl: 'ws://agents.example.com', agent: agent('odd', 'Odd server')},
    ]
    expect(unmountedOwnedAgents(options).map((o) => o.agent.id)).toEqual(['legacy'])
  })
})

describe('AgentMountReminder', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    vi.clearAllMocks()
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  function render(props: React.ComponentProps<typeof AgentMountReminder>) {
    act(() => root.render(<AgentMountReminder {...props} />))
  }

  function buttons(name: string) {
    return Array.from(container.querySelectorAll('button')).filter((b) => b.textContent?.trim() === name)
  }

  it('shows nothing while lists load, for a new account, or once everything is mounted', () => {
    render({agents: [{serverUrl: HOSTED, agent: agent('legacy', 'Scout')}], settled: false})
    expect(container.textContent).toBe('')
    render({agents: [], settled: true})
    expect(container.textContent).toBe('')
    render({agents: [{serverUrl: HOSTED, agent: agent('hm://z6Mk/scout', 'Scout')}], settled: true})
    expect(container.textContent).toBe('')
  })

  it('lists each owned orphan agent with an Adopt button that opens the destination dialog', () => {
    render({
      agents: [
        {serverUrl: HOSTED, agent: agent('legacy-1', 'Scout')},
        {serverUrl: HOSTED, agent: agent('legacy-2', 'Editor')},
        {serverUrl: HOSTED, agent: agent('shared', 'Shared', 'collaborator')},
      ],
      settled: true,
    })
    expect(container.textContent).toContain('Give your orphan agents a home')
    expect(container.textContent).toContain('2 agents you own live in no space yet')
    expect(container.textContent).toContain('Scout')
    expect(container.textContent).toContain('Editor')
    expect(container.textContent).not.toContain('Shared')
    expect(buttons('Adopt')).toHaveLength(2)

    act(() => buttons('Adopt')[0]!.click())
    expect(mocks.open).toHaveBeenCalledWith(
      expect.objectContaining({
        serverUrl: HOSTED,
        accountUid: 'alice',
        agent: expect.objectContaining({id: 'legacy-1'}),
      }),
    )
    // Mounting from the panel keeps the user in the panel: no navigation to the new document.
    expect(mocks.navigate).not.toHaveBeenCalled()
  })

  it('folds to a one-line count and back, and reveals a long list on demand', () => {
    render({
      agents: Array.from({length: 6}, (_, i) => ({serverUrl: HOSTED, agent: agent(`legacy-${i}`, `Agent ${i}`)})),
      settled: true,
    })
    expect(buttons('Adopt')).toHaveLength(4)
    act(() => buttons('Show all 6')[0]!.click())
    expect(buttons('Adopt')).toHaveLength(6)

    act(() => container.querySelector<HTMLButtonElement>('button[aria-label="Hide orphan agents"]')!.click())
    expect(container.textContent).toContain('6 agents to adopt')
    expect(buttons('Adopt')).toHaveLength(0)
    act(() => container.querySelector<HTMLButtonElement>('button[aria-label="Show orphan agents"]')!.click())
    expect(buttons('Adopt')).toHaveLength(6)
  })
})
