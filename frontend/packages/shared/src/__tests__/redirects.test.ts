import {describe, expect, test} from 'vitest'
import type {HMResource, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {followRedirects, MAX_REDIRECT_HOPS} from '../redirects'
import {hmId} from '../utils/entity-id-url'

const docA = hmId('uid1', {path: ['doc-a']})
const docB = hmId('uid1', {path: ['doc-b']})
const docC = hmId('uid2', {path: ['doc-c']})

const document = (id: UnpackedHypermediaId): HMResource => ({type: 'document', id, document: {} as any})
const redirect = (id: UnpackedHypermediaId, to: UnpackedHypermediaId, republish = false): HMResource => ({
  type: 'redirect',
  id,
  redirectTarget: to,
  republish,
})

function world(map: Record<string, HMResource>) {
  const calls: string[] = []
  const fetch = async (id: UnpackedHypermediaId) => {
    calls.push(id.id)
    return map[id.id] ?? ({type: 'not-found', id} satisfies HMResource)
  }
  return {fetch, calls}
}

describe('followRedirects', () => {
  test('a document is returned as-is with no republish source', async () => {
    const {fetch, calls} = world({[docA.id]: document(docA)})
    const walk = await followRedirects(fetch, docA)
    expect(walk).toMatchObject({resource: {type: 'document', id: docA}, republishSourceId: null, visited: [docA.id]})
    expect(calls).toEqual([docA.id])
  })

  test('a move chain ends at the target and presents it there', async () => {
    const {fetch} = world({[docA.id]: redirect(docA, docB), [docB.id]: document(docB)})
    const walk = await followRedirects(fetch, docA)
    expect(walk.resource).toMatchObject({type: 'document', id: docB})
    expect(walk.republishSourceId).toBeNull()
  })

  test('a republish chain presents the target at the first republish address', async () => {
    const {fetch} = world({
      [docA.id]: redirect(docA, docB, true),
      [docB.id]: redirect(docB, docC, true),
      [docC.id]: document(docC),
    })
    const walk = await followRedirects(fetch, docA)
    expect(walk.resource).toMatchObject({type: 'document', id: docC})
    expect(walk.republishSourceId).toEqual(docA)
    expect(walk.visited).toEqual([docA.id, docB.id, docC.id])
  })

  test('stopAtMove returns a first-hop move unfollowed, for the caller to redirect', async () => {
    const {fetch, calls} = world({[docA.id]: redirect(docA, docB), [docB.id]: document(docB)})
    const walk = await followRedirects(fetch, docA, {stopAtMove: true})
    expect(walk.resource).toMatchObject({type: 'redirect', redirectTarget: docB, republish: false})
    expect(calls).toEqual([docA.id])
  })

  test('stopAtMove still follows a move met after a republish, since the republish is what is presented', async () => {
    const {fetch} = world({
      [docA.id]: redirect(docA, docB, true),
      [docB.id]: redirect(docB, docC),
      [docC.id]: document(docC),
    })
    const walk = await followRedirects(fetch, docA, {stopAtMove: true})
    expect(walk.resource).toMatchObject({type: 'document', id: docC})
    expect(walk.republishSourceId).toEqual(docA)
  })

  test('a cycle stops before the repeated address is fetched again', async () => {
    const {fetch, calls} = world({[docA.id]: redirect(docA, docB), [docB.id]: redirect(docB, docA)})
    const walk = await followRedirects(fetch, docA)
    expect(walk.stopped).toBe('cycle')
    expect(walk.resource).toMatchObject({
      type: 'error',
      id: docA,
      message: 'Redirect cycle detected while resolving resource',
    })
    expect(walk.visited).toEqual([docA.id, docB.id, docA.id])
    expect(calls).toEqual([docA.id, docB.id])
  })

  test('a chain longer than the hop limit gives up without fetching past it', async () => {
    const ids = Array.from({length: MAX_REDIRECT_HOPS + 3}, (_, i) => hmId('uid1', {path: [`hop-${i}`]}))
    const map: Record<string, HMResource> = {}
    ids.forEach((id, i) => {
      map[id.id] = i < ids.length - 1 ? redirect(id, ids[i + 1]!) : document(id)
    })
    const {fetch, calls} = world(map)
    const walk = await followRedirects(fetch, ids[0]!)
    expect(walk.stopped).toBe('limit')
    expect(walk.resource).toMatchObject({type: 'error', message: 'Too many redirects while resolving resource'})
    expect(calls).toHaveLength(MAX_REDIRECT_HOPS + 1)
  })

  test('the target inherits the hostname of the address it was reached from', async () => {
    const webA = hmId('uid1', {path: ['a'], hostname: 'https://site.example'})
    const {fetch, calls} = world({[webA.id]: redirect(webA, docB), [docB.id]: document(docB)})
    await followRedirects(fetch, webA)
    expect(calls).toEqual([webA.id, docB.id])
  })

  test('the not-found at the end of a chain is returned, not thrown', async () => {
    const {fetch} = world({[docA.id]: redirect(docA, docB, true)})
    const walk = await followRedirects(fetch, docA)
    expect(walk.resource).toMatchObject({type: 'not-found', id: docB})
    expect(walk.republishSourceId).toEqual(docA)
  })
})
