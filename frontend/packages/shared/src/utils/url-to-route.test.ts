import {describe, expect, test} from 'vitest'
import {unpackHmId} from './entity-id-url'
import {hypermediaUrlToRoute} from './url-to-route'

describe('hypermediaUrlToRoute', () => {
  test('converts a base document URL into a document route', () => {
    expect(hypermediaUrlToRoute('hm://uid1')).toEqual({
      key: 'document',
      id: unpackHmId('hm://uid1'),
    })
  })

  test('converts a profile URL into a site-profile route', () => {
    expect(hypermediaUrlToRoute('hm://uid1/:profile')).toEqual({
      key: 'site-profile',
      id: unpackHmId('hm://uid1'),
      accountUid: undefined,
      tab: 'profile',
    })
  })

  test('converts a comments view URL into a comments route', () => {
    expect(hypermediaUrlToRoute('hm://uid1/:comments')).toEqual({
      key: 'comments',
      id: unpackHmId('hm://uid1'),
      panel: null,
    })
  })

  test('converts a single-segment comment URL into an open comment route', () => {
    expect(hypermediaUrlToRoute('hm://uid1/:comments/comment123')).toEqual({
      key: 'comments',
      id: unpackHmId('hm://uid1'),
      openComment: 'comment123',
      panel: null,
    })
  })

  test('converts a slash-delimited comment URL into an open comment route', () => {
    expect(hypermediaUrlToRoute('hm://uid1/:comments/z6Mk/z6FC')).toEqual({
      key: 'comments',
      id: unpackHmId('hm://uid1'),
      openComment: 'z6Mk/z6FC',
      panel: null,
    })
  })

  test('converts a collaborators URL into a collaborators route', () => {
    expect(hypermediaUrlToRoute('hm://uid1/:collaborators')).toEqual({
      key: 'collaborators',
      id: unpackHmId('hm://uid1'),
      panel: null,
    })
  })

  test('converts an activity URL into an activity route', () => {
    expect(hypermediaUrlToRoute('hm://uid1/:activity')).toEqual({
      key: 'activity',
      id: unpackHmId('hm://uid1'),
      filterEventType: undefined,
      panel: null,
    })
  })

  test('converts an activity URL with a slug into a filtered activity route', () => {
    expect(hypermediaUrlToRoute('hm://uid1/:activity/citations')).toEqual({
      key: 'activity',
      id: unpackHmId('hm://uid1'),
      filterEventType: ['comment/Embed', 'doc/Embed', 'doc/Link', 'doc/Button'],
      panel: null,
    })
  })

  test('preserves block fragments on comments URLs', () => {
    expect(hypermediaUrlToRoute('hm://uid1/:comments/comment123#blk1+')).toEqual({
      key: 'comments',
      id: unpackHmId('hm://uid1#blk1+'),
      openComment: 'comment123',
      panel: null,
    })
  })

  test('preserves ranged block fragments on activity URLs', () => {
    expect(hypermediaUrlToRoute('hm://uid1/:activity#blk1[5:15]')).toEqual({
      key: 'activity',
      id: unpackHmId('hm://uid1#blk1[5:15]'),
      filterEventType: undefined,
      panel: null,
    })
  })

  test('keeps panel params when combined with view-term URLs', () => {
    expect(hypermediaUrlToRoute('hm://uid1/:activity/citations?panel=comments/abc123#blk1')).toEqual({
      key: 'activity',
      id: unpackHmId('hm://uid1#blk1'),
      filterEventType: ['comment/Embed', 'doc/Embed', 'doc/Link', 'doc/Button'],
      panel: {key: 'comments', id: unpackHmId('hm://uid1#blk1'), openComment: 'abc123'},
    })
  })

  test('converts an inspect URL into an inspect route', () => {
    expect(hypermediaUrlToRoute('hm://inspect/uid1')).toEqual({
      key: 'inspect',
      id: unpackHmId('hm://uid1'),
    })
  })

  test('converts an inspect comments URL into an inspect route with nested comments target', () => {
    expect(hypermediaUrlToRoute('hm://inspect/uid1/:comments/comment123')).toEqual({
      key: 'inspect',
      id: unpackHmId('hm://uid1'),
      targetView: 'comments',
      targetOpenComment: 'comment123',
    })
  })

  test('converts an inspect tab URL into an inspect route', () => {
    expect(hypermediaUrlToRoute('hm://inspect/uid1?tab=contacts')).toEqual({
      key: 'inspect',
      id: unpackHmId('hm://uid1'),
      inspectTab: 'contacts',
    })
  })

  test('converts extended inspector tabs from URL query params', () => {
    expect(hypermediaUrlToRoute('hm://inspect/uid1?tab=authored-comments')).toEqual({
      key: 'inspect',
      id: unpackHmId('hm://uid1'),
      inspectTab: 'authored-comments',
    })
  })

  test('converts an inspect ipfs URL into an inspect ipfs route', () => {
    expect(hypermediaUrlToRoute('hm://inspect/ipfs/bafy123/path/to/node')).toEqual({
      key: 'inspect-ipfs',
      ipfsPath: 'bafy123/path/to/node',
    })
  })
})
