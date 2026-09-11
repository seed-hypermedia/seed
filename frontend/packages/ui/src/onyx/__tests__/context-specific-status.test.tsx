// @vitest-environment jsdom
import {hmId} from '@shm/shared'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {RequiredAttributesEditor} from '../../required-attributes-editor'
import {TooltipProvider} from '../../tooltip'
import {fieldSchema, type OnyxSchema} from '../onyx-engine'
import {useEffectiveDocSchema} from '../onyx-schema-resolve'
import {literalOptions} from '../onyx-value-editor-schema'

const fixtures = vi.hoisted(() => {
  const uid = 'z6MkpVa5nMUR5ZaUEyV1SE48KTNbwTuHRd83RwLgMKc4nGU3'
  const onyx = 'hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb'
  const taskCid = 'bafyreigu5vewjq63sy3t2spkkpmchine3vo3jnuuvntx7ig4oef7hafuka'
  const storyCid = 'bafyreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku'
  const type = (values: string[]): OnyxSchema => ({
    type: `${onyx}/hypermedia-struct`,
    required: ['Status'],
    properties: {Status: {anyOf: values}},
  })
  return {
    uid,
    taskCid,
    storyCid,
    schemas: {
      [taskCid]: type(['Backlog', 'In Progress', 'Done']),
      [storyCid]: type(['Draft', 'Ready', 'Accepted']),
    } as Record<string, OnyxSchema>,
  }
})

vi.mock('@shm/shared/models/entity', () => ({
  useResource: (id: {path?: string[]} | null | undefined) => {
    const path = id?.path?.join('/')
    const metadata =
      path === 'tasks'
        ? {childrenSchema: `hm://${fixtures.uid}/types/task`}
        : path === 'stories'
          ? {childrenSchema: `hm://${fixtures.uid}/types/story`}
          : path === 'types/task'
            ? {schemaDefinition: `ipfs://${fixtures.taskCid}`}
            : path === 'types/story'
              ? {schemaDefinition: `ipfs://${fixtures.storyCid}`}
              : null
    return {
      data: metadata ? {type: 'document', document: {metadata}} : undefined,
      isLoading: false,
    }
  },
}))

vi.mock('../onyx-schema-registry-cid', () => ({
  useOnyxSchemaRegistry: (cids: string[]) => ({
    byCid: Object.fromEntries(cids.filter((cid) => fixtures.schemas[cid]).map((cid) => [cid, fixtures.schemas[cid]])),
    isLoading: false,
    isComplete: true,
  }),
}))

let container: HTMLDivElement
let root: Root
let effective: ReturnType<typeof useEffectiveDocSchema>
let patches: Record<string, unknown>[]

function Harness({path, metadata}: {path: string[]; metadata: Record<string, unknown>}) {
  effective = useEffectiveDocSchema(hmId(fixtures.uid, {path}), metadata)
  return (
    <TooltipProvider>
      <RequiredAttributesEditor
        conformanceSchema={effective.metadataSchema}
        metadata={metadata}
        onMetadata={(patch) => patches.push(patch)}
      />
    </TooltipProvider>
  )
}

function render(path: string[], metadata: Record<string, unknown>) {
  act(() => root.render(<Harness path={path} metadata={metadata} />))
}

function options() {
  const status = fieldSchema(effective.metadataSchema!, 'Status')!
  return literalOptions(status)!.map((option) => option.value)
}

beforeEach(() => {
  ;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  patches = []
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('context-specific inherited Status constraints', () => {
  it('selects each parent childrenSchema and preserves a copied cross-context value', () => {
    render(['tasks', 'new-task'], {})
    expect(effective.source).toBe('inherited')
    expect(options()).toEqual(['Backlog', 'In Progress', 'Done'])
    expect(container.querySelector('[role="combobox"]')?.textContent).toContain('Backlog')

    render(['stories', 'new-story'], {})
    expect(effective.source).toBe('inherited')
    expect(options()).toEqual(['Draft', 'Ready', 'Accepted'])
    expect(container.querySelector('[role="combobox"]')?.textContent).toContain('Draft')

    render(['stories', 'copied-task'], {Status: 'Done'})
    expect(container.querySelector('[role="combobox"]')).toBeNull()
    expect(Array.from(container.querySelectorAll('input')).map((input) => input.value)).toContain('Done')
    expect(container.querySelector('.lucide-triangle-alert')).not.toBeNull()
    expect(patches).toEqual([])
  })
})
