// @vitest-environment jsdom
import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {hmId} from '@shm/shared/utils/entity-id-url'
import type {HMDocument} from '@seed-hypermedia/client/hm-types'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {useToolRunConfig} from '../apps/app-settings'
;(globalThis as typeof globalThis & {React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean}).React = React
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

/**
 * What a tool's Run form is told about the config the tool cannot run without. A run that starts
 * without a required secret fails inside the tool, after the wait for a sandbox: the form must know
 * beforehand, and say which field is not set.
 */

const toolId = hmId('alice', {path: ['convert']})

const mocks = vi.hoisted(() => ({
  held: null as string[] | null,
  run: vi.fn(async (..._args: unknown[]) => {}),
  opened: undefined as {onSave: (config: Record<string, unknown>) => Promise<void>} | undefined,
}))

vi.mock('@shm/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shm/shared')>()),
  useUniversalClient: () => ({request: vi.fn()}),
}))
// No draft of the config fields is open: the fields are the ones the document names.
vi.mock('@shm/shared/models/use-document-machine', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shm/shared/models/use-document-machine')>()),
  useDocumentSelector: () => null,
  useDocumentSend: () => vi.fn(),
}))
vi.mock('../apps/running', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../apps/running')>()),
  useAppServerUrl: () => ({serverUrl: 'http://local.test', isLoading: false}),
  useAppRun: () => ({
    // The server holds a run for a host only once it was given config: none until then.
    status: {data: mocks.held ? {appId: 'x', privateConfigKeys: mocks.held} : null, isLoading: false, isError: false},
    run: {mutateAsync: mocks.run},
  }),
}))
vi.mock('../universal-dialog', () => ({
  useAppDialog: () => ({
    open: (input: {onSave: (config: Record<string, unknown>) => Promise<void>}) => {
      mocks.opened = input
    },
    content: null,
  }),
}))
vi.mock('../toast', () => ({toast: {success: vi.fn(), error: vi.fn()}}))

// A schema of the bundled library, so the test fetches nothing: its `name` field is required.
const tool = {
  metadata: {name: 'convert', type: 'hm://hyper.media/tool', privateConfigSchema: 'hm://hyper.media/example/person'},
  content: [],
} as unknown as HMDocument

let root: Root
let container: HTMLDivElement
beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  mocks.held = null
  mocks.run.mockClear()
  mocks.opened = undefined
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function Probe({standalone, canEdit}: {standalone: boolean; canEdit: boolean}) {
  const config = useToolRunConfig({host: {id: toolId, document: tool}, standalone, canEdit})
  return (
    <div>
      <span data-testid="missing">{config.missing.private.join(',')}</span>
      {config.setPrivate ? <button onClick={config.setPrivate}>set</button> : null}
    </div>
  )
}

async function render(standalone: boolean, canEdit = true) {
  const client = new QueryClient({defaultOptions: {queries: {retry: false}}})
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <Probe standalone={standalone} canEdit={canEdit} />
      </QueryClientProvider>,
    )
  })
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10))
  })
  return container.querySelector('[data-testid="missing"]')!.textContent
}

describe('the config a tool’s Run form waits for', () => {
  it('names a required secret of a tool on its own when the server holds nothing for it yet', async () => {
    expect(await render(true)).toBe('name')
  })

  it('names nothing once the server holds the secret', async () => {
    mocks.held = ['name']
    expect(await render(true)).toBe('')
  })

  it('names what an app that runs has not been given, and nothing for an app that does not run', async () => {
    // An app that is not running shows no Run form: there is nothing to hold back.
    expect(await render(false)).toBe('')
    act(() => root.unmount())
    root = createRoot(container)
    mocks.held = []
    expect(await render(false)).toBe('name')
  })

  it('lets the author of a tool on its own set the secret, which goes to their app environment', async () => {
    await render(true)
    act(() => container.querySelector('button')!.click())
    await act(async () => {
      await mocks.opened!.onSave({name: 'k-1'})
    })
    expect(mocks.run).toHaveBeenCalledWith({serverUrl: 'http://local.test', privateConfig: {name: 'k-1'}})
  })

  it('offers no way to set it to a reader, or for a tool inside an app, whose settings hold it', async () => {
    await render(true, false)
    expect(container.querySelector('button')).toBeNull()
    act(() => root.unmount())
    root = createRoot(container)
    await render(false, true)
    expect(container.querySelector('button')).toBeNull()
  })
})
