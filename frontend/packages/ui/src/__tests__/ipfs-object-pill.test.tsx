// @vitest-environment jsdom
// An ipfs:// pill names what it points at: a schema blob by its schema name,
// an instance by its type's name, a file by its short CID.
import * as cbor from '@ipld/dag-cbor'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {UniversalAppProvider} from '@shm/shared/routing'
import {CID} from 'multiformats/cid'
import {sha256} from 'multiformats/hashes/sha2'
import {act} from 'react-dom/test-utils'
import {createRoot, type Root} from 'react-dom/client'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {schemaCid} from '../onyx/onyx-engine'
import {TooltipProvider} from '../tooltip'
import {CBOR_VALUE_RULES, ValueDisplay, ValueEditorProvider} from '../value-editor'
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
const flush = () => act(async () => await new Promise((r) => setTimeout(r, 0)))

describe('ipfs object pills', () => {
  let container: HTMLDivElement
  let root: Root
  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  const mount = (value: unknown, blobs: Record<string, unknown> = {}) => {
    const request = vi.fn(async (method: string, params: any) =>
      method === 'GetCID' ? {value: blobs[params.cid]} : {},
    )
    act(() =>
      root.render(
        <QueryClientProvider client={new QueryClient({defaultOptions: {queries: {retry: false}}})}>
          <UniversalAppProvider openUrl={() => {}} openRoute={null} universalClient={{request} as any}>
            <TooltipProvider>
              <ValueEditorProvider>
                <ValueDisplay value={value} rules={CBOR_VALUE_RULES} />
              </ValueEditorProvider>
            </TooltipProvider>
          </UniversalAppProvider>
        </QueryClientProvider>,
      ),
    )
  }
  const pill = () => container.querySelector('[data-testid="ipfs-object-pill"], [data-testid="ipfs-file-pill"]')!

  it('a bundled schema blob is named by its schema, without fetching', async () => {
    mount({schemaDefinition: `ipfs://${schemaCid('example-stats')}`})
    await flush()
    expect(pill().textContent).toContain('Character stats')
    expect(pill().getAttribute('data-object-kind')).toBe('schema')
  })

  it('a published schema blob is fetched and named', async () => {
    const schema = {name: 'Vote', type: 'hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/map', properties: {}}
    const cid = CID.createV1(0x71, await sha256.digest(cbor.encode(schema))).toString()
    mount({schemaDefinition: `ipfs://${cid}`}, {[cid]: schema})
    await flush()
    await flush()
    expect(pill().textContent).toContain('Vote')
    expect(pill().getAttribute('data-object-kind')).toBe('schema')
  })

  it('an instance that links its schema is named by its type', async () => {
    const stats = schemaCid('example-stats')!
    const instance = {strength: 5, intellect: 5, charisma: 5, schema: {'/': stats}}
    const cid = CID.createV1(0x71, await sha256.digest(cbor.encode(instance))).toString()
    mount({stats: `ipfs://${cid}`}, {[cid]: instance})
    await flush()
    await flush()
    expect(pill().textContent).toContain('Character stats')
    expect(pill().getAttribute('data-object-kind')).toBe('instance')
  })

  it('a file keeps its short CID', async () => {
    const fileCid = CID.createV1(0x55, await sha256.digest(new Uint8Array([1, 2, 3]))).toString()
    mount({portrait: `ipfs://${fileCid}`})
    await flush()
    expect(pill().getAttribute('data-object-kind')).toBe('file')
    expect(pill().textContent).toContain(fileCid.slice(0, 9))
  })
})
