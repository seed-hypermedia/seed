// @vitest-environment jsdom
import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {hmId} from '@shm/shared/utils/entity-id-url'
import type {HMDocument} from '@seed-hypermedia/client/hm-types'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {ToolRunSection} from '../apps/running'
;(globalThis as typeof globalThis & {React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean}).React = React
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const appId = hmId('alice', {path: ['weather']})
const toolId = hmId('alice', {path: ['weather', 'forecast']})

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  navigate: vi.fn(),
  schema: undefined as unknown,
}))
vi.mock('@shm/shared/utils/navigation', () => ({useNavigate: () => mocks.navigate}))
vi.mock('../hm-icon', () => ({HMIcon: () => null}))
vi.mock('@shm/shared/routing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shm/shared/routing')>()),
  useUniversalAppContext: () => ({selectedIdentity: {get: () => 'alice', subscribe: () => () => {}}}),
}))
vi.mock('@shm/shared/use-stream', () => ({useStream: (stream: {get: () => unknown}) => stream?.get()}))
vi.mock('@shm/shared/models/entity', () => ({
  useResource: () => ({data: undefined, isInitialLoading: false}),
  useAccount: () => ({data: {metadata: {name: 'Alice'}}}),
}))
vi.mock('../agents/client', () => ({sendAgentAction: mocks.send}))
vi.mock('../schema/schema-resolve', () => ({
  useResolvedSchema: () => ({schema: mocks.schema, registry: {}, isLoading: false}),
}))
vi.mock('../toast', () => ({toast: {success: vi.fn(), error: vi.fn()}}))

const app = {
  metadata: {name: 'Weather', type: 'hm://hyper.media/app', appEnvironmentUrl: 'http://apps.test'},
} as unknown as HMDocument

// jsdom has no ResizeObserver, which the optional-field switch measures itself with.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver

let root: Root
let container: HTMLDivElement
beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  mocks.send.mockReset()
  mocks.schema = {
    type: 'hm://hyper.media/struct',
    properties: {city: {value: {type: 'hm://hyper.media/string'}, required: true}},
  }
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

async function render(running: boolean) {
  mocks.send.mockImplementation(async ({action}: {action: {_: string}}) => {
    if (action._ === 'GetAppRun') return {run: running ? {appId: appId.id, privateConfigKeys: []} : null}
    if (action._ === 'ListAppToolCalls')
      return {
        calls: [
          {
            id: 'old',
            appId: appId.id,
            toolId: toolId.id,
            caller: 'z6MkAliceAliceAliceAliceAliceAliceAlice',
            input: {city: 'Porto'},
            output: {},
            createdAt: 1,
          },
        ],
      }
    if (action._ === 'CallAppTool')
      return {
        call: {
          id: 'c1',
          appId: appId.id,
          toolId: toolId.id,
          caller: 'alice',
          input: {city: 'Lisbon'},
          output: {temp: 21},
          durationMs: 5,
          createdAt: 1,
        },
      }
    throw new Error(`unexpected ${action._}`)
  })
  const client = new QueryClient({defaultOptions: {queries: {retry: false}}})
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <ToolRunSection
          appId={appId}
          app={app}
          toolId={toolId}
          inputSchemaRef="ipfs://schema"
          onOpenSettings={() => {}}
        />
      </QueryClientProvider>,
    )
  })
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10))
  })
}

describe('ToolRunSection', () => {
  it('shows the input form and Run while the app runs, and the result after a call', async () => {
    await render(true)
    const input = container.querySelector<HTMLInputElement>('input[aria-label="city"]')
    expect(input).not.toBeNull()
    const run = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('Run'))
    expect(run).toBeDefined()
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, 'Lisbon')
      input!.dispatchEvent(new Event('input', {bubbles: true}))
    })
    await act(async () => {
      run!.click()
      await new Promise((resolve) => setTimeout(resolve, 10))
    })
    expect(mocks.send).toHaveBeenCalledWith(
      expect.objectContaining({action: expect.objectContaining({_: 'CallAppTool', input: {city: 'Lisbon'}})}),
    )
    expect(container.textContent).toContain('Succeeded')
    expect(container.textContent).toContain('21')
    // Past runs show who triggered them and open as their own page.
    expect(container.textContent).toContain('city: Porto')
    expect(container.textContent).toContain('Alice')
    const row = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('city: Porto'))
    await act(async () => row!.click())
    expect(mocks.navigate).toHaveBeenCalledWith({key: 'document', id: toolId, toolCallId: 'old'})
  })

  it('draws a list of objects as typed rows, and sends a real list', async () => {
    mocks.schema = {
      type: 'hm://hyper.media/struct',
      properties: {
        ingredients: {
          required: true,
          value: {
            type: 'hm://hyper.media/list',
            items: {
              type: 'hm://hyper.media/struct',
              properties: {
                name: {value: {type: 'hm://hyper.media/string'}, required: true},
                amount: {value: {type: 'hm://hyper.media/float'}},
              },
            },
          },
        },
      },
    }
    await render(true)
    const button = (text: string) =>
      Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.trim() === text)!
    await act(async () => button('+ item').click())
    const name = container.querySelector<HTMLInputElement>('input[aria-label="name"]')!
    expect(name).not.toBeNull()
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(name, 'flour')
      name.dispatchEvent(new Event('input', {bubbles: true}))
    })
    await act(async () => {
      button('Run').click()
      await new Promise((resolve) => setTimeout(resolve, 10))
    })
    expect(mocks.send).toHaveBeenCalledWith(
      expect.objectContaining({
        action: expect.objectContaining({_: 'CallAppTool', input: {ingredients: [{name: 'flour'}]}}),
      }),
    )
  })

  it('shows no form while the app is not running, only a way to its settings', async () => {
    await render(false)
    expect(container.textContent).toContain('This app is not running')
    expect(container.textContent).toContain('Run it from the app’s settings')
    // No form while the app is not running.
    expect(container.querySelector('input[aria-label="city"]')).toBeNull()
    expect(Array.from(container.querySelectorAll('button')).some((b) => b.textContent?.trim() === 'Run')).toBe(false)
  })
})
