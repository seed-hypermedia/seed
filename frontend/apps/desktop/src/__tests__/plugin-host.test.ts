// @vitest-environment jsdom
import type {PluginManifest} from '@shm/ui/plugin-manifest'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {createPluginBridge} from '../plugins/plugin-bridge'
import {PluginHost} from '../plugins/plugin-host'
import {PLUGIN_SHIM_HTML} from '../plugins/plugin-shim'

const MANIFEST: PluginManifest = {
  schema: {'/': 'bafyManifestSchema'},
  name: 'test-plugin',
  code: {'/': 'bafyCode'},
  permissions: ['document:read'],
  actions: [{name: 'run'}],
}

describe('createPluginBridge', () => {
  const bridge = createPluginBridge({
    readDocument: async () => ({id: 'hm://doc', metadata: {name: 'Doc'}}),
    getBlob: async (cid) => ({fetched: cid}),
    publishBlob: async () => ({cid: 'bafyNew'}),
  })

  it('maps methods to permissions and flags unknown methods', () => {
    expect(bridge.requiredPermission('document.read')).toBe('document:read')
    expect(bridge.requiredPermission('document.updateMetadata')).toBe('document:write')
    expect(bridge.requiredPermission('blob.get')).toBe('blob:read')
    expect(bridge.requiredPermission('blob.publish')).toBe('blob:write')
    expect(bridge.requiredPermission('fs.readFile')).toBe('unknown-method')
  })

  it('executes capability calls with validated params', async () => {
    await expect(bridge.call('document.read', {}, {manifest: MANIFEST})).resolves.toEqual({
      id: 'hm://doc',
      metadata: {name: 'Doc'},
    })
    await expect(bridge.call('blob.get', {cid: 'ipfs://bafyX'}, {manifest: MANIFEST})).resolves.toEqual({
      fetched: 'bafyX',
    })
    await expect(bridge.call('blob.get', {}, {manifest: MANIFEST})).rejects.toThrow('requires {cid')
  })

  it('rejects capabilities that are not wired (e.g. no open document)', async () => {
    const empty = createPluginBridge({})
    await expect(empty.call('document.read', {}, {manifest: MANIFEST})).rejects.toThrow('No document is open')
  })

  it('rejects oversized and non-serializable payloads', async () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    await expect(bridge.call('document.read', circular, {manifest: MANIFEST})).rejects.toThrow('too large')
  })
})

describe('PluginHost permission gating (protocol level)', () => {
  let host: PluginHost
  let responses: unknown[]
  const bridge = createPluginBridge({
    readDocument: async () => ({id: 'hm://doc', metadata: {}}),
    publishBlob: async () => ({cid: 'bafyNew'}),
  })

  beforeEach(() => {
    responses = []
    host = new PluginHost(MANIFEST, 'seed.action("run", () => 1)', bridge)
    // Drive the private protocol handlers directly with a fake port — jsdom
    // cannot execute srcdoc/worker sandboxes, so the sandbox itself is
    // covered by manual/E2E testing; this locks the host's gating logic.
    ;(host as any).port = {postMessage: (message: unknown) => responses.push(message), close: () => {}}
  })

  afterEach(() => host.destroy())

  it('allows bridge calls whose permission the manifest declares', async () => {
    await (host as any).handleBridgeCall('call1', 'rpc1', 'document.read', {})
    expect(responses).toEqual([
      {
        type: 'bridge-response',
        callId: 'call1',
        rpcId: 'rpc1',
        result: {id: 'hm://doc', metadata: {}},
        error: undefined,
      },
    ])
  })

  it('denies undeclared permissions with an actionable message', async () => {
    await (host as any).handleBridgeCall('call1', 'rpc1', 'blob.publish', {value: 1})
    expect(responses).toHaveLength(1)
    const response = responses[0] as {error?: string}
    expect(response.error).toContain('Permission denied')
    expect(response.error).toContain('blob:write')
  })

  it('rejects unknown methods', async () => {
    await (host as any).handleBridgeCall('call1', 'rpc1', 'os.exec', {})
    expect((responses[0] as {error?: string}).error).toContain('Unknown method')
  })

  it('resolves and rejects pending invocations from shim messages', async () => {
    vi.useFakeTimers()
    const pending = new Map<string, unknown>()
    ;(host as any).pending = pending
    const resolve = vi.fn()
    const reject = vi.fn()
    pending.set('call9', {resolve, reject, timeout: setTimeout(() => {}, 1000)})
    ;(host as any).handleShimMessage({type: 'result', callId: 'call9', output: {n: 3}})
    expect(resolve).toHaveBeenCalledWith({n: 3})
    pending.set('call10', {resolve, reject, timeout: setTimeout(() => {}, 1000)})
    ;(host as any).handleShimMessage({type: 'error', callId: 'call10', message: 'boom'})
    expect(reject).toHaveBeenCalledWith(new Error('boom'))
    vi.useRealTimers()
  })
})

describe('shim document', () => {
  it('is fully static with a network-closing CSP and worker delivery', () => {
    expect(PLUGIN_SHIM_HTML).toContain("connect-src 'none'")
    expect(PLUGIN_SHIM_HTML).toContain("default-src 'none'")
    expect(PLUGIN_SHIM_HTML).toContain('worker-src blob:')
    // No interpolation slots: the document is one fixed string.
    expect(PLUGIN_SHIM_HTML).not.toContain('${')
  })
})
