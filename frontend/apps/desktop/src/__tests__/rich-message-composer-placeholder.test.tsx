import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

/**
 * The agent composer names who a chat is with in its empty editor ("Chat with Alpha", "Start a chat
 * with Alpha"). The block editor draws that text from a CSS variable, so the composer's job is to
 * set it on the editor's wrapper, quoted as a CSS string.
 */

vi.mock('@shm/ui/agents/platform', () => {
  const React = require('react')
  return {
    getAgentsPlatform: () => ({CommentEditor: () => React.createElement('div', {'data-testid': 'editor'})}),
    setAgentsPlatform: vi.fn(),
  }
})
vi.mock('@shm/ui/tooltip', () => ({Tooltip: ({children}: {children: React.ReactNode}) => children}))
vi.mock('@/trpc', () => ({client: {}}))
vi.mock('@/grpc-client', () => ({grpcClient: {}}))

import {AgentRichMessageComposer} from '@shm/ui/agents/rich-message-composer'

let container: HTMLDivElement
let root: Root

function render(placeholder?: string) {
  act(() => {
    root.render(
      <AgentRichMessageComposer
        isBusy={false}
        isStreaming={false}
        stopPending={false}
        serverUrl="https://agents.example"
        accountId="account-1"
        canInvokeTools={false}
        placeholder={placeholder}
        onSend={vi.fn()}
        onStop={vi.fn()}
      />,
    )
  })
  return container.querySelector('[data-testid="editor"]')?.parentElement as HTMLElement
}

beforeEach(() => {
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('AgentRichMessageComposer placeholder', () => {
  it('hands the editor its empty-state text through the placeholder variable', () => {
    const wrapper = render('Chat with Alpha')
    expect(wrapper.style.getPropertyValue('--hm-editor-placeholder')).toBe('"Chat with Alpha"')
  })

  it('quotes names that would break a bare CSS string', () => {
    const wrapper = render('Chat with "Q" Bot')
    expect(wrapper.style.getPropertyValue('--hm-editor-placeholder')).toBe('"Chat with \\"Q\\" Bot"')
  })

  it("leaves the editor's own hint when no placeholder is given", () => {
    const wrapper = render()
    expect(wrapper.style.getPropertyValue('--hm-editor-placeholder')).toBe('')
  })
})
