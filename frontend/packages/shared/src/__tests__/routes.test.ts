import {describe, expect, test} from 'vitest'
import {
  commentsRouteSchema,
  createDocumentNavRoute,
  createInspectIpfsNavRoute,
  createInspectNavRoute,
  createRouteFromInspectNavRoute,
  type NavRoute,
} from '../routes'
import {routeToHref} from '../routing'
import {extractViewTermFromUrl, hmId, routeToUrl, unpackHmId, viewTermToRouteKey} from '../utils/entity-id-url'
import {appRouteOfId} from '../utils/navigation'

const testDocId = hmId('testuid123')

function assertDocumentRoute(route: NavRoute | undefined): Extract<NavRoute, {key: 'document'}> {
  if (!route || route.key !== 'document') {
    throw new Error('Expected document route')
  }
  return route
}

describe('createDocumentNavRoute', () => {
  describe('no panel param', () => {
    test('returns document route without panel', () => {
      const route = createDocumentNavRoute(testDocId)
      expect(route).toEqual({key: 'document', id: testDocId, panel: null})
    })

    test('null panelParam returns document route without panel', () => {
      const route = createDocumentNavRoute(testDocId, null, null)
      expect(route).toEqual({key: 'document', id: testDocId, panel: null})
    })
  })

  describe('simple panel keys', () => {
    test('collaborators panel', () => {
      const route = createDocumentNavRoute(testDocId, null, 'collaborators')
      expect(route).toEqual({
        key: 'document',
        id: testDocId,
        panel: {key: 'collaborators', id: testDocId},
      })
    })

    test('comments panel', () => {
      const route = createDocumentNavRoute(testDocId, null, 'comments')
      expect(route).toEqual({
        key: 'document',
        id: testDocId,
        panel: {key: 'comments', id: testDocId},
      })
    })

    test('discussions panel (backward compat)', () => {
      const route = createDocumentNavRoute(testDocId, null, 'discussions')
      expect(route).toEqual({
        key: 'document',
        id: testDocId,
        panel: {key: 'comments', id: testDocId},
      })
    })

    test('activity panel', () => {
      const route = createDocumentNavRoute(testDocId, null, 'activity')
      expect(route).toEqual({
        key: 'document',
        id: testDocId,
        panel: {key: 'activity', id: testDocId},
      })
    })

    test('directory panel', () => {
      const route = createDocumentNavRoute(testDocId, null, 'directory')
      expect(route).toEqual({
        key: 'document',
        id: testDocId,
        panel: {key: 'directory', id: testDocId},
      })
    })

    test('options panel', () => {
      const route = createDocumentNavRoute(testDocId, null, 'options')
      expect(route).toEqual({
        key: 'document',
        id: testDocId,
        panel: {key: 'options'},
      })
    })
  })

  describe('extended panel formats', () => {
    test('comments panel opens document with comments right panel', () => {
      const route = createDocumentNavRoute(testDocId, null, 'comments/block123')
      expect(route).toEqual({
        key: 'document',
        id: testDocId,
        panel: {key: 'comments', id: testDocId, openComment: 'block123'},
      })
    })

    test('discussions/BLOCKID backward compat', () => {
      const route = createDocumentNavRoute(testDocId, null, 'discussions/block123')
      expect(route).toEqual({
        key: 'document',
        id: testDocId,
        panel: {key: 'comments', id: testDocId, targetBlockId: 'block123'},
      })
    })

    test('comments/ panel opens document with comments right panel + openComment', () => {
      const route = createDocumentNavRoute(testDocId, null, 'comments/uid123/path/to/comment')
      expect(route).toEqual({
        key: 'document',
        id: testDocId,
        panel: {key: 'comments', id: testDocId, openComment: 'uid123/path/to/comment'},
      })
    })

    test('comment/ backward compat opens document with comments right panel', () => {
      const route = createDocumentNavRoute(testDocId, null, 'comment/uid123/path/to/comment')
      expect(route).toEqual({
        key: 'document',
        id: testDocId,
        panel: {key: 'comments', id: testDocId, openComment: 'uid123/path/to/comment'},
      })
    })

    test('comments viewTerm + comments panel → comments main + right panel', () => {
      const route = createDocumentNavRoute(testDocId, 'comments', 'comments/uid123/tsid456')
      expect(route).toEqual({
        key: 'comments',
        id: testDocId,
        panel: {key: 'comments', id: testDocId, openComment: 'uid123/tsid456'},
      })
    })

    test('comments viewTerm + openComment → comments main with highlight', () => {
      const route = createDocumentNavRoute(testDocId, 'comments', null, 'uid123/tsid456')
      expect(route).toEqual({
        key: 'comments',
        id: testDocId,
        openComment: 'uid123/tsid456',
        panel: null,
      })
    })

    test('activity with versions filter', () => {
      const route = createDocumentNavRoute(testDocId, null, 'activity/versions')
      expect(route).toEqual({
        key: 'document',
        id: testDocId,
        panel: {key: 'activity', id: testDocId, filterEventType: ['Ref']},
      })
    })

    test('activity with comments filter', () => {
      const route = createDocumentNavRoute(testDocId, null, 'activity/comments')
      expect(route).toEqual({
        key: 'document',
        id: testDocId,
        panel: {key: 'activity', id: testDocId, filterEventType: ['Comment']},
      })
    })

    test('activity with citations filter', () => {
      const route = createDocumentNavRoute(testDocId, null, 'activity/citations')
      expect(route).toEqual({
        key: 'document',
        id: testDocId,
        panel: {
          key: 'activity',
          id: testDocId,
          filterEventType: ['comment/Embed', 'doc/Embed', 'doc/Link', 'doc/Button'],
        },
      })
    })
  })

  describe('with viewTerm', () => {
    test('activity viewTerm without panel returns activity route', () => {
      const route = createDocumentNavRoute(testDocId, 'activity', null)
      expect(route).toEqual({
        key: 'activity',
        id: testDocId,
        filterEventType: undefined,
        panel: null,
      })
    })

    test('activity viewTerm with activity/versions panelParam applies filter', () => {
      const route = createDocumentNavRoute(testDocId, 'activity', 'activity/versions')
      expect(route).toEqual({
        key: 'activity',
        id: testDocId,
        filterEventType: ['Ref'],
        panel: null,
      })
    })

    test('activity viewTerm with activity/citations panelParam applies citations filter', () => {
      const route = createDocumentNavRoute(testDocId, 'activity', 'activity/citations')
      expect(route).toEqual({
        key: 'activity',
        id: testDocId,
        filterEventType: ['comment/Embed', 'doc/Embed', 'doc/Link', 'doc/Button'],
        panel: null,
      })
    })

    test('comments viewTerm returns comments route', () => {
      const route = createDocumentNavRoute(testDocId, 'comments', null)
      expect(route).toEqual({key: 'comments', id: testDocId, panel: null})
    })

    test('directory viewTerm returns directory route', () => {
      const route = createDocumentNavRoute(testDocId, 'directory', null)
      expect(route).toEqual({key: 'directory', id: testDocId, panel: null})
    })

    test('collaborators viewTerm returns collaborators route', () => {
      const route = createDocumentNavRoute(testDocId, 'collaborators', null)
      expect(route).toEqual({key: 'collaborators', id: testDocId, panel: null})
    })

    test('feed viewTerm with panel preserves panel', () => {
      const route = createDocumentNavRoute(testDocId, 'feed', 'collaborators')
      expect(route).toEqual({
        key: 'feed',
        id: testDocId,
        panel: {key: 'collaborators', id: testDocId},
      })
    })

    test('collaborators viewTerm with panel preserves panel', () => {
      const route = createDocumentNavRoute(testDocId, 'collaborators', 'comments/abc123')
      expect(route).toEqual({
        key: 'collaborators',
        id: testDocId,
        panel: {key: 'comments', id: testDocId, openComment: 'abc123'},
      })
    })

    test('directory viewTerm with panel preserves panel', () => {
      const route = createDocumentNavRoute(testDocId, 'directory', 'comments')
      expect(route).toEqual({
        key: 'directory',
        id: testDocId,
        panel: {key: 'comments', id: testDocId},
      })
    })

    test('activity viewTerm with non-activity panel preserves panel', () => {
      const route = createDocumentNavRoute(testDocId, 'activity', 'collaborators')
      expect(route).toEqual({
        key: 'activity',
        id: testDocId,
        filterEventType: undefined,
        panel: {key: 'collaborators', id: testDocId},
      })
    })

    test('comments viewTerm with non-comments panel preserves panel', () => {
      const route = createDocumentNavRoute(testDocId, 'comments', 'activity')
      expect(route).toEqual({
        key: 'comments',
        id: testDocId,
        panel: {key: 'activity', id: testDocId},
      })
    })
  })

  describe('with path in docId', () => {
    test('preserves docId path with panel', () => {
      const docWithPath = hmId('testuid123', {path: ['docs', 'intro']})
      const route = createDocumentNavRoute(docWithPath, null, 'collaborators')
      expect(route).toEqual({
        key: 'document',
        id: docWithPath,
        panel: {key: 'collaborators', id: docWithPath},
      })
    })
  })
})

describe('createRouteFromInspectNavRoute', () => {
  test('opens document changes via the activity route', () => {
    expect(createRouteFromInspectNavRoute({key: 'inspect', id: testDocId}, 'changes')).toEqual({
      key: 'activity',
      id: testDocId,
      filterEventType: ['Ref'],
      panel: null,
    })
  })

  test('opens document citations via the activity route', () => {
    expect(createRouteFromInspectNavRoute({key: 'inspect', id: testDocId}, 'citations')).toEqual({
      key: 'activity',
      id: testDocId,
      filterEventType: ['comment/Embed', 'doc/Embed', 'doc/Link', 'doc/Button'],
      panel: null,
    })
  })

  test('opens inspector children via the directory route', () => {
    expect(createRouteFromInspectNavRoute({key: 'inspect', id: testDocId}, 'children')).toEqual({
      key: 'directory',
      id: testDocId,
      panel: null,
    })
  })

  test('opens inspected comment versions via the comments route', () => {
    expect(
      createRouteFromInspectNavRoute(
        {
          key: 'inspect',
          id: testDocId,
          targetView: 'comments',
          targetOpenComment: 'comment-123',
        },
        'versions',
      ),
    ).toEqual({
      key: 'comments',
      id: testDocId,
      openComment: 'comment-123',
      panel: null,
    })
  })
})

describe('routeToHref', () => {
  const originHome = hmId('uid1')

  test('comments route generates view-term href', () => {
    const href = routeToHref({key: 'comments', id: hmId('uid1')}, {originHomeId: originHome})
    expect(href).toBe('/:comments')
  })

  test('comments route with openComment includes commentId in path', () => {
    const href = routeToHref({key: 'comments', id: hmId('uid1'), openComment: 'z6Mk/z6FC'}, {originHomeId: originHome})
    expect(href).toBe('/:comments/z6Mk/z6FC')
  })

  test('comments route with blockRef includes fragment', () => {
    const href = routeToHref(
      {key: 'comments', id: hmId('uid1', {blockRef: 'blk1', blockRange: {expanded: true}}), openComment: 'z6Mk/z6FC'},
      {originHomeId: originHome},
    )
    expect(href).toBe('/:comments/z6Mk/z6FC#blk1+')
  })

  test('comments route with blockRef range includes fragment', () => {
    const href = routeToHref(
      {
        key: 'comments',
        id: hmId('uid1', {blockRef: 'blk1', blockRange: {start: 5, end: 10}}),
        openComment: 'z6Mk/z6FC',
      },
      {originHomeId: originHome},
    )
    expect(href).toBe('/:comments/z6Mk/z6FC#blk1[5:10]')
  })

  test('activity route with blockRef includes fragment', () => {
    const href = routeToHref({key: 'activity', id: hmId('uid1', {blockRef: 'blk2'})}, {originHomeId: originHome})
    expect(href).toBe('/:activity#blk2')
  })

  test('activity route with citations filter generates view-term href', () => {
    const href = routeToHref(
      {key: 'activity', id: hmId('uid1'), filterEventType: ['comment/Embed', 'doc/Embed', 'doc/Link', 'doc/Button']},
      {originHomeId: originHome},
    )
    expect(href).toBe('/:activity/citations')
  })

  test('comments route with doc path generates correct href', () => {
    const href = routeToHref(
      {key: 'comments', id: hmId('uid1', {path: ['docs', 'intro']}), openComment: 'z6Mk/z6FC'},
      {originHomeId: originHome},
    )
    expect(href).toBe('/docs/intro/:comments/z6Mk/z6FC')
  })

  test('comments route with different uid generates /hm/ href', () => {
    const href = routeToHref({key: 'comments', id: hmId('uid2'), openComment: 'z6Mk/z6FC'}, {originHomeId: originHome})
    expect(href).toBe('/hm/uid2/:comments/z6Mk/z6FC')
  })

  describe('view-term routes preserve panel query param', () => {
    test('collaborators route with comments panel preserves panel', () => {
      const href = routeToHref(
        {key: 'collaborators', id: hmId('uid1'), panel: {key: 'comments', id: hmId('uid1'), openComment: 'abc123'}},
        {originHomeId: originHome},
      )
      expect(href).toBe('/:collaborators?panel=comments/abc123')
    })

    test('comments route with activity panel preserves panel', () => {
      const href = routeToHref(
        {key: 'comments', id: hmId('uid1'), panel: {key: 'activity', id: hmId('uid1')}},
        {originHomeId: originHome},
      )
      expect(href).toBe('/:comments?panel=activity')
    })

    test('activity route with collaborators panel preserves panel', () => {
      const href = routeToHref(
        {key: 'activity', id: hmId('uid1'), panel: {key: 'collaborators', id: hmId('uid1')}},
        {originHomeId: originHome},
      )
      expect(href).toBe('/:activity?panel=collaborators')
    })

    test('directory route with comments panel preserves panel', () => {
      const href = routeToHref(
        {key: 'directory', id: hmId('uid1'), panel: {key: 'comments', id: hmId('uid1')}},
        {originHomeId: originHome},
      )
      expect(href).toBe('/:directory?panel=comments')
    })

    test('feed route with collaborators panel preserves panel', () => {
      const href = routeToHref(
        {key: 'feed', id: hmId('uid1'), panel: {key: 'collaborators', id: hmId('uid1')}},
        {originHomeId: originHome},
      )
      expect(href).toBe('/:feed?panel=collaborators')
    })

    test('view-term route with panel and blockRef preserves both', () => {
      const href = routeToHref(
        {
          key: 'collaborators',
          id: hmId('uid1', {blockRef: 'blk1'}),
          panel: {key: 'comments', id: hmId('uid1'), openComment: 'abc123'},
        },
        {originHomeId: originHome},
      )
      expect(href).toBe('/:collaborators?panel=comments/abc123#blk1')
    })

    test('view-term route without panel does not add query param', () => {
      const href = routeToHref({key: 'collaborators', id: hmId('uid1')}, {originHomeId: originHome})
      expect(href).toBe('/:collaborators')
    })

    test('inspect route generates inspect href', () => {
      const href = routeToHref({key: 'inspect', id: hmId('uid1')}, {originHomeId: originHome})
      expect(href).toBe('/inspect')
    })

    test('inspect route on origin site omits /hm/site prefix', () => {
      const href = routeToHref(
        {key: 'inspect', id: hmId('uid1', {path: ['docs', 'intro']})},
        {originHomeId: originHome},
      )
      expect(href).toBe('/inspect/docs/intro')
    })

    test('inspect route can wrap a nested comments view', () => {
      const href = routeToHref(
        {key: 'inspect', id: hmId('uid1'), targetView: 'comments', targetOpenComment: 'z6Mk/z6FC'},
        {originHomeId: originHome},
      )
      expect(href).toBe('/inspect/:comments/z6Mk/z6FC')
    })

    test('inspect route preserves inspector tabs in query params', () => {
      const href = routeToHref({key: 'inspect', id: hmId('uid1'), inspectTab: 'contacts'}, {originHomeId: originHome})
      expect(href).toBe('/inspect?tab=contacts')
    })

    test('inspect route supports explorer parity tabs in query params', () => {
      const href = routeToHref({key: 'inspect', id: hmId('uid1'), inspectTab: 'versions'}, {originHomeId: originHome})
      expect(href).toBe('/inspect?tab=versions')
    })

    test('inspect ipfs route generates inspect ipfs href', () => {
      const href = routeToHref(createInspectIpfsNavRoute('bafy123/path/to/node'), {originHomeId: originHome})
      expect(href).toBe('/inspect/ipfs/bafy123/path/to/node')
    })
  })

  describe('site-profile route', () => {
    test('self profile on same-origin site generates /:profile', () => {
      const href = routeToHref({key: 'site-profile', id: hmId('uid1'), tab: 'profile'}, {originHomeId: originHome})
      expect(href).toBe('/:profile')
    })

    test('self profile on different site generates /hm/uid/:profile', () => {
      const href = routeToHref({key: 'site-profile', id: hmId('uid2'), tab: 'profile'}, {originHomeId: originHome})
      expect(href).toBe('/hm/uid2/:profile')
    })

    test('other person profile within same-origin site uses /:profile/accountUid', () => {
      const href = routeToHref(
        {key: 'site-profile', id: hmId('uid1'), accountUid: 'otherPerson', tab: 'profile'},
        {originHomeId: originHome},
      )
      expect(href).toBe('/:profile/otherPerson')
    })

    test('other person profile on different site (gateway) generates /hm/siteUid/:profile/accountUid', () => {
      const href = routeToHref(
        {key: 'site-profile', id: hmId('uid2'), accountUid: 'otherPerson', tab: 'profile'},
        {originHomeId: originHome},
      )
      expect(href).toBe('/hm/uid2/:profile/otherPerson')
    })

    test('other tabs follow the same pattern', () => {
      const href = routeToHref(
        {key: 'site-profile', id: hmId('uid2'), accountUid: 'otherPerson', tab: 'followers'},
        {originHomeId: originHome},
      )
      expect(href).toBe('/hm/uid2/:followers/otherPerson')
    })
  })
})

describe('createDocumentNavRoute - site-profile', () => {
  test.each([
    ['profile', 'profile'],
    ['membership', 'membership'],
    ['followers', 'followers'],
    ['following', 'following'],
  ] as const)('%s viewTerm returns site-profile route', (viewTerm, tab) => {
    const route = createDocumentNavRoute(testDocId, viewTerm)
    expect(route).toEqual({key: 'site-profile', id: testDocId, accountUid: undefined, tab})
  })

  test('profile-family viewTerm with accountUid returns site-profile route with accountUid', () => {
    const route = createDocumentNavRoute(testDocId, 'profile', null, null, 'otherUid')
    expect(route).toEqual({key: 'site-profile', id: testDocId, accountUid: 'otherUid', tab: 'profile'})
  })
})

describe('site-profile URL round-trip', () => {
  test('gateway URL with profile of another person round-trips correctly', () => {
    const originalUrl = 'https://gw.com/hm/siteUid/:profile/personUid'

    const {url: cleanUrl, viewTerm, accountUid} = extractViewTermFromUrl(originalUrl)
    expect(cleanUrl).toBe('https://gw.com/hm/siteUid')
    expect(viewTerm).toBe(':profile')
    expect(accountUid).toBe('personUid')

    const route = {key: 'site-profile' as const, id: hmId('siteUid'), accountUid, tab: 'profile' as const}
    expect(route).toEqual({
      key: 'site-profile',
      id: hmId('siteUid'),
      accountUid: 'personUid',
      tab: 'profile',
    })

    const regeneratedUrl = routeToUrl(route, {hostname: 'https://gw.com'})
    expect(regeneratedUrl).toBe(originalUrl)
  })

  test('site-domain URL with profile of another person round-trips correctly', () => {
    const originHome = hmId('siteUid')
    const inputUrl = 'https://mysite.com/:profile/personUid'
    const {url: cleanUrl, viewTerm, accountUid} = extractViewTermFromUrl(inputUrl)
    expect(cleanUrl).toBe('https://mysite.com')
    expect(viewTerm).toBe(':profile')
    expect(accountUid).toBe('personUid')

    const route = {key: 'site-profile' as const, id: hmId('siteUid'), accountUid, tab: 'profile' as const}
    const regeneratedUrl = routeToUrl(route, {hostname: 'https://mysite.com', originHomeId: originHome})
    expect(regeneratedUrl).toBe(inputUrl)
  })

  test('self profile URL round-trips correctly', () => {
    const originalUrl = 'https://gw.com/hm/siteUid/:profile'

    const {url: cleanUrl, viewTerm, accountUid} = extractViewTermFromUrl(originalUrl)
    expect(cleanUrl).toBe('https://gw.com/hm/siteUid')
    expect(viewTerm).toBe(':profile')
    expect(accountUid).toBeUndefined()

    const route = {key: 'site-profile' as const, id: hmId('siteUid'), accountUid, tab: 'profile' as const}

    const regeneratedUrl = routeToUrl(route, {hostname: 'https://gw.com'})
    expect(regeneratedUrl).toBe(originalUrl)
  })

  test('routeToHref round-trips for gateway followers URL', () => {
    const originHome = hmId('originUid')
    const route = {
      key: 'site-profile' as const,
      id: hmId('siteUid'),
      accountUid: 'personUid',
      tab: 'followers' as const,
    }
    const href = routeToHref(route, {originHomeId: originHome})
    expect(href).toBe('/hm/siteUid/:followers/personUid')

    const {url: cleanHref, viewTerm, accountUid} = extractViewTermFromUrl(href!)
    expect(cleanHref).toBe('/hm/siteUid')
    expect(viewTerm).toBe(':followers')
    expect(accountUid).toBe('personUid')
  })

  test('non-profile gateway URL is not misidentified', () => {
    const cleanUrl = 'https://gw.com/hm/siteUid/some/path'
    const parsed = extractViewTermFromUrl(cleanUrl)
    expect(parsed).toEqual({url: cleanUrl, isInspect: false, viewTerm: null})
  })

  test('inspect URL round-trips correctly', () => {
    const originalUrl = 'https://gw.com/hm/inspect/siteUid'

    const {url: cleanUrl, isInspect, viewTerm} = extractViewTermFromUrl(originalUrl)
    expect(cleanUrl).toBe('https://gw.com/hm/siteUid')
    expect(isInspect).toBe(true)
    expect(viewTerm).toBeNull()

    const route = createInspectNavRoute(hmId('siteUid'))
    expect(route).toEqual({key: 'inspect', id: hmId('siteUid')})

    const regeneratedUrl = routeToUrl(route, {hostname: 'https://gw.com'})
    expect(regeneratedUrl).toBe(originalUrl)
  })

  test('inspect comments URL round-trips correctly', () => {
    const originalUrl = 'https://gw.com/hm/inspect/siteUid/path/:comments/z6Mk/z6FC'

    const {url: cleanUrl, isInspect, viewTerm, commentId} = extractViewTermFromUrl(originalUrl)
    expect(cleanUrl).toBe('https://gw.com/hm/siteUid/path')
    expect(isInspect).toBe(true)
    expect(viewTerm).toBe(':comments')
    expect(commentId).toBe('z6Mk/z6FC')

    const route = createInspectNavRoute(
      hmId('siteUid', {path: ['path']}),
      viewTermToRouteKey(viewTerm),
      null,
      commentId,
    )
    expect(route).toEqual({
      key: 'inspect',
      id: hmId('siteUid', {path: ['path']}),
      targetView: 'comments',
      targetOpenComment: 'z6Mk/z6FC',
    })

    const regeneratedUrl = routeToUrl(route, {hostname: 'https://gw.com'})
    expect(regeneratedUrl).toBe(originalUrl)
  })

  test('site with custom domain: other tabs use the same site-domain format', () => {
    const siteDomain = 'https://formula-1.dev.hyper.media'
    const route = {
      key: 'site-profile' as const,
      id: hmId('siteUid'),
      accountUid: 'personUid',
      tab: 'following' as const,
    }
    const displayUrl = routeToUrl(route, {hostname: siteDomain, originHomeId: hmId('siteUid')})
    expect(displayUrl).toBe(`${siteDomain}/:following/personUid`)
  })

  test('gateway URL: profile-family URLs include siteUid once', () => {
    const displayUrl = routeToUrl(
      {key: 'site-profile', id: hmId('siteUid'), accountUid: 'personUid', tab: 'membership'},
      {hostname: 'https://dev.hyper.media'},
    )
    expect(displayUrl).toBe('https://dev.hyper.media/hm/siteUid/:membership/personUid')
    expect(displayUrl.includes('/hm/siteUid/hm/personUid')).toBe(false)
  })
})

describe('search-input gateway shortcut: profile URL via unpackHmId', () => {
  function applyViewTermToRoute(
    route: Extract<NavRoute, {key: 'document'}>,
    routeKey: ReturnType<typeof viewTermToRouteKey>,
    accountUid?: string,
  ): NavRoute {
    if (!routeKey) return route
    if (routeKey === 'profile' || routeKey === 'membership' || routeKey === 'followers' || routeKey === 'following') {
      return {key: 'site-profile', id: route.id, accountUid: accountUid || undefined, tab: routeKey}
    }
    return {key: routeKey, id: route.id}
  }

  test('gateway profile URL is correctly parsed via unpackHmId + view term extraction', () => {
    const inputUrl = 'https://dev.hyper.media/hm/z6MkjYX464/:profile/z6Mkf6sj8W'

    const rawUnpacked = unpackHmId(inputUrl)
    expect(rawUnpacked).not.toBeNull()
    expect(rawUnpacked!.uid).toBe('z6MkjYX464')
    expect(rawUnpacked!.path).toEqual([':profile', 'z6Mkf6sj8W'])

    const {url: cleanUrl, viewTerm, accountUid} = extractViewTermFromUrl(inputUrl)
    expect(cleanUrl).toBe('https://dev.hyper.media/hm/z6MkjYX464')
    expect(viewTerm).toBe(':profile')
    expect(accountUid).toBe('z6Mkf6sj8W')
    const routeKey = viewTermToRouteKey(viewTerm)
    expect(routeKey).toBe('profile')

    const unpacked = unpackHmId(cleanUrl)
    expect(unpacked).not.toBeNull()
    expect(unpacked!.uid).toBe('z6MkjYX464')
    expect(unpacked!.path).toEqual([])

    const docRoute = assertDocumentRoute(appRouteOfId(unpacked!))
    expect(docRoute).not.toBeNull()
    expect(docRoute.key).toBe('document')

    const finalRoute = applyViewTermToRoute(docRoute, routeKey, accountUid)
    expect(finalRoute).toEqual({
      key: 'site-profile',
      id: expect.objectContaining({uid: 'z6MkjYX464', path: []}),
      accountUid: 'z6Mkf6sj8W',
      tab: 'profile',
    })

    const regeneratedUrl = routeToUrl(finalRoute, {hostname: 'https://dev.hyper.media'})
    expect(regeneratedUrl).toBe(inputUrl)
  })

  test('self profile URL via gateway shortcut', () => {
    const inputUrl = 'https://dev.hyper.media/hm/z6MkjYX464/:profile'

    const {url: cleanUrl, viewTerm, accountUid} = extractViewTermFromUrl(inputUrl)
    const routeKey = viewTermToRouteKey(viewTerm)

    const unpacked = unpackHmId(cleanUrl)
    expect(unpacked!.uid).toBe('z6MkjYX464')
    expect(unpacked!.path).toEqual([])
    expect(accountUid).toBeUndefined()

    const docRoute = assertDocumentRoute(appRouteOfId(unpacked!))
    const finalRoute = applyViewTermToRoute(docRoute, routeKey, accountUid)
    expect(finalRoute).toEqual({
      key: 'site-profile',
      id: expect.objectContaining({uid: 'z6MkjYX464'}),
      accountUid: undefined,
      tab: 'profile',
    })

    const regeneratedUrl = routeToUrl(finalRoute, {hostname: 'https://dev.hyper.media'})
    expect(regeneratedUrl).toBe(inputUrl)
  })

  test('without view term extraction, /:profile ends up in path (the bug)', () => {
    const inputUrl = 'https://dev.hyper.media/hm/z6MkjYX464/:profile/z6Mkf6sj8W'

    const unpacked = unpackHmId(inputUrl)
    expect(unpacked!.path).toEqual([':profile', 'z6Mkf6sj8W'])
    const docRoute = assertDocumentRoute(appRouteOfId(unpacked!))
    expect(docRoute.id.path).toEqual([':profile', 'z6Mkf6sj8W'])
  })
})

describe('commentsRouteSchema reply version fields', () => {
  const baseRoute = {key: 'comments' as const, id: testDocId}

  test('accepts replyCommentVersion and rootReplyCommentVersion', () => {
    const route = {
      ...baseRoute,
      openComment: 'author/tsid',
      isReplying: true,
      replyCommentVersion: 'bafyReplyVersion123',
      rootReplyCommentVersion: 'bafyRootVersion456',
    }
    const parsed = commentsRouteSchema.parse(route)
    expect(parsed.replyCommentVersion).toBe('bafyReplyVersion123')
    expect(parsed.rootReplyCommentVersion).toBe('bafyRootVersion456')
    expect(parsed.isReplying).toBe(true)
  })

  test('version fields are optional', () => {
    const parsed = commentsRouteSchema.parse(baseRoute)
    expect(parsed.replyCommentVersion).toBeUndefined()
    expect(parsed.rootReplyCommentVersion).toBeUndefined()
  })

  test('version fields can be set independently', () => {
    const route = {
      ...baseRoute,
      openComment: 'author/tsid',
      replyCommentVersion: 'bafyReplyOnly',
    }
    const parsed = commentsRouteSchema.parse(route)
    expect(parsed.replyCommentVersion).toBe('bafyReplyOnly')
    expect(parsed.rootReplyCommentVersion).toBeUndefined()
  })
})
