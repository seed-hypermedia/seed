// @vitest-environment jsdom
import {act} from 'react-dom/test-utils'
import {createRoot, type Root} from 'react-dom/client'
import {UniversalAppProvider} from '@shm/shared/routing'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {ONYX_SCHEMAS, validate} from '../onyx-engine'
import {seedValue} from '../onyx-data-editor'
import {RpcCallPanel, rpcMethodForSlug, rpcMethods} from '../onyx-rpc-console'

describe('rpc catalog (derived from the seed-rpc union schema)', () => {
  it('exposes every method of the union with key, input, and output', () => {
    const methods = rpcMethods()
    expect(methods.length).toBe(ONYX_SCHEMAS['seed-rpc'].anyOf.length)
    const keys = methods.map((m) => m.key)
    expect(keys).toContain('Search')
    expect(keys).toContain('Resource')
    expect(keys).toContain('DiscoveryStatus')
    // Keys are unique — one method per request key.
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('seeds every method an input that already conforms to its input schema', () => {
    for (const method of rpcMethods()) {
      const seeded = seedValue(method.input, ONYX_SCHEMAS)
      const warnings = validate(method.input, seeded, '$', {}, ONYX_SCHEMAS)
      expect(warnings, `${method.key} seeded input should validate`).toEqual([])
    }
  })

  it('resolves a method from its schema slug', () => {
    expect(rpcMethodForSlug('seed-rpc-search')?.key).toBe('Search')
    expect(rpcMethodForSlug('seed-citation')).toBeUndefined()
  })
})

describe('RpcCallPanel', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('calls the universal client with the edited input and validates the response', async () => {
    const request = vi.fn(async (_method: string, _input: unknown) => ({state: 'found', version: 'bafyv1'}))
    const method = rpcMethodForSlug('seed-rpc-discovery-status')!
    act(() => {
      root.render(
        <UniversalAppProvider openUrl={() => {}} openRoute={null} universalClient={{request} as any}>
          <RpcCallPanel method={method} />
        </UniversalAppProvider>,
      )
    })
    const runButton = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.includes('Run DiscoveryStatus'),
    )!
    expect(runButton).toBeTruthy()
    await act(async () => {
      runButton.click()
      await Promise.resolve()
    })
    expect(request).toHaveBeenCalledTimes(1)
    expect(request.mock.calls[0]![0]).toBe('DiscoveryStatus')
    // The seeded input for DiscoveryStatus: required uid + path.
    expect(request.mock.calls[0]![1]).toEqual({uid: '', path: []})
    // The mocked response conforms to seed-discovery-status.
    expect(container.textContent).toContain('matches schema')
    expect(container.textContent).toContain('found')
  })

  it('surfaces schema warnings when the response does not conform', async () => {
    const request = vi.fn(async (_method: string, _input: unknown) => ({state: 'exploded'}))
    const method = rpcMethodForSlug('seed-rpc-discovery-status')!
    act(() => {
      root.render(
        <UniversalAppProvider openUrl={() => {}} openRoute={null} universalClient={{request} as any}>
          <RpcCallPanel method={method} />
        </UniversalAppProvider>,
      )
    })
    const runButton = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.includes('Run DiscoveryStatus'),
    )!
    await act(async () => {
      runButton.click()
      await Promise.resolve()
    })
    expect(container.textContent).toContain('schema warning')
  })
})
