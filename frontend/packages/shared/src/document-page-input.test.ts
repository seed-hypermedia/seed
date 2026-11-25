import {describe, expect, it, vi} from 'vitest'
import {createDocumentPageInput} from './document-page-input'
import {decodePageInput, encodePageInput, pageParamsFromUrl} from '@seed-hypermedia/client/page-input'
import {packHmId, unpackHmId} from '@seed-hypermedia/client/hm-types'
import {resolveHypermediaUrl} from '@seed-hypermedia/client/hm-resolver'
import {schemaCid} from '@seed-hypermedia/client/schema-engine'
import {routeToHmUrl, routeToUrl} from './utils/entity-id-url'
import {hypermediaUrlToRoute} from './utils/url-to-route'

const uid = 'z6MkiAKDcRSzQ4zPZfnJcS5HYx5MwgN6MU9foHihJGrhqNBj'
const ref = `hm://${uid}/types/page-input`
const person = {name: 'Hello & ? # / 🪴', age: 3, active: false, nicknames: ['one', 'two']}
const client = {
  request: vi.fn(async () => ({
    type: 'document',
    document: {metadata: {schemaDefinition: `ipfs://${schemaCid('example/person')}`}},
  })),
} as any

describe('schema-defined page input', () => {
  it('round-trips typed input and preserves Seed navigation and canonical identity', () => {
    const id = {...unpackHmId(`hm://${uid}/pages/hello?v=revision#block`)!, pageParams: encodePageInput(person)}
    const route = {key: 'document' as const, id, panel: {key: 'comments' as const, id}}
    for (const url of [
      packHmId(id),
      routeToHmUrl(route)!,
      routeToUrl(route, {hostname: 'https://example.com'})!,
      routeToUrl(route, {hostname: 'https://example.com', originHomeId: id})!,
    ]) {
      expect(decodePageInput(pageParamsFromUrl(url))).toEqual({values: person, errors: []})
      expect(new URL(url).searchParams.get('v')).toBe('revision')
      expect(new URL(url).hash).toBe('#block')
    }
    const parsed = hypermediaUrlToRoute(routeToHmUrl(route)!)!
    expect(parsed).toMatchObject({
      key: 'document',
      id: {id: `hm://${uid}/pages/hello`, pageParams: id.pageParams},
      panel: {key: 'comments'},
    })
    expect(pageParamsFromUrl(`hm://${uid}?v=1&panel=comments&p.v=%22custom%22`)).toEqual({v: '"custom"'})
  })

  it('preserves input when opening a pretty site URL', async () => {
    const resolved = await resolveHypermediaUrl('https://example.com/pages/hello?p.prompt=%22Prefilled%22', {
      domainResolver: async () => uid,
    })
    expect(resolved?.hmId).toMatchObject({id: `hm://${uid}/pages/hello`, pageParams: {prompt: '"Prefilled"'}})
  })

  it('resolves a published schema, validates writes, and restores history without changing the page', async () => {
    const navigate = vi.fn()
    const input = createDocumentPageInput({schema: ref, client, navigate, params: encodePageInput(person)})
    const changed = vi.fn()
    input.subscribe(changed)
    expect(await input.read()).toEqual({values: person, schema: ref, errors: []})
    await input.write({...person, age: 4}, 'push')
    await input.write({...person, age: 5}, 'replace')
    expect(navigate.mock.calls.map((call) => call[1])).toEqual(['push', 'replace'])
    expect(navigate.mock.calls[1]![0]).toEqual(encodePageInput({...person, age: 5}))
    input.update(encodePageInput(person))
    await vi.waitFor(() => expect(changed).toHaveBeenLastCalledWith({values: person, schema: ref, errors: []}))
    await expect(input.write({...person, age: 'wrong'}, 'push')).rejects.toThrow('integer')
    await expect(input.write({...person, extra: true}, 'replace')).rejects.toThrow('unexpected key')
    expect(navigate).toHaveBeenCalledTimes(2)
    input.close()
    await expect(input.write(person, 'push')).rejects.toThrow('changed')
  })

  it('reports malformed and invalid incoming URLs, rejects unsupported JSON and enforces limits', async () => {
    const input = createDocumentPageInput({schema: ref, client, navigate: vi.fn(), params: {age: 'NaN'}})
    const state = await input.read()
    expect(state.errors.join(' ')).toContain('expected a JSON value')
    expect(state.errors.join(' ')).toContain('missing required "name"')
    for (const values of [
      [],
      null,
      {bad: undefined},
      {bad: Infinity},
      {bad: Number.MAX_SAFE_INTEGER + 1},
      {bad: 1n},
      {name: 'x'.repeat(9000)},
    ])
      expect(() => encodePageInput(values)).toThrow()
    expect(decodePageInput({name: '"hello"'}).values).toEqual({name: 'hello'})
  })

  it('does not navigate after its requesting frame closes during schema loading', async () => {
    let finish!: (value: unknown) => void
    const request = vi.fn(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const navigate = vi.fn()
    const input = createDocumentPageInput({schema: ref, client: {request} as any, navigate})
    const controller = new AbortController()
    const write = input.write(person, 'push', controller.signal)
    controller.abort()
    finish({type: 'document', document: {metadata: {schemaDefinition: `ipfs://${schemaCid('example/person')}`}}})
    await expect(write).rejects.toThrow()
    expect(navigate).not.toHaveBeenCalled()
  })

  it('uses a published empty contract for pages with no parameters', async () => {
    const navigate = vi.fn()
    const input = createDocumentPageInput({schema: 'hm://hyper.media/page-input', client, navigate})
    expect((await input.read()).errors).toEqual([])
    await expect(input.write({anything: true}, 'push')).rejects.toThrow('unexpected key')
    expect(navigate).not.toHaveBeenCalled()
  })
})
