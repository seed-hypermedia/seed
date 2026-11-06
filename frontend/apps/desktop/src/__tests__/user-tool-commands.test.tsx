// @vitest-environment jsdom
import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, describe, expect, it, vi} from 'vitest'

const mutateAsync = vi.fn(async () => ({_: 'InvokeSessionToolResponse', sessionId: 's1', resultEventId: 'e1'}))
const healthData = {webTools: {search: true, readBrowser: true}, codeExec: false}
vi.mock('@shm/ui/agents/models', () => ({
  useInvokeSessionTool: () => ({mutateAsync, isPending: false}),
  useAgentServerHealth: () => ({data: healthData}),
}))
vi.mock('@shm/ui/toast', () => ({toast: {error: vi.fn(), success: vi.fn()}}))

import {useUserToolCommands} from '@shm/ui/agents/user-tool-commands'

/** Renders the `/` menu's tool commands as buttons, as the editor's slash menu would list them. */
function Harness(props: Partial<Parameters<typeof useUserToolCommands>[0]>) {
  const {getSlashMenuItems, form} = useUserToolCommands({
    serverUrl: 'http://localhost:3050',
    accountId: 'z6MkTest',
    sessionId: 's1',
    agentTools: undefined,
    ...props,
  })
  return (
    <>
      <div data-testid="menu">
        {getSlashMenuItems().map((item) => (
          <button key={item.name} type="button" onClick={item.onSelect}>
            {item.name}
          </button>
        ))}
      </div>
      {form}
    </>
  )
}

function render(props: Partial<Parameters<typeof useUserToolCommands>[0]> = {}) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(<Harness {...props} />)
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
  return Array.from(document.body.querySelectorAll('button, span')).find((element) => element.textContent === text) as
    | HTMLElement
    | undefined
}

afterEach(() => {
  mutateAsync.mockClear()
  document.body.innerHTML = ''
})

describe('useUserToolCommands', () => {
  it('runs a read as the user with the typed address', async () => {
    const {container, root} = render()
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
    expect(document.body.querySelector('form')).toBeNull()
    cleanup(root, container)
  })

  it('leaves callables out instead of granting all while the agent definition loads', () => {
    const {container, root} = render({agentToolsLoading: true})
    expect(findByText('Read')).toBeTruthy()
    expect(findByText('Web Search')).toBeUndefined()
    cleanup(root, container)
  })

  it('hides execute when the server reports code execution unavailable', () => {
    const {container, root} = render()
    expect(findByText('Web Search')).toBeTruthy()
    expect(findByText('Execute Code')).toBeUndefined()
    cleanup(root, container)
  })

  it('offers no commands without a session to target or chat-only access', () => {
    const draft = render({sessionId: undefined})
    expect(draft.container.querySelector('[data-testid="menu"]')!.children).toHaveLength(0)
    cleanup(draft.root, draft.container)
    const chatOnly = render({enabled: false})
    expect(chatOnly.container.querySelector('[data-testid="menu"]')!.children).toHaveLength(0)
    cleanup(chatOnly.root, chatOnly.container)
  })

  it('keeps a form open but unable to run while blocked', async () => {
    const {container, root} = render({blockedReason: 'Wait for the agent to finish'})
    click(findByText('Read'))
    expect(document.body.textContent).toContain('Wait for the agent to finish')
    const run = Array.from(document.body.querySelectorAll('button')).find((b) => b.textContent === 'Run')
    expect(run?.disabled).toBe(true)
    cleanup(root, container)
  })

  it('routes a callable through the call verb envelope', async () => {
    const {container, root} = render()
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
