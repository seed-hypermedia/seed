import {afterEach, describe, expect, it, vi} from 'vitest'
import {findAppServer} from '../agents/client'
import {appServerVerdict} from '../apps/app-server-select'

/** A fetch that answers from a table of URL to [content type, body]; anything else is the site's web page. */
function stubFetch(table: Record<string, [string, unknown]>) {
  const asked: string[] = []
  vi.stubGlobal('fetch', async (input: string | URL) => {
    const url = String(input)
    asked.push(url)
    const hit = table[url]
    if (!hit) return new Response('<!DOCTYPE html>', {status: 200, headers: {'content-type': 'text/html'}})
    return new Response(JSON.stringify(hit[1]), {status: 200, headers: {'content-type': hit[0]}})
  })
  return asked
}

afterEach(() => vi.unstubAllGlobals())

describe('finding an app server from what someone typed', () => {
  it('asks the site which app environment it uses, so a host name is enough', async () => {
    stubFetch({
      'https://hyper.media/hm/api/config': ['application/json', {agentServerUrl: 'https://apps.seed.hyper.media/'}],
    })
    expect(await findAppServer(' hyper.media ')).toBe('https://apps.seed.hyper.media')
  })

  it('prefers appEnvironmentUrl over the older agentServerUrl', async () => {
    stubFetch({
      'https://example.com/hm/api/config': [
        'application/json',
        {appEnvironmentUrl: 'https://example.com/hm/api/apps', agentServerUrl: 'https://old.example.com'},
      ],
    })
    expect(await findAppServer('https://example.com/some/page')).toBe('https://example.com/hm/api/apps')
  })

  it('finds a server the site serves under /hm/api/apps without advertising it', async () => {
    stubFetch({
      'https://example.com/hm/api/config': ['application/json', {hostname: 'https://example.com'}],
      'https://example.com/hm/api/apps/health': ['application/json', {status: 'ok'}],
    })
    expect(await findAppServer('example.com')).toBe('https://example.com/hm/api/apps')
  })

  it('finds a server on its own host, and uses http for a local one', async () => {
    stubFetch({'http://localhost:3051/agents/api/health': ['application/json', {status: 'ok'}]})
    expect(await findAppServer('localhost:3051')).toBe('http://localhost:3051')
  })

  it('takes a full server URL as written when it answers', async () => {
    const asked = stubFetch({'https://example.com/hm/api/apps/health': ['application/json', {status: 'ok'}]})
    expect(await findAppServer('https://example.com/hm/api/apps/')).toBe('https://example.com/hm/api/apps')
    expect(asked).toEqual(['https://example.com/hm/api/apps/health'])
  })

  it('says so when a site answers every path with its web page', async () => {
    stubFetch({})
    await expect(findAppServer('example.com')).rejects.toThrow('No app server answers at example.com')
    await expect(findAppServer('')).rejects.toThrow('Type a server')
    await expect(findAppServer('ftp://example.com')).rejects.toThrow('not a server name')
  })
})

describe('what a server answered, in words', () => {
  const idle = {isError: false, isInitialLoading: false}
  it('covers checking, ready, running, refused and unreachable', () => {
    expect(appServerVerdict({...idle, isInitialLoading: true})).toEqual({tone: 'checking', text: 'Checking…'})
    expect(appServerVerdict({...idle, data: {allowed: true, run: null}}).text).toBe('Ready to run this app')
    expect(appServerVerdict({...idle, data: {allowed: true, run: {} as never}}).text).toBe('Already running here')
    expect(appServerVerdict({...idle, data: {allowed: false, reason: 'Members only', run: null}})).toEqual({
      tone: 'no',
      text: 'Members only',
    })
    expect(appServerVerdict({...idle, isError: true, error: new TypeError('Failed to fetch')})).toEqual({
      tone: 'no',
      text: 'Not reachable',
    })
    expect(appServerVerdict(idle)).toEqual({tone: 'idle', text: ''})
  })
})
