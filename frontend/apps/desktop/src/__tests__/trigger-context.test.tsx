import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import type {AgentSessionTriggerContext} from '@shm/ui/agents/client'

const navigate = vi.hoisted(() => vi.fn())
const openUrl = vi.hoisted(() => vi.fn())
vi.mock('@shm/ui/agents/navigation', () => ({useNavigate: () => navigate, useOpenUrl: () => openUrl}))

vi.mock('@shm/shared/models/entity', () => ({
  useAccount: () => ({data: null}),
  useResource: () => ({data: {type: 'document', document: {metadata: {name: 'Project plan'}}}}),
}))

import {TriggerContextView} from '@shm/ui/agents/trigger-types'

const context: AgentSessionTriggerContext = {
  triggerId: 'trigger-1',
  triggerName: 'Review new comments',
  firingId: 'firing-1',
  activityKey: 'comment-1',
  activitySummary: 'A new comment on the project plan',
  source: {type: 'document-comment', resource: 'hm://z6MkDoc/plan'},
  firedAt: 1_700_000_000_000,
  prompt: 'Review the comment and reply.',
  activity: {newBlob: {blobType: 'Comment', resource: 'hm://z6MkDoc/plan', blobId: 'author/comment-1'}},
  status: 'fired',
}
let container: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  navigate.mockClear()
  openUrl.mockClear()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function render(triggerContext = context) {
  act(() => {
    root.render(
      <TriggerContextView
        context={triggerContext}
        instructions="Reply in the original thread."
        serverUrl="https://agents.example"
        agentId="agent-1"
      />,
    )
  })
}

function button(label: string) {
  const match = Array.from(container.querySelectorAll('button')).find((node) => node.textContent === label)
  if (!match) throw new Error(`Missing button: ${label}`)
  return match
}

describe('trigger transcript row', () => {
  it('shows attribution and links to the trigger and the exact triggering activity', () => {
    render()
    expect(container.textContent).toContain('Triggered by')
    expect(container.textContent).toContain(context.triggerName)
    expect(container.textContent).toContain(context.activitySummary)
    expect(container.textContent).toContain('Fired')
    expect(container.querySelector('pre')).toBeNull()
    act(() => button(context.triggerName).click())
    expect(navigate).toHaveBeenLastCalledWith({
      key: 'agent',
      agentId: 'agent-1',
      serverUrl: 'https://agents.example',
      tab: 'triggers',
      triggerId: 'trigger-1',
    })
    act(() => button(context.activitySummary).click())
    expect(navigate).toHaveBeenLastCalledWith(
      expect.objectContaining({key: 'comments', openComment: 'author/comment-1'}),
    )
  })

  it('reveals the prompt, firing details, activity payload, and instructions on demand', () => {
    render()
    for (const label of ['Trigger prompt', 'Activity details', 'Trigger instructions']) {
      expect(button(label).getAttribute('aria-expanded')).toBe('false')
      act(() => button(label).click())
      expect(button(label).getAttribute('aria-expanded')).toBe('true')
    }
    expect(container.textContent).toContain(context.prompt)
    expect(container.textContent).toContain(context.firingId)
    expect(container.textContent).toContain(context.activityKey)
    expect(container.querySelector('pre')?.textContent).toBe(JSON.stringify(context.activity, null, 2))
    expect(container.textContent).toContain('Reply in the original thread.')
    act(() => button('Activity details').click())
    expect(container.querySelector('pre')).toBeNull()
  })

  it('shows errors and leaves activity without a destination as plain text', () => {
    render({...context, source: {type: 'webhook'}, activity: {}, status: 'failed', error: 'Tool call failed'})
    expect(container.textContent).toContain('Status: failed')
    expect(container.textContent).toContain('Tool call failed')
    expect(
      Array.from(container.querySelectorAll('button')).some((node) => node.textContent === context.activitySummary),
    ).toBe(false)
  })
})
