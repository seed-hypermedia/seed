import {decodePageInput, encodePageInput} from '@seed-hypermedia/client/page-input'
import {hydrateSchemaRegistry, resolveSchemaRef, type SchemaFetchClient} from '@seed-hypermedia/client/schema-resolve'
import {resolveSchema, STRUCT_URL, validate} from '@seed-hypermedia/client/schema-engine'

/** A page's URL input plus schema/parse errors, including invalid incoming links. */
export type DocumentPageInputState = {values: Record<string, unknown>; schema: string; errors: string[]}

/** Bind schema-validated URL input to one page session; navigation never changes its resource identity. */
export function createDocumentPageInput(options: {
  schema: string
  client: SchemaFetchClient | ((signal: AbortSignal) => SchemaFetchClient)
  params?: Record<string, string>
  navigate: (params: Record<string, string>, mode: 'push' | 'replace') => void
}) {
  let params = options.params || {}
  let revision = 0
  let active = true
  let loaded: ReturnType<typeof load> | undefined
  const listeners = new Set<(state: DocumentPageInputState) => void>()
  async function load(signal: AbortSignal) {
    const client = typeof options.client === 'function' ? options.client(signal) : options.client
    const resolved = await resolveSchemaRef(client, options.schema)
    if (!resolved.schema) throw new Error('The page input schema could not be loaded.')
    const registry = await hydrateSchemaRegistry(client, resolved.schema)
    if (resolveSchema(resolved.schema, {}, registry).schema.type !== STRUCT_URL)
      throw new Error('A page input schema must be an HM struct.')
    return {schema: resolved.schema, registry}
  }
  async function read(raw = params, signal = new AbortController().signal): Promise<DocumentPageInputState> {
    const state = {...decodePageInput(raw), schema: options.schema}
    try {
      loaded ||= load(signal).catch((error) => {
        loaded = undefined
        throw error
      })
      const contract = await loaded
      state.errors.push(...validate(contract.schema, state.values, '$', {}, contract.registry))
    } catch (error) {
      state.errors.push(error instanceof Error ? error.message : String(error))
    }
    return state
  }
  async function notify() {
    if (!loaded || !listeners.size) return
    const current = revision
    const state = await read()
    if (!active || current !== revision) return
    listeners.forEach((listener) => listener(state))
  }
  return {
    read,
    start() {
      active = true
    },
    async write(values: unknown, mode: 'push' | 'replace', signal = new AbortController().signal) {
      signal.throwIfAborted()
      const raw = encodePageInput(values)
      const current = revision
      const state = await read(raw, signal)
      signal.throwIfAborted()
      if (!active || current !== revision) throw new Error('Page input changed while validating. Try again.')
      if (state.errors.length) throw new Error(state.errors.join('; '))
      options.navigate(raw, mode)
      params = raw
      revision++
      listeners.forEach((listener) => listener(state))
      return state
    },
    update(next: Record<string, string> = {}) {
      if (JSON.stringify(params) === JSON.stringify(next)) return
      params = next
      revision++
      void notify()
    },
    subscribe(listener: (state: DocumentPageInputState) => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    close() {
      active = false
      revision++
      listeners.clear()
    },
  }
}
