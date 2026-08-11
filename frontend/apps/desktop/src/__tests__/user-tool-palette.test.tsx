// @vitest-environment jsdom
import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, describe, expect, it, vi} from 'vitest'

const mutateAsync = vi.fn(async () => ({_: 'InvokeSessionToolResponse', sessionId: 's1', resultEventId: 'e1'}))
const healthData = {webTools: {search: true, readBrowser: true}, codeExec: false}
vi.mock('@/models/agents', () => ({
  useInvokeSessionTool: () => ({mutateAsync, isPending: false}),
  useAgentServerHealth: () => ({data: healthData}),
}))
vi.mock('@shm/ui/toast', () => ({toast: {error: vi.fn(), success: vi.fn()}}))

import {UserToolPalette} from '../pages/agents/user-tool-palette'

function render() {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(
      <UserToolPalette serverUrl="http://localhost:3050" accountId="z6MkTest" sessionId="s1" agentTools={undefined} />,
    )
  })
  return {container, root}
}

function cleanup(root: Root, container: HTMLDivElement) {
  act(() => root.unmount())
  container.remove()
}

function click(element: Element | null | undefined) {
  act(() => {
    element?.dispatchEvent(new MouseEvent('click', {bubbles: true}))
  })
}

function findByText(text: string): HTMLElement | undefined {
  return Array.from(document.body.querySelectorAll('button, span')).find(
    (element) => element.textContent === text,
  ) as HTMLElement | undefined
}

afterEach(() => {
  mutateAsync.mockClear()
  document.body.innerHTML = ''
})

describe('UserToolPalette', () => {
  it('runs a read as the user with the typed address', async () => {
    const {container, root} = render()
    click(container.querySelector('button'))
    click(findByText('Read'))
    const input = document.body.querySelector('input')
    expect(input).toBeTruthy()
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, '~/memory/notes.md')
      input!.dispatchEvent(new Event('input', {bubbles: true}))
    })
    const form = document.body.querySelector('form')
    act(() => {
      form!.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}))
    })
    await act(async () => {})
    expect(mutateAsync).toHaveBeenCalledWith({
      sessionId: 's1',
      verb: 'read',
      input: {address: '~/memory/notes.md'},
    })
    cleanup(root, container)
  })

  it('shows a loading state instead of granting all callables while the agent definition loads', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    act(() => {
      root.render(
        <UserToolPalette
          serverUrl="http://localhost:3050"
          accountId="z6MkTest"
          sessionId="s1"
          agentTools={undefined}
          agentToolsLoading
        />,
      )
    })
    click(container.querySelector('button'))
    expect(document.body.textContent).toContain("Loading this agent's tools")
    expect(findByText('Web Search')).toBeUndefined()
    cleanup(root, container)
  })

  it('hides execute when the server reports code execution unavailable', () => {
    const {container, root} = render()
    click(container.querySelector('button'))
    expect(findByText('Web Search')).toBeTruthy()
    expect(findByText('Execute Code')).toBeUndefined()
    cleanup(root, container)
  })

  it('routes a callable through the call verb envelope', async () => {
    const {container, root} = render()
    click(container.querySelector('button'))
    click(findByText('Web Search'))
    const input = document.body.querySelector('input')
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, 'bun release')
      input!.dispatchEvent(new Event('input', {bubbles: true}))
    })
    const form = document.body.querySelector('form')
    act(() => {
      form!.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}))
    })
    await act(async () => {})
    expect(mutateAsync).toHaveBeenCalledWith({
      sessionId: 's1',
      verb: 'call',
      input: {tool: 'web_search', input: {query: 'bun release'}},
    })
    cleanup(root, container)
  })
})
