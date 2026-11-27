// @vitest-environment jsdom
import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {hmId} from '@shm/shared/utils/entity-id-url'
import type {HMDocument} from '@seed-hypermedia/client/hm-types'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {HostToolSettings} from '../apps/app-settings'
;(globalThis as typeof globalThis & {React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean}).React = React
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

/**
 * An agent has no config of its own, so the settings its tools declare are set on the agent: shown
 * with what the agent already holds, and published to the agent's document only on Save.
 */

const agentId = hmId('alice', {path: ['helper']})
const convertId = hmId('bob', {path: ['tools', 'convert']})

const mocks = vi.hoisted(() => ({
  update: vi.fn(async (..._args: unknown[]) => {}),
  declares: true,
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
            ...(mocks.declares ? {publicConfigSchema: 'hm://hyper.media/example/person'} : {}),
          },
        },
      }
    },
  }),
}))
vi.mock('../apps/publish', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../apps/publish')>()),
  useAppsPublisher: () => ({update: mocks.update}),
}))
vi.mock('../toast', () => ({toast: {success: vi.fn(), error: vi.fn()}}))

function agent(publicConfig?: Record<string, unknown>) {
  return {
    id: agentId,
    document: {
      metadata: {name: 'Helper', type: 'hm://hyper.media/agent', ...(publicConfig ? {publicConfig} : {})},
      content: [{block: {type: 'Embed', id: 'r1', link: convertId.id, attributes: {view: 'Card'}}, children: []}],
    } as unknown as HMDocument,
  }
}

let root: Root
let container: HTMLDivElement
beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  mocks.update.mockClear()
  mocks.declares = true
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

async function render(host: ReturnType<typeof agent>, canEdit = true) {
  const client = new QueryClient({defaultOptions: {queries: {retry: false}}})
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <HostToolSettings host={host} canEdit={canEdit} />
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

const field = () => container.querySelector<HTMLInputElement>('#app-config-name')!
const save = () => Array.from(container.querySelectorAll('button')).find((el) => el.textContent?.includes('Save'))
const type = (text: string) =>
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field(), text)
    field().dispatchEvent(new Event('input', {bubbles: true}))
  })

describe('the settings an agent’s tools declare', () => {
  it('are asked for on the agent, with what it already holds, and nothing to save until one changes', async () => {
    await render(agent({name: 'fast'}))
    expect(container.textContent).toContain('Tool settings')
    expect(field().value).toBe('fast')
    expect(save()!.disabled).toBe(true)
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('are published to the agent’s document on Save, one attribute for each field that changed', async () => {
    await render(agent())
    type('balanced')
    expect(mocks.update).not.toHaveBeenCalled()
    await act(async () => save()!.click())
    expect(mocks.update).toHaveBeenCalledWith(agentId, [
      {type: 'SetAttributes', attrs: [{key: ['publicConfig', 'name'], value: 'balanced'}]},
    ])
  })

  it('remove a setting that is emptied, so the tool goes back to its own default', async () => {
    await render(agent({name: 'fast'}))
    type('')
    await act(async () => save()!.click())
    expect(mocks.update).toHaveBeenCalledWith(agentId, [
      {type: 'SetAttributes', attrs: [{key: ['publicConfig', 'name'], value: null}]},
    ])
  })

  it('show a reader the values with nothing to change', async () => {
    await render(agent({name: 'fast'}), false)
    expect(field().disabled).toBe(true)
    expect(save()).toBeUndefined()
  })

  it('show nothing for an agent whose tools declare no settings', async () => {
    mocks.declares = false
    await render(agent())
    expect(container.textContent).toBe('')
  })
})
