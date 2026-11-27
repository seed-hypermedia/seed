// @vitest-environment jsdom
import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {hmId} from '@shm/shared/utils/entity-id-url'
import type {HMDocument} from '@seed-hypermedia/client/hm-types'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {CreateToolDialog} from '../apps/create-dialogs'
;(globalThis as typeof globalThis & {React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean}).React = React
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  create: vi.fn(async (..._args: unknown[]) => {}),
}))

vi.mock('@shm/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shm/shared')>()),
  // No document exists yet at any path, so the tool takes its name's slug.
  useUniversalClient: () => ({request: vi.fn(async () => ({type: 'not-found'}))}),
}))
vi.mock('@shm/shared/utils/navigation', () => ({useNavigate: () => mocks.navigate}))
// The user knows servers and has a default one: a new app is offered it, a new tool is not.
vi.mock('../agents/models', () => ({
  useAgentServerOptions: () => ['http://mine.test'],
  useRememberAgentServer: () => ({mutate: vi.fn()}),
}))
vi.mock('../agents/server-picker', () => ({
  useCreateServerChoice: () => ({serverUrl: 'http://mine.test', setServerUrl: vi.fn()}),
  CreateServerChoice: ({value}: {value: string}) => <div data-testid="server-choice">Runs on {value}</div>,
}))
vi.mock('../components/dialog', () => ({
  DialogTitle: ({children}: {children: React.ReactNode}) => <h2>{children}</h2>,
  DialogDescription: ({children}: {children: React.ReactNode}) => <p>{children}</p>,
}))
vi.mock('../apps/publish', async (importOriginal) => ({
  // The free path under the parent is the real one: the tests check where a tool lands.
  ...(await importOriginal<typeof import('../apps/publish')>()),
  toolCodeFolder: async () => ({code: 'ipfs://bafycode', blobs: []}),
  useAppsPublisher: () => ({create: mocks.create}),
}))
vi.mock('../apps/trigger-view', () => ({DEFAULT_TRIGGER_SOURCE: ''}))
vi.mock('../toast', () => ({toast: {success: vi.fn(), error: vi.fn()}}))

const location = hmId('alice', {path: ['notes']})
const app = {
  id: hmId('alice', {path: ['weather']}),
  document: {metadata: {name: 'Weather', type: 'hm://hyper.media/app'}, content: []} as unknown as HMDocument,
}

let root: Root
let container: HTMLDivElement
beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  mocks.create.mockClear()
  mocks.navigate.mockClear()
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

async function createNamed(name: string) {
  const input = container.querySelector<HTMLInputElement>('#app-create-name')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, name)
    input.dispatchEvent(new Event('input', {bubbles: true}))
  })
  await act(async () => {
    container.querySelector('form')!.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}))
    await new Promise((resolve) => setTimeout(resolve, 10))
  })
}

/** The attributes the dialog published the new tool with. */
function publishedAttrs(): Record<string, unknown> {
  const [, operations] = mocks.create.mock.calls[0] as unknown as [
    unknown,
    {attrs: {key: string[]; value: unknown}[]}[],
  ]
  return Object.fromEntries(operations.flatMap((operation) => operation.attrs.map((a) => [a.key[0], a.value])))
}

describe('CreateToolDialog', () => {
  it('creates a tool on its own without asking for a server, and writes none into it', async () => {
    act(() => root.render(<CreateToolDialog input={{location}} onClose={vi.fn()} />))
    // Where a tool runs is for the app or the agent that takes it, or for whoever runs it alone.
    expect(container.querySelector('[data-testid="server-choice"]')).toBeNull()
    expect(container.textContent).not.toContain('Runs on')
    await createNamed('datalab')
    expect(mocks.create).toHaveBeenCalledTimes(1)
    expect(mocks.create.mock.calls[0]![0]).toMatchObject({path: ['notes', 'datalab']})
    expect(publishedAttrs()).toEqual({name: 'datalab', type: 'hm://hyper.media/tool', code: 'ipfs://bafycode'})
    // No app lists it.
    expect(mocks.create.mock.calls[0]![2]).toBeUndefined()
  })

  it('creates a tool inside an app, which lists it and runs it on the app’s server', async () => {
    act(() => root.render(<CreateToolDialog input={{app}} onClose={vi.fn()} />))
    expect(container.querySelector('[data-testid="server-choice"]')).toBeNull()
    await createNamed('forecast')
    expect(mocks.create.mock.calls[0]![0]).toMatchObject({path: ['weather', 'forecast']})
    expect(publishedAttrs()).not.toHaveProperty('appEnvironmentUrl')
    expect(mocks.create.mock.calls[0]![2]).toBe(app)
  })
})
