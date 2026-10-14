import {describe, expect, test} from 'bun:test'
import {SERVICE_SECRET_HEADER, withHmServerAuth} from '@/hm-server-auth'

type Call = {url: string; secret: string | null; method: string; redirect: RequestRedirect | undefined}

/** A fake fetch that records calls and answers from a route table. */
function fakeFetch(routes: Record<string, () => Response>) {
  const calls: Call[] = []
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    calls.push({
      url,
      secret: new Headers(init?.headers).get(SERVICE_SECRET_HEADER),
      method: init?.method ?? 'GET',
      redirect: init?.redirect,
    })
    return routes[url]?.() ?? new Response('ok')
  }) as typeof fetch
  return {fn, calls}
}

const redirect =
  (to: string, status = 302) =>
  () =>
    new Response(null, {status, headers: {Location: to}})

describe('withHmServerAuth', () => {
  test('adds the secret to requests for the site, and only those', async () => {
    const {fn, calls} = fakeFetch({})
    const authed = withHmServerAuth(fn, ['https://site.example'], 's3cret')
    await authed('https://site.example/api/ListEvents?x=1', {headers: {Accept: 'application/json'}})
    await authed('https://elsewhere.example/page')
    expect(calls[0]!.secret).toBe('s3cret')
    expect(calls[1]!.secret).toBeNull()
  })

  test('follows a same-origin redirect with the secret and drops it when leaving the site', async () => {
    const {fn, calls} = fakeFetch({
      'https://site.example/a': redirect('/b'),
      'https://site.example/b': redirect('https://elsewhere.example/c'),
    })
    const response = await withHmServerAuth(fn, ['https://site.example'], 's3cret')('https://site.example/a')
    expect(await response.text()).toBe('ok')
    expect(calls.map((c) => [c.url, c.secret])).toEqual([
      ['https://site.example/a', 's3cret'],
      ['https://site.example/b', 's3cret'],
      ['https://elsewhere.example/c', null],
    ])
  })

  test('turns a redirected POST into a GET and hands back redirects the caller handles itself', async () => {
    const {fn, calls} = fakeFetch({'https://site.example/post': redirect('/done', 303)})
    const authed = withHmServerAuth(fn, ['https://site.example'], 's3cret')
    await authed('https://site.example/post', {method: 'POST', body: 'x'})
    expect(calls[1]).toMatchObject({url: 'https://site.example/done', method: 'GET'})
    const manual = await authed('https://site.example/post', {method: 'POST', redirect: 'manual'})
    expect(manual.status).toBe(303)
  })
})
