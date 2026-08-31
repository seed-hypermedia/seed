import {afterEach, describe, expect, it} from 'vitest'
import {
  buildExtensionRouteHref,
  extensionMountPathPrefix,
  extensionQueryFromSearch,
  extensionRequestTarget,
  extensionSubPathFromPathname,
  isExtensionInternalNavigation,
  isWithinExtensionMount,
  resolveExtensionRequest,
  resolveExtensionRoute,
  setActiveExtensionMountPrefix,
} from './extension-route'
import {shouldRevalidateDocumentRoute} from './routes/revalidation'

const homeMetadata = {
  name: 'My Site',
  extensions: {
    board: {ext: 'hm://z6MkAuthor/kanban', version: 'bafyBoard', title: 'Board'},
    'tools/stats': {ext: 'hm://z6MkAuthor/stats'},
    tools: {ext: 'hm://z6MkAuthor/tools'},
    broken: {ext: 'not-an-hm-url'},
    removed: null,
  },
}

describe('resolveExtensionRoute', () => {
  it('matches the mount and returns the sub path', () => {
    const match = resolveExtensionRoute(homeMetadata, ['board', 'card', 'abc'])
    expect(match).not.toBeNull()
    expect(match!.mountPath).toBe('board')
    expect(match!.mountSegments).toEqual(['board'])
    expect(match!.subPath).toEqual(['card', 'abc'])
    expect(match!.record.ext).toBe('hm://z6MkAuthor/kanban')
  })

  it('matches the mount path exactly with an empty sub path', () => {
    expect(resolveExtensionRoute(homeMetadata, ['board'])!.subPath).toEqual([])
  })

  it('prefers the longest mount', () => {
    expect(resolveExtensionRoute(homeMetadata, ['tools', 'stats', 'x'])!.mountPath).toBe('tools/stats')
    expect(resolveExtensionRoute(homeMetadata, ['tools', 'other'])!.mountPath).toBe('tools')
  })

  it('strips view terms before matching so a mount shadows every document view', () => {
    expect(resolveExtensionRoute(homeMetadata, ['board', ':activity'])!.subPath).toEqual([])
    expect(resolveExtensionRoute(homeMetadata, ['board', ':comments', 'uid', 'tsid'])!.mountPath).toBe('board')
    expect(resolveExtensionRoute(homeMetadata, ['board', ':activity', 'versions'])!.subPath).toEqual([])
  })

  it('returns null for unmounted paths, the home path, invalid records and missing metadata', () => {
    expect(resolveExtensionRoute(homeMetadata, ['docs'])).toBeNull()
    expect(resolveExtensionRoute(homeMetadata, [])).toBeNull()
    expect(resolveExtensionRoute(homeMetadata, ['broken'])).toBeNull()
    expect(resolveExtensionRoute(homeMetadata, ['removed'])).toBeNull()
    expect(resolveExtensionRoute(null, ['board'])).toBeNull()
    expect(resolveExtensionRoute({}, ['board'])).toBeNull()
  })
})

const REGISTERED = 'z6MkRegisteredSite'
const FOREIGN = 'z6MkiAKDcRSzQ4zPZfnJcS5HYx5MwgN6MU9foHihJGrhqNBj'

describe('extensionRequestTarget', () => {
  it('addresses the registered site for site-native paths', () => {
    expect(extensionRequestTarget(['board', 'card'], REGISTERED)).toEqual({
      siteUid: REGISTERED,
      pathParts: ['board', 'card'],
    })
    expect(extensionRequestTarget([], REGISTERED)).toEqual({siteUid: REGISTERED, pathParts: []})
  })

  it('addresses the visited account for gateway paths', () => {
    expect(extensionRequestTarget(['hm', FOREIGN, 'board', 'x'], REGISTERED)).toEqual({
      siteUid: FOREIGN,
      pathParts: ['board', 'x'],
    })
    expect(extensionRequestTarget(['hm', REGISTERED, 'board'], REGISTERED)).toEqual({
      siteUid: REGISTERED,
      pathParts: ['board'],
    })
  })

  it('never treats inspector or utility paths as extension pages', () => {
    expect(extensionRequestTarget(['inspect', 'board'], REGISTERED)).toBeNull()
    expect(extensionRequestTarget(['hm', 'inspect', FOREIGN, 'board'], REGISTERED)).toBeNull()
    expect(extensionRequestTarget(['hm', 'profile', FOREIGN], REGISTERED)).toBeNull()
    expect(extensionRequestTarget(['hm'], REGISTERED)).toBeNull()
  })
})

describe('resolveExtensionRequest (loader branch)', () => {
  const homes: Record<string, unknown> = {
    [REGISTERED]: {name: 'Registered', extensions: {docs: {ext: 'hm://z6MkAuthor/docs-ext'}}},
    [FOREIGN]: {name: 'Foreign', extensions: {board: {ext: 'hm://z6MkAuthor/kanban', version: 'bafyBoard'}}},
  }
  function lookup() {
    const calls: string[] = []
    const getHomeMetadata = async (uid: string) => {
      calls.push(uid)
      return homes[uid] ?? {}
    }
    return {calls, getHomeMetadata}
  }

  it('resolves a foreign account mount on the gateway form against THAT account home document', async () => {
    const {calls, getHomeMetadata} = lookup()
    const match = await resolveExtensionRequest(['hm', FOREIGN, 'board', 'card', '7'], REGISTERED, getHomeMetadata)
    expect(calls).toEqual([FOREIGN])
    expect(match).toMatchObject({
      siteUid: FOREIGN,
      mountPath: 'board',
      mountSegments: ['board'],
      subPath: ['card', '7'],
      record: {ext: 'hm://z6MkAuthor/kanban', version: 'bafyBoard'},
    })
  })

  it('does not match the registered site installs when visiting a foreign account', async () => {
    const {getHomeMetadata} = lookup()
    expect(await resolveExtensionRequest(['hm', FOREIGN, 'docs'], REGISTERED, getHomeMetadata)).toBeNull()
  })

  it('resolves registered site mounts on the site-native and gateway forms', async () => {
    const {calls, getHomeMetadata} = lookup()
    expect(await resolveExtensionRequest(['docs', 'a'], REGISTERED, getHomeMetadata)).toMatchObject({
      siteUid: REGISTERED,
      mountPath: 'docs',
      subPath: ['a'],
    })
    expect(await resolveExtensionRequest(['hm', REGISTERED, 'docs'], REGISTERED, getHomeMetadata)).toMatchObject({
      siteUid: REGISTERED,
      subPath: [],
    })
    expect(calls).toEqual([REGISTERED, REGISTERED])
  })

  it('skips the lookup entirely for the home path and inspector paths', async () => {
    const {calls, getHomeMetadata} = lookup()
    expect(await resolveExtensionRequest([], REGISTERED, getHomeMetadata)).toBeNull()
    expect(await resolveExtensionRequest(['hm', FOREIGN], REGISTERED, getHomeMetadata)).toBeNull()
    expect(await resolveExtensionRequest(['inspect', 'docs'], REGISTERED, getHomeMetadata)).toBeNull()
    expect(calls).toEqual([])
  })

  it('returns null for unknown accounts without throwing', async () => {
    const {getHomeMetadata} = lookup()
    expect(await resolveExtensionRequest(['hm', 'z6MkNobody', 'board'], REGISTERED, getHomeMetadata)).toBeNull()
  })
})

describe('mount path helpers', () => {
  it('computes the mount prefix on the site origin and on gateway paths', () => {
    expect(extensionMountPathPrefix('/board/card/1', 'z6MkSite', ['board'])).toBe('/board')
    expect(extensionMountPathPrefix('/hm/z6MkSite/board/card/1', 'z6MkSite', ['board'])).toBe('/hm/z6MkSite/board')
    expect(extensionMountPathPrefix('/tools/stats', 'z6MkSite', ['tools', 'stats'])).toBe('/tools/stats')
  })

  it('derives the sub path from the location', () => {
    expect(extensionSubPathFromPathname('/board', '/board')).toEqual([])
    expect(extensionSubPathFromPathname('/board/', '/board')).toEqual([])
    expect(extensionSubPathFromPathname('/board/card/a%20b', '/board')).toEqual(['card', 'a b'])
    expect(extensionSubPathFromPathname('/hm/z6MkSite/board/x', '/hm/z6MkSite/board')).toEqual(['x'])
    expect(extensionSubPathFromPathname('/docs', '/board')).toEqual([])
  })

  it('checks whether a path is within a mount', () => {
    expect(isWithinExtensionMount('/board', '/board')).toBe(true)
    expect(isWithinExtensionMount('/board/card', '/board')).toBe(true)
    expect(isWithinExtensionMount('/boardroom', '/board')).toBe(false)
    expect(isWithinExtensionMount('/', '/board')).toBe(false)
  })

  it('builds hrefs beneath the mount with encoding and query', () => {
    expect(buildExtensionRouteHref('/board', [], undefined)).toBe('/board')
    expect(buildExtensionRouteHref('/board', ['card', 'a b'], undefined)).toBe('/board/card/a%20b')
    expect(buildExtensionRouteHref('/board', ['card'], {tab: 'done', q: 'x y'})).toBe('/board/card?tab=done&q=x+y')
    expect(buildExtensionRouteHref('/hm/z6MkSite/board', ['x'], {})).toBe('/hm/z6MkSite/board/x')
  })

  it('parses the query string', () => {
    expect(extensionQueryFromSearch('?tab=done&q=x+y')).toEqual({tab: 'done', q: 'x y'})
    expect(extensionQueryFromSearch('')).toEqual({})
    expect(extensionQueryFromSearch('?extdev=http://localhost:5181&tab=done')).toEqual({tab: 'done'})
  })
})

describe('extension-internal navigation and loader revalidation', () => {
  afterEach(() => setActiveExtensionMountPrefix(null))

  function url(path: string) {
    return new URL(path, 'https://example.com')
  }

  it('is never internal without an active mount', () => {
    expect(isExtensionInternalNavigation('/board', '/board/card')).toBe(false)
    expect(
      shouldRevalidateDocumentRoute({
        currentUrl: url('/board'),
        nextUrl: url('/board/card'),
        defaultShouldRevalidate: true,
      }),
    ).toBe(true)
  })

  it('skips the loader for navigations that stay inside the active mount', () => {
    setActiveExtensionMountPrefix('/board')
    expect(isExtensionInternalNavigation('/board', '/board/card/1')).toBe(true)
    expect(
      shouldRevalidateDocumentRoute({
        currentUrl: url('/board?tab=a'),
        nextUrl: url('/board/card/1?tab=b'),
        defaultShouldRevalidate: true,
      }),
    ).toBe(false)
    expect(
      shouldRevalidateDocumentRoute({
        currentUrl: url('/board/card/1'),
        nextUrl: url('/board'),
        defaultShouldRevalidate: true,
      }),
    ).toBe(false)
  })

  it('still revalidates when leaving the mount', () => {
    setActiveExtensionMountPrefix('/board')
    expect(isExtensionInternalNavigation('/board/card', '/docs')).toBe(false)
    expect(
      shouldRevalidateDocumentRoute({
        currentUrl: url('/board/card'),
        nextUrl: url('/docs'),
        defaultShouldRevalidate: true,
      }),
    ).toBe(true)
    expect(
      shouldRevalidateDocumentRoute({currentUrl: url('/docs'), nextUrl: url('/board'), defaultShouldRevalidate: true}),
    ).toBe(true)
  })
})
