// @vitest-environment jsdom
// A type that extends ANOTHER published type (Mammal extends Animal, both under an account)
// must resolve to the union of both field sets. The resolver only knows the bundled library by
// default, so the parent has to be fetched: this is what useHydratedRegistry adds.
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {UniversalAppProvider} from '@shm/shared/routing'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {structFields} from '../engine'
import {useConformanceSchema} from '../schema-resolve'

const SPACE = 'z6MkWorldFixture'
const ANIMAL_URL = `hm://${SPACE}/experimental/types/animal`
const MAMMAL_URL = `hm://${SPACE}/experimental/types/mammal`
// Valid DAG-CBOR CIDs, so the references classify as blobs; the mock serves them by string.
const ANIMAL_CID = 'bafyreigkxnvamoxiyp2qvcn7qazdppwnt2mdnbojuehthjrk7yfpuhnmjq'
const MAMMAL_CID = 'bafyreidedtokl6mruxplo3w6hgqmluuubnfgmz43c5zq7oqehysi5wo5ea'

const animal = {
  type: 'hm://hyper.media/struct',
  properties: {
    diet: {value: {anyOf: ['herbivore', 'carnivore', 'omnivore']}, required: true},
    habitat: {value: {type: 'hm://hyper.media/string'}, required: true},
  },
}
const mammal = {
  type: ANIMAL_URL,
  properties: {
    hasFur: {value: {type: 'hm://hyper.media/boolean'}, required: true},
    gestationDays: {value: {type: 'hm://hyper.media/integer', minimum: 0}},
  },
}
const pages: Record<string, {schemaDefinition: string; name: string}> = {
  'experimental/types/animal': {name: 'Animal', schemaDefinition: `ipfs://${ANIMAL_CID}`},
  'experimental/types/mammal': {name: 'Mammal', schemaDefinition: `ipfs://${MAMMAL_CID}`},
}
const blobs: Record<string, unknown> = {[ANIMAL_CID]: animal, [MAMMAL_CID]: mammal}

const client = {
  request: async (key: string, input: any) => {
    if (key === 'Resource') {
      const page = pages[(input.path ?? []).join('/')]
      return page
        ? {
            type: 'document',
            id: hmId(SPACE, {path: input.path}),
            document: {metadata: page, authors: [], genesis: 'g', visibility: 'PUBLIC'},
          }
        : {type: 'not-found', id: input}
    }
    if (key === 'GetCID') return {value: blobs[input.cid] ?? null}
    return null
  },
}

let container: HTMLDivElement
let root: Root
beforeEach(() => {
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function Fields({metadata}: {metadata: Record<string, unknown>}) {
  const {schema, isLoading} = useConformanceSchema(
    hmId(SPACE, {path: ['experimental', 'animals', 'cat']}),
    metadata,
    null,
  )
  return (
    <pre>
      {isLoading
        ? 'loading'
        : structFields(schema)
            .map((f) => f.name + (f.required ? '*' : ''))
            .join(',')}
    </pre>
  )
}

const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 50)))

describe('useConformanceSchema', () => {
  it('resolves a type that extends another published type to both field sets', async () => {
    const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}})
    act(() =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <UniversalAppProvider openUrl={() => {}} openRoute={null} universalClient={client as any}>
            <Fields metadata={{name: 'Cat', attributesSchema: MAMMAL_URL}} />
          </UniversalAppProvider>
        </QueryClientProvider>,
      ),
    )
    for (let i = 0; i < 20 && !container.textContent?.includes('hasFur'); i++) await settle()
    expect(container.textContent).toBe('diet*,habitat*,hasFur*,gestationDays')
  })
})
