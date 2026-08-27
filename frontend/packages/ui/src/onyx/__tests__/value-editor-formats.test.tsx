// @vitest-environment jsdom
// The metadata value editor's schema-driven presentations for the new field
// formats: a date renders a picker; an ipfs field offers "Create linked
// object"; an ipfs value that IS an object (a DAG-CBOR CID) renders the object
// pill with an edit action, while a file CID renders the file pill.
import * as cbor from '@ipld/dag-cbor'
import {CID} from 'multiformats/cid'
import {sha256} from 'multiformats/hashes/sha2'
import {act} from 'react-dom/test-utils'
import {createRoot} from 'react-dom/client'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {UniversalAppProvider} from '@shm/shared/routing'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {TooltipProvider} from '../../tooltip'
import {METADATA_VALUE_RULES, ValueEditor, ValueEditorProvider} from '../../value-editor'
import {nameToUrl, ONYX_SCHEMAS} from '../onyx-engine'
import {OnyxSchemaProvider} from '../onyx-schema-context'
import {metadataSchemaOf} from '../onyx-schema-resolve'
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

const characterMeta = metadataSchemaOf(ONYX_SCHEMAS['example-character-doc'])!

function Field({metadata, field}: {metadata: Record<string, unknown>; field: string}) {
  return (
    <QueryClientProvider client={new QueryClient({defaultOptions: {queries: {retry: false}}})}>
      <UniversalAppProvider openUrl={() => {}} openRoute={null} universalClient={{request: async () => ({})} as any}>
        <TooltipProvider>
          <ValueEditorProvider>
            <OnyxSchemaProvider schema={characterMeta} registry={{}} value={metadata}>
              <ValueEditor value={metadata[field]} onValue={() => {}} rules={METADATA_VALUE_RULES} path={[field]} />
            </OnyxSchemaProvider>
          </ValueEditorProvider>
        </TooltipProvider>
      </UniversalAppProvider>
    </QueryClientProvider>
  )
}

describe('value editor formats', () => {
  let container: HTMLDivElement
  let root: ReturnType<typeof createRoot>
  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('a date field renders the date picker', () => {
    act(() => root.render(<Field metadata={{born: '0990-04-01'}} field="born" />))
    const picker = container.querySelector('[data-testid="date-field"]')
    expect(picker).toBeTruthy()
    expect(picker!.getAttribute('data-value')).toBe('0990-04-01')
    expect(container.querySelector('input')).toBeNull()
  })

  it('an empty ipfs field offers to create a linked object', () => {
    act(() => root.render(<Field metadata={{stats: ''}} field="stats" />))
    expect(container.querySelector('[aria-label="Create linked object"]')).toBeTruthy()
    // A plain text field does not.
    act(() => root.render(<Field metadata={{name: ''}} field="name" />))
    expect(container.querySelector('[aria-label="Create linked object"]')).toBeNull()
  })

  it('a DAG-CBOR reference renders the object pill; a file renders the file pill', async () => {
    const objectCid = CID.createV1(0x71, await sha256.digest(cbor.encode({strength: 5}))).toString()
    act(() => root.render(<Field metadata={{stats: `ipfs://${objectCid}`}} field="stats" />))
    expect(container.querySelector('[data-testid="ipfs-object-pill"]')).toBeTruthy()
    // No pencil outside a document-field context.
    expect(container.querySelector('[aria-label="Edit linked object"]')).toBeNull()

    const fileCid = CID.createV1(0x55, await sha256.digest(new Uint8Array([104, 101, 108, 108, 111]))).toString()
    act(() => root.render(<Field metadata={{portrait: `ipfs://${fileCid}`}} field="portrait" />))
    expect(container.querySelector('[data-testid="ipfs-file-pill"]')).toBeTruthy()
    expect(container.querySelector('[aria-label="Edit linked object"]')).toBeNull()
  })

  it('the kit exposes the target on the stats field', () => {
    expect(nameToUrl('example-stats')).toBe('hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/example-stats')
  })
})
