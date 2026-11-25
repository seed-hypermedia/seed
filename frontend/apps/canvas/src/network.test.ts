import {unpackHmId} from '@seed-hypermedia/client/hm-types'
import {afterEach, expect, it, vi} from 'vitest'
import {readNewEvents, applyResource, resolveSite, applyAccount, readDocument} from './network'

it('catches up across pages, including late arrivals, without replaying the checkpoint', async () => {
  const pages = [
    {events: [{id: 'late'}, {id: 'new'}], nextPageToken: 'page2'},
    {events: [{id: 'old'}], nextPageToken: ''},
  ]
  const calls: string[] = []
  const result = await readNewEvents(
    async (token) => {
      calls.push(token)
      return pages[calls.length - 1]
    },
    new Set(['old']),
  )
  expect(calls).toEqual(['', 'page2'])
  expect(result.events.map((e) => e.id)).toEqual(['late', 'new'])
  expect([...result.checkpoint]).toEqual(['late', 'new'])
})

it('does not advance the checkpoint if catch-up fails', async () => {
  const previous = new Set(['old'])
  await expect(
    readNewEvents(async (token) => {
      if (token) throw new Error('offline')
      return {events: [{id: 'new'}], nextPageToken: 'next'}
    }, previous),
  ).rejects.toThrow('offline')
  expect([...previous]).toEqual(['old'])
})

it('takes an initial baseline without replaying the entire history', async () => {
  const result = await readNewEvents(async () => ({events: [{id: 'old'}], nextPageToken: 'history'}), null)
  expect(result.events).toEqual([])
  expect([...result.checkpoint]).toEqual(['old'])
})

it('keeps redirects and tombstones as settled content-free resources', () => {
  const document = {
    id: 'hm://Alice/old',
    siteUid: 'Alice',
    origin: 'https://alice.example',
    path: ['old'],
    title: 'Old page',
    version: 'v1',
    external: false,
    commentCount: 0,
    cover: 'https://alice.example/cover.png',
    content: [{block: {id: 'p', type: 'Paragraph', text: 'Old content'}}],
  }
  const redirect = applyResource(
    document as never,
    {
      type: 'redirect',
      id: {uid: 'Alice', path: ['old']},
      redirectTarget: {uid: 'Alice', path: ['new']},
      republish: false,
    } as never,
  )
  expect(redirect.resourceType).toBe('redirect')
  expect(redirect.redirectTarget).toBe('hm://Alice/new')
  expect(redirect.content).toEqual([])
  expect(redirect.error).toBeUndefined()
  expect(redirect.cover).toBeUndefined()
  const tombstone = applyResource(redirect, {type: 'tombstone', id: {uid: 'Alice', path: ['old']}} as never)
  expect(tombstone.resourceType).toBe('tombstone')
  expect(tombstone.redirectTarget).toBeUndefined()
  expect(tombstone.content).toEqual([])
  expect(tombstone.unavailable).toBe(false)
})

afterEach(() => vi.unstubAllGlobals())

it('resolves any site URL from its own Seed headers, including gateway aliases', async () => {
  vi.stubGlobal(
    'fetch',
    async () =>
      new Response(null, {
        headers: {
          'x-hypermedia-id': encodeURIComponent('hm://Bob/'),
          'x-hypermedia-title': encodeURIComponent('Bob’s notes'),
        },
      }),
  )
  expect(await resolveSite('notes.example')).toEqual({
    uid: 'Bob',
    title: 'Bob’s notes',
    origin: 'https://notes.example',
    url: 'https://notes.example/',
  })
  expect(await resolveSite('https://gateway.example/hm/Bob')).toEqual({
    uid: 'Bob',
    title: 'Bob’s notes',
    origin: 'https://gateway.example',
    url: 'https://gateway.example/hm/Bob',
  })
})

it('maps account metadata to a person card without home-document content', () => {
  const document = {
    id: 'hm://Alice/:profile',
    siteUid: 'Alice',
    origin: 'https://alice.example',
    path: [],
    title: 'Seed account',
    version: '',
    external: true,
    commentCount: 0,
  }
  const card = applyAccount(document, {
    type: 'account',
    id: {uid: 'Alice'},
    metadata: {
      name: 'Alice',
      summary: 'Researcher',
      icon: 'ipfs://avatar',
      siteUrl: 'https://alice.example',
    },
  } as never)
  expect(card).toMatchObject({
    resourceType: 'account',
    title: 'Alice',
    summary: 'Researcher',
    avatar: 'ipfs://avatar',
    accountSiteUrl: 'https://alice.example',
    content: [],
    unavailable: false,
  })
  expect(applyAccount(document, {type: 'account-not-found', uid: 'Alice'}).error).toBeTruthy()
})

it('fetches profile cards through Account without requesting Resource', async () => {
  vi.stubGlobal('fetch', async (input: string | URL | Request) => {
    const url = new URL(String(input))
    if (url.pathname !== '/api/Account' || url.searchParams.get('id') !== 'Alice')
      throw new Error('Wrong resource endpoint')
    return Response.json({type: 'account', id: unpackHmId('hm://Alice'), metadata: {name: 'Alice'}})
  })
  const result = await readDocument({
    id: 'hm://Alice/:profile',
    siteUid: 'Alice',
    origin: 'https://alice.example',
    path: [],
    title: 'Seed account',
    version: '',
    external: true,
    commentCount: 0,
  })
  expect(result.title).toBe('Alice')
  expect(result.resourceType).toBe('account')
  expect(result.content).toEqual([])
})
