import {describe, expect, test} from 'vitest'
import {
  createCommentUrl,
  createSiteUrl,
  createWebHMUrl,
  hmId,
  idToUrl,
  packHmId,
  parseCustomURL,
  parseFragment,
  routeToUrl,
  serializeBlockRange,
  unpackHmId,
} from '../entity-id-url'

describe('unpackHmId', () => {
  test('unpacks hm://abc', () => {
    expect(unpackHmId('hm://abc')).toEqual({
      id: 'hm://abc',
      scheme: 'hm',
      hostname: null,
      uid: 'abc',
      version: null,
      blockRange: null,
      blockRef: null,
      path: [],
      latest: true,
    })
  })
  test('unpacks hm://foo#bar - blockRef forces latest=false', () => {
    // When blockRef is present, latest should be false because
    // the block only exists in a specific version
    expect(unpackHmId('hm://foo#bar')).toEqual({
      id: 'hm://foo',
      scheme: 'hm',
      hostname: null,
      uid: 'foo',
      version: null,
      blockRange: {
        expanded: false,
      },
      blockRef: 'bar',
      path: [],
      latest: false,
    })
  })
  test('unpacks hm://foo?v=bar', () => {
    expect(unpackHmId('hm://foo?v=bar')).toEqual({
      id: 'hm://foo',
      scheme: 'hm',
      hostname: null,
      uid: 'foo',
      version: 'bar',
      blockRange: null,
      blockRef: null,
      path: [],
      latest: false,
    })
  })

  describe('web urls', () => {
    test('unpacks https://foobar.com/hm/a/b/c?v=2', () => {
      expect(unpackHmId('https://foobar.com/hm/a/b/c?v=2')).toEqual({
        scheme: 'https',
        hostname: 'foobar.com',
        uid: 'a',
        version: '2',
        blockRef: null,
        blockRange: null,
        id: 'hm://a/b/c',
        path: ['b', 'c'],
        latest: false,
      })
    })
    test('unpacks http://foobar.com/hm/1#block - blockRef forces latest=false', () => {
      expect(unpackHmId('http://foobar.com/hm/1#block')).toEqual({
        scheme: 'http',
        hostname: 'foobar.com',
        uid: '1',
        version: null,
        blockRange: {
          expanded: false,
        },
        latest: false,
        blockRef: 'block',
        id: 'hm://1',
        path: [],
      })
    })
    test('returns null for special static paths', () => {
      expect(unpackHmId('https://seed.hyper.media/hm/download')).toBeNull()
      expect(unpackHmId('https://seed.hyper.media/hm/download?l')).toBeNull()
      expect(unpackHmId('https://seed.hyper.media/hm/connect')).toBeNull()
      expect(unpackHmId('https://seed.hyper.media/hm/register')).toBeNull()
      expect(unpackHmId('https://seed.hyper.media/hm/device-link')).toBeNull()
      expect(unpackHmId('https://seed.hyper.media/hm/profile')).toBeNull()
    })
  })
})

describe('parseCustomURL', () => {
  test('parseCustomURL hm://a/b?foo=1&bar=2#block', () => {
    expect(parseCustomURL('hm://a/b?foo=1&bar=2#block')).toEqual({
      scheme: 'hm',
      path: ['a', 'b'],
      query: {foo: '1', bar: '2'},
      fragment: 'block',
    })
  })
})

describe('packHmId', () => {
  test('creates hm://abc', () => {
    expect(packHmId(hmId('abc'))).toEqual('hm://abc')
  })
  test('creates hm://123?v=foo', () => {
    expect(packHmId(hmId('123', {version: 'foo'}))).toEqual('hm://123?v=foo')
  })
  test('creates hm://123#block', () => {
    expect(packHmId(hmId('123', {blockRef: 'block'}))).toEqual('hm://123#block')
  })
  test('creates hm://123?v=foo#bar', () => {
    expect(packHmId(hmId('123', {version: 'foo', blockRef: 'bar'}))).toEqual(
      'hm://123?v=foo#bar',
    )
  })
})

describe('hmId', () => {
  test('creates hm://123/a/b?v=foo#bar', () => {
    expect(
      hmId('123', {version: 'foo', blockRef: 'bar', path: ['a', 'b']}),
    ).toEqual({
      id: 'hm://123/a/b',
      scheme: null,
      hostname: null,
      uid: '123',
      version: 'foo',
      blockRef: 'bar',
      blockRange: null,
      path: ['a', 'b'],
    })
  })
  test('creates hm://abc/def/a/b', () => {
    expect(hmId('abc/def/a/b')).toEqual({
      id: 'hm://abc/def/a/b',
      scheme: null,
      hostname: null,
      uid: 'abc',
      version: null,
      blockRef: null,
      blockRange: null,
      path: ['def', 'a', 'b'],
    })
  })
})

describe('unpackHmId - blockRef and version precedence', () => {
  test('blockRef with ?l param - blockRef takes precedence, latest=false', () => {
    // When blockRef is present, ?l should be ignored because
    // the block only exists in a specific version
    const result = unpackHmId('hm://uid?l#blockId')
    expect(result).toEqual({
      id: 'hm://uid',
      scheme: 'hm',
      hostname: null,
      uid: 'uid',
      version: null,
      blockRange: {
        expanded: false,
      },
      blockRef: 'blockId',
      path: [],
      latest: false, // blockRef forces latest=false
    })
  })

  test('blockRef with ?v param - version is preserved, latest=false', () => {
    const result = unpackHmId('hm://uid?v=abc123#blockId')
    expect(result).toEqual({
      id: 'hm://uid',
      scheme: 'hm',
      hostname: null,
      uid: 'uid',
      version: 'abc123',
      blockRange: {
        expanded: false,
      },
      blockRef: 'blockId',
      path: [],
      latest: false, // version is specified, so latest=false
    })
  })

  test('blockRef with both ?l and ?v params - version takes precedence', () => {
    // When both ?l and ?v are present with blockRef, version wins
    const result = unpackHmId('hm://uid?l&v=abc123#blockId')
    expect(result).toEqual({
      id: 'hm://uid',
      scheme: 'hm',
      hostname: null,
      uid: 'uid',
      version: 'abc123',
      blockRange: {
        expanded: false,
      },
      blockRef: 'blockId',
      path: [],
      latest: false, // blockRef forces latest=false regardless of ?l
    })
  })

  test('no blockRef with ?l param - latest=true', () => {
    const result = unpackHmId('hm://uid?l')
    expect(result).toEqual({
      id: 'hm://uid',
      scheme: 'hm',
      hostname: null,
      uid: 'uid',
      version: null,
      blockRange: null,
      blockRef: null,
      path: [],
      latest: true, // no blockRef, so ?l is respected
    })
  })

  test('expanded blockRef also forces latest=false', () => {
    // parseFragment expects 8-character block IDs
    const result = unpackHmId('hm://uid?l#XK6l8B4d+')
    expect(result).toEqual({
      id: 'hm://uid',
      scheme: 'hm',
      hostname: null,
      uid: 'uid',
      version: null,
      blockRange: {
        expanded: true,
      },
      blockRef: 'XK6l8B4d',
      path: [],
      latest: false,
    })
  })

  test('blockRef with range also forces latest=false', () => {
    // parseFragment expects 8-character block IDs
    const result = unpackHmId('hm://uid?l#XK6l8B4d[21:41]')
    expect(result).toEqual({
      id: 'hm://uid',
      scheme: 'hm',
      hostname: null,
      uid: 'uid',
      version: null,
      blockRange: {
        start: 21,
        end: 41,
      },
      blockRef: 'XK6l8B4d',
      path: [],
      latest: false,
    })
  })
})

describe('parseFragment', () => {
  test('parses simple block reference', () => {
    expect(parseFragment('XK6l8B4d')).toEqual({
      blockId: 'XK6l8B4d',
      expanded: false,
    })
  })

  test('parses expanded block reference', () => {
    expect(parseFragment('XK6l8B4d+')).toEqual({
      blockId: 'XK6l8B4d',
      expanded: true,
    })
  })

  test('parses block range reference', () => {
    expect(parseFragment('XK6l8B4d[21:41]')).toEqual({
      blockId: 'XK6l8B4d',
      start: 21,
      end: 41,
    })
  })

  test('handles null input', () => {
    expect(parseFragment(null)).toBeNull()
  })

  test('handles invalid input', () => {
    expect(parseFragment('invalid')).toEqual({
      blockId: 'invalid',
      expanded: false,
    })
  })

  test('parses variable-length blockId with expanded suffix', () => {
    // Block IDs can be longer than 8 chars
    expect(parseFragment('UyXozrafan+')).toEqual({
      blockId: 'UyXozrafan',
      expanded: true,
    })
  })

  test('parses variable-length blockId with range suffix', () => {
    expect(parseFragment('UyXozrafan[10:20]')).toEqual({
      blockId: 'UyXozrafan',
      start: 10,
      end: 20,
    })
  })

  test('parses variable-length blockId without suffix', () => {
    expect(parseFragment('UyXozrafan')).toEqual({
      blockId: 'UyXozrafan',
      expanded: false,
    })
  })
})

describe('serializeBlockRange', () => {
  test('null returns empty string', () => {
    expect(serializeBlockRange(null)).toBe('')
  })
  test('undefined returns empty string', () => {
    expect(serializeBlockRange(undefined)).toBe('')
  })
  test('expanded: true returns +', () => {
    expect(serializeBlockRange({expanded: true})).toBe('+')
  })
  test('expanded: false returns empty string', () => {
    expect(serializeBlockRange({expanded: false})).toBe('')
  })
  test('range returns [start:end]', () => {
    expect(serializeBlockRange({start: 10, end: 20})).toBe('[10:20]')
  })
})

describe('createWebHMUrl', () => {
  test('basic doc URL with hostname', () => {
    expect(createWebHMUrl('abc123', {hostname: 'https://gw.com'})).toBe(
      'https://gw.com/hm/abc123',
    )
  })

  test('doc URL with path', () => {
    expect(
      createWebHMUrl('abc', {
        hostname: 'https://gw.com',
        path: ['docs', 'intro'],
      }),
    ).toBe('https://gw.com/hm/abc/docs/intro')
  })

  test('doc URL with version', () => {
    expect(
      createWebHMUrl('abc', {hostname: 'https://gw.com', version: 'v1hash'}),
    ).toBe('https://gw.com/hm/abc?v=v1hash')
  })

  test('doc URL with latest', () => {
    expect(
      createWebHMUrl('abc', {hostname: 'https://gw.com', latest: true}),
    ).toBe('https://gw.com/hm/abc?l')
  })

  test('latest=true ignores version', () => {
    expect(
      createWebHMUrl('abc', {
        hostname: 'https://gw.com',
        latest: true,
        version: 'v1hash',
      }),
    ).toBe('https://gw.com/hm/abc?l')
  })

  test('doc URL with blockRef', () => {
    expect(
      createWebHMUrl('abc', {
        hostname: 'https://gw.com',
        blockRef: 'XK6l8B4d',
      }),
    ).toBe('https://gw.com/hm/abc#XK6l8B4d')
  })

  test('doc URL with expanded blockRef', () => {
    expect(
      createWebHMUrl('abc', {
        hostname: 'https://gw.com',
        blockRef: 'XK6l8B4d',
        blockRange: {expanded: true},
      }),
    ).toBe('https://gw.com/hm/abc#XK6l8B4d+')
  })

  test('doc URL with block range', () => {
    expect(
      createWebHMUrl('abc', {
        hostname: 'https://gw.com',
        blockRef: 'XK6l8B4d',
        blockRange: {start: 21, end: 41},
      }),
    ).toBe('https://gw.com/hm/abc#XK6l8B4d[21:41]')
  })

  test('doc URL with version + blockRef', () => {
    expect(
      createWebHMUrl('abc', {
        hostname: 'https://gw.com',
        version: 'v1hash',
        blockRef: 'blk1',
      }),
    ).toBe('https://gw.com/hm/abc?v=v1hash#blk1')
  })

  test('doc URL with panel param', () => {
    expect(
      createWebHMUrl('abc', {
        hostname: 'https://gw.com',
        panel: 'discussions',
      }),
    ).toBe('https://gw.com/hm/abc?panel=discussions')
  })

  test('doc URL with viewTerm', () => {
    expect(
      createWebHMUrl('abc', {
        hostname: 'https://gw.com',
        viewTerm: ':activity',
      }),
    ).toBe('https://gw.com/hm/abc/:activity')
  })

  test('doc URL with originHomeId omits /hm/uid prefix', () => {
    const originHome = hmId('abc')
    expect(
      createWebHMUrl('abc', {
        hostname: 'https://mysite.com',
        path: ['docs'],
        originHomeId: originHome,
      }),
    ).toBe('https://mysite.com/docs')
  })

  test('null hostname produces no host prefix', () => {
    expect(createWebHMUrl('abc', {hostname: null})).toBe('/hm/abc')
  })

  test('undefined hostname uses default gateway', () => {
    const url = createWebHMUrl('abc', {})
    expect(url).toContain('/hm/abc')
    // Should start with some https:// URL (DEFAULT_GATEWAY_URL)
    expect(url).toMatch(/^https?:\/\//)
  })

  test('all params combined', () => {
    expect(
      createWebHMUrl('uid1', {
        hostname: 'https://gw.com',
        path: ['a', 'b'],
        version: 'v1',
        blockRef: 'blk',
        blockRange: {expanded: true},
        panel: 'activity',
        viewTerm: ':discussions',
      }),
    ).toBe('https://gw.com/hm/uid1/a/b/:discussions?v=v1&panel=activity#blk+')
  })
})

describe('createSiteUrl', () => {
  test('basic site URL', () => {
    expect(createSiteUrl({hostname: 'https://mysite.com', path: null})).toBe(
      'https://mysite.com',
    )
  })

  test('site URL with path', () => {
    expect(
      createSiteUrl({hostname: 'https://mysite.com', path: ['docs', 'intro']}),
    ).toBe('https://mysite.com/docs/intro')
  })

  test('site URL with version', () => {
    expect(
      createSiteUrl({
        hostname: 'https://mysite.com',
        path: ['page'],
        version: 'v1hash',
      }),
    ).toBe('https://mysite.com/page?v=v1hash')
  })

  test('site URL with latest', () => {
    expect(
      createSiteUrl({
        hostname: 'https://mysite.com',
        path: ['page'],
        latest: true,
      }),
    ).toBe('https://mysite.com/page?l')
  })

  test('site URL with blockRef + expanded', () => {
    expect(
      createSiteUrl({
        hostname: 'https://mysite.com',
        path: ['page'],
        blockRef: 'blk1',
        blockRange: {expanded: true},
      }),
    ).toBe('https://mysite.com/page#blk1+')
  })

  test('site URL with blockRef + range', () => {
    expect(
      createSiteUrl({
        hostname: 'https://mysite.com',
        path: ['page'],
        blockRef: 'blk1',
        blockRange: {start: 5, end: 15},
      }),
    ).toBe('https://mysite.com/page#blk1[5:15]')
  })
})

describe('routeToUrl', () => {
  test('document route produces correct URL', () => {
    const url = routeToUrl(
      {
        key: 'document',
        id: hmId('uid1', {path: ['docs']}),
      },
      {hostname: 'https://gw.com'},
    )
    expect(url).toBe('https://gw.com/hm/uid1/docs')
  })

  test('document route with blockRef includes fragment', () => {
    const url = routeToUrl(
      {
        key: 'document',
        id: hmId('uid1', {
          version: 'v1',
          blockRef: 'blk1',
          blockRange: {expanded: true},
        }),
      },
      {hostname: 'https://gw.com'},
    )
    expect(url).toBe('https://gw.com/hm/uid1?v=v1#blk1+')
  })

  test('activity route includes :activity viewTerm', () => {
    const url = routeToUrl(
      {
        key: 'activity',
        id: hmId('uid1'),
      },
      {hostname: 'https://gw.com'},
    )
    expect(url).toBe('https://gw.com/hm/uid1/:activity')
  })

  test('discussions route includes :discussions viewTerm', () => {
    const url = routeToUrl(
      {
        key: 'discussions',
        id: hmId('uid1'),
      },
      {hostname: 'https://gw.com'},
    )
    expect(url).toBe('https://gw.com/hm/uid1/:discussions')
  })

  test('discussions route with openComment includes panel param', () => {
    const url = routeToUrl(
      {
        key: 'discussions',
        id: hmId('uid1'),
        openComment: 'comment123',
      },
      {hostname: 'https://gw.com'},
    )
    expect(url).toBe(
      'https://gw.com/hm/uid1/:discussions?panel=comment/comment123',
    )
  })

  test('feed route includes :feed viewTerm', () => {
    const url = routeToUrl(
      {
        key: 'feed',
        id: hmId('uid1'),
      },
      {hostname: 'https://gw.com'},
    )
    expect(url).toBe('https://gw.com/hm/uid1/:feed')
  })

  test('document route with originHomeId for site URL', () => {
    const originHome = hmId('uid1')
    const url = routeToUrl(
      {
        key: 'document',
        id: hmId('uid1', {path: ['page']}),
      },
      {hostname: 'https://mysite.com', originHomeId: originHome},
    )
    expect(url).toBe('https://mysite.com/page')
  })
})

describe('idToUrl', () => {
  test('converts UnpackedHypermediaId to web URL', () => {
    const id = hmId('abc', {
      path: ['docs'],
      version: 'v1',
      blockRef: 'blk',
    })
    id.hostname = 'https://gw.com'
    const url = idToUrl(id)
    expect(url).toBe('https://gw.com/hm/abc/docs?v=v1#blk')
  })
})

describe('createSiteUrl with viewTerm and panel', () => {
  test('site URL with viewTerm', () => {
    expect(
      createSiteUrl({
        hostname: 'https://mysite.com',
        path: ['doc'],
        viewTerm: ':discussions',
      }),
    ).toBe('https://mysite.com/doc/:discussions')
  })

  test('site URL with panel param', () => {
    expect(
      createSiteUrl({
        hostname: 'https://mysite.com',
        path: ['doc'],
        panel: 'comment/z6Mk/abc',
      }),
    ).toBe('https://mysite.com/doc?panel=comment/z6Mk/abc')
  })

  test('site URL with viewTerm + panel + latest', () => {
    expect(
      createSiteUrl({
        hostname: 'https://mysite.com',
        path: ['doc'],
        viewTerm: ':discussions',
        panel: 'comment/z6Mk/abc',
        latest: true,
      }),
    ).toBe('https://mysite.com/doc/:discussions?l&panel=comment/z6Mk/abc')
  })

  test('site URL with viewTerm + panel + blockRef', () => {
    expect(
      createSiteUrl({
        hostname: 'https://mysite.com',
        path: ['doc'],
        viewTerm: ':discussions',
        panel: 'comment/z6Mk/abc',
        blockRef: 'blk1',
        blockRange: {expanded: true},
      }),
    ).toBe('https://mysite.com/doc/:discussions?panel=comment/z6Mk/abc#blk1+')
  })
})

describe('createCommentUrl', () => {
  const docId = hmId('z6MkOwner', {path: ['human-interface-library']})

  test('discussions view with siteUrl', () => {
    expect(
      createCommentUrl({
        docId,
        commentId: 'z6MkAuthor/tsid123',
        siteUrl: 'https://seedteamtalks.hyper.media',
        isDiscussionsView: true,
      }),
    ).toBe(
      'https://seedteamtalks.hyper.media/human-interface-library/:discussions?panel=comment/z6MkAuthor/tsid123',
    )
  })

  test('discussions view with siteUrl + latest', () => {
    expect(
      createCommentUrl({
        docId,
        commentId: 'z6MkAuthor/tsid123',
        siteUrl: 'https://seedteamtalks.hyper.media',
        isDiscussionsView: true,
        latest: true,
      }),
    ).toBe(
      'https://seedteamtalks.hyper.media/human-interface-library/:discussions?l&panel=comment/z6MkAuthor/tsid123',
    )
  })

  test('discussions view with siteUrl + blockRef', () => {
    expect(
      createCommentUrl({
        docId,
        commentId: 'z6MkAuthor/tsid123',
        siteUrl: 'https://seedteamtalks.hyper.media',
        isDiscussionsView: true,
        blockRef: 'XK6l8B4d',
        blockRange: {expanded: true},
      }),
    ).toBe(
      'https://seedteamtalks.hyper.media/human-interface-library/:discussions?panel=comment/z6MkAuthor/tsid123#XK6l8B4d+',
    )
  })

  test('panel view with siteUrl (not discussions main view)', () => {
    expect(
      createCommentUrl({
        docId,
        commentId: 'z6MkAuthor/tsid123',
        siteUrl: 'https://seedteamtalks.hyper.media',
        isDiscussionsView: false,
      }),
    ).toBe(
      'https://seedteamtalks.hyper.media/human-interface-library?panel=comment/z6MkAuthor/tsid123',
    )
  })

  test('panel view with siteUrl + latest + blockRef', () => {
    expect(
      createCommentUrl({
        docId,
        commentId: 'z6MkAuthor/tsid123',
        siteUrl: 'https://seedteamtalks.hyper.media',
        isDiscussionsView: false,
        latest: true,
        blockRef: 'blk1',
        blockRange: {start: 10, end: 20},
      }),
    ).toBe(
      'https://seedteamtalks.hyper.media/human-interface-library?l&panel=comment/z6MkAuthor/tsid123#blk1[10:20]',
    )
  })

  test('discussions view without siteUrl (gateway)', () => {
    expect(
      createCommentUrl({
        docId,
        commentId: 'z6MkAuthor/tsid123',
        isDiscussionsView: true,
        latest: true,
      }),
    ).toContain(
      '/hm/z6MkOwner/human-interface-library/:discussions?l&panel=comment/z6MkAuthor/tsid123',
    )
  })

  test('panel view without siteUrl (gateway)', () => {
    expect(
      createCommentUrl({
        docId,
        commentId: 'z6MkAuthor/tsid123',
        isDiscussionsView: false,
      }),
    ).toContain(
      '/hm/z6MkOwner/human-interface-library?panel=comment/z6MkAuthor/tsid123',
    )
  })

  test('gateway view with blockRef', () => {
    expect(
      createCommentUrl({
        docId,
        commentId: 'z6MkAuthor/tsid123',
        isDiscussionsView: true,
        blockRef: 'blk1',
        blockRange: {expanded: true},
      }),
    ).toContain(
      '/hm/z6MkOwner/human-interface-library/:discussions?panel=comment/z6MkAuthor/tsid123#blk1+',
    )
  })

  // Root path (no doc path) — matches user's gabo.es example
  test('root doc discussions view with siteUrl + latest', () => {
    const rootDocId = hmId('z6MkOwner', {path: []})
    expect(
      createCommentUrl({
        docId: rootDocId,
        commentId: 'zDnae.../z6FK...',
        siteUrl: 'https://gabo.es',
        isDiscussionsView: true,
        latest: true,
      }),
    ).toBe('https://gabo.es/:discussions?l&panel=comment/zDnae.../z6FK...')
  })

  test('root doc panel view with siteUrl + latest', () => {
    const rootDocId = hmId('z6MkOwner', {path: []})
    expect(
      createCommentUrl({
        docId: rootDocId,
        commentId: 'zDnae.../z6FK...',
        siteUrl: 'https://gabo.es',
        isDiscussionsView: false,
        latest: true,
      }),
    ).toBe('https://gabo.es?l&panel=comment/zDnae.../z6FK...')
  })
})

describe('roundtrip: createWebHMUrl -> unpackHmId', () => {
  test('basic doc URL roundtrips', () => {
    const url = createWebHMUrl('abc123', {hostname: 'https://gw.com'})
    const unpacked = unpackHmId(url)
    expect(unpacked?.uid).toBe('abc123')
    expect(unpacked?.path).toEqual([])
    expect(unpacked?.hostname).toBe('gw.com')
  })

  test('doc URL with version roundtrips', () => {
    const url = createWebHMUrl('abc', {
      hostname: 'https://gw.com',
      version: 'v1hash',
    })
    const unpacked = unpackHmId(url)
    expect(unpacked?.uid).toBe('abc')
    expect(unpacked?.version).toBe('v1hash')
    expect(unpacked?.latest).toBe(false)
  })

  test('doc URL with blockRef roundtrips', () => {
    const url = createWebHMUrl('abc', {
      hostname: 'https://gw.com',
      version: 'v1',
      blockRef: 'XK6l8B4d',
      blockRange: {expanded: true},
    })
    const unpacked = unpackHmId(url)
    expect(unpacked?.uid).toBe('abc')
    expect(unpacked?.version).toBe('v1')
    expect(unpacked?.blockRef).toBe('XK6l8B4d')
    expect(unpacked?.blockRange).toEqual({expanded: true})
    expect(unpacked?.latest).toBe(false)
  })

  test('doc URL with path roundtrips', () => {
    const url = createWebHMUrl('abc', {
      hostname: 'https://gw.com',
      path: ['docs', 'intro'],
      version: 'v1',
    })
    const unpacked = unpackHmId(url)
    expect(unpacked?.uid).toBe('abc')
    expect(unpacked?.path).toEqual(['docs', 'intro'])
    expect(unpacked?.version).toBe('v1')
  })

  test('doc URL with block range roundtrips', () => {
    const url = createWebHMUrl('abc', {
      hostname: 'https://gw.com',
      version: 'v1',
      blockRef: 'XK6l8B4d',
      blockRange: {start: 21, end: 41},
    })
    const unpacked = unpackHmId(url)
    expect(unpacked?.blockRef).toBe('XK6l8B4d')
    expect(unpacked?.blockRange).toEqual({start: 21, end: 41})
  })
})
