// @vitest-environment jsdom
import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {hmId} from '@shm/shared/utils/entity-id-url'
import type {HMDocument} from '@seed-hypermedia/client/hm-types'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {HostToolSecrets} from '../apps/app-settings'
;(globalThis as typeof globalThis & {React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean}).React = React
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

/**
 * An agent has no config of its own, so the secrets its tools declare are set here: counted, named
 * when a required one is missing, and sent to the server that runs the agent.
 */

const agentId = hmId('alice', {path: ['helper']})
const convertId = hmId('bob', {path: ['tools', 'convert']})

const mocks = vi.hoisted(() => ({
  held: [] as string[],
  run: vi.fn(async (..._args: unknown[]) => {}),
  opened: undefined as {onSave: (config: Record<string, unknown>) => Promise<void>} | undefined,
}))

vi.mock('@shm/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shm/shared')>()),
  useUniversalClient: () => ({
    request: async (key: string) => {
      if (key !== 'Resource') throw new Error(`unexpected ${key}`)
      return {
        type: 'document',
        document: {
          metadata: {
            name: 'convert',
            type: 'hm://hyper.media/tool',
            // A schema of the bundled library, so the test fetches nothing: it has a `name` field.
            privateConfigSchema: 'hm://hyper.media/example/person',
          },
        },
      }
    },
  }),
}))
vi.mock('../apps/running', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../apps/running')>()),
  useAppServerUrl: () => ({serverUrl: 'http://agents.test', isLoading: false}),
  useAppRun: () => ({
    status: {data: {appId: 'x', privateConfigKeys: mocks.held}},
    run: {mutateAsync: mocks.run},
  }),
}))
// The dialog is the app's own, tested with it: here it only has to be opened with the right fields.
vi.mock('../universal-dialog', () => ({
  useAppDialog: () => ({
    open: (input: {onSave: (config: Record<string, unknown>) => Promise<void>}) => {
      mocks.opened = input
    },
    content: null,
  }),
}))
vi.mock('../toast', () => ({toast: {success: vi.fn(), error: vi.fn()}}))

const agent = {
  id: agentId,
  document: {
    metadata: {name: 'Helper', type: 'hm://hyper.media/agent', agentServerUrl: 'http://agents.test'},
    content: [{block: {type: 'Embed', id: 'r1', link: convertId.id, attributes: {view: 'Card'}}, children: []}],
  } as unknown as HMDocument,
}

let root: Root
let container: HTMLDivElement
beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  mocks.held = []
  mocks.run.mockClear()
  mocks.opened = undefined
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

async function render(canEdit: boolean, host = agent) {
  const client = new QueryClient({defaultOptions: {queries: {retry: false}}})
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <HostToolSecrets host={host} canEdit={canEdit} />
      </QueryClientProvider>,
    )
  })
  // The tools' declarations are read from their documents.
  for (let step = 0; step < 3; step++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
    })
  }
}

describe('the secrets an agent’s tools declare', () => {
  it('are counted, and a required one that is not set is named in red', async () => {
    await render(true)
    expect(container.textContent).toContain('Tool secrets')
    expect(container.textContent).toContain('0 of')
    const alert = container.querySelector('[role="alert"]')!
    expect(alert.textContent).toContain('Not set: name')
    expect(alert.className).toContain('text-destructive')
  })

  it('go to the server that runs the agent when they are set', async () => {
    await render(true)
    act(() =>
      Array.from(container.querySelectorAll('button'))
        .find((el) => el.textContent?.includes('Set'))!
        .click(),
    )
    await act(async () => {
      await mocks.opened!.onSave({name: 'k-1'})
    })
    expect(mocks.run).toHaveBeenCalledWith({serverUrl: 'http://agents.test', privateConfig: {name: 'k-1'}})
  })

  it('say where they are kept once the server holds them, and that the agent never sees them', async () => {
    mocks.held = ['name']
    await render(true)
    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(container.textContent).toContain('never shown to the agent')
  })

  it('offer nothing to change to someone who cannot write the agent', async () => {
    await render(false)
    expect(container.textContent).toContain('Tool secrets')
    expect(Array.from(container.querySelectorAll('button')).some((el) => el.textContent?.includes('Set'))).toBe(false)
  })

  it('show nothing for an agent whose tools declare no secret', async () => {
    await render(true, {id: agentId, document: {...agent.document, content: []} as HMDocument})
    expect(container.textContent).toBe('')
  })
})
