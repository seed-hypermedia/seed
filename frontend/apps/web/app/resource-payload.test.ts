import {Code, ConnectError} from '@connectrpc/connect'
import type {HMDocument} from '@seed-hypermedia/client/hm-types'
import {HMNotFoundError} from '@shm/shared/models/entity'
import {serialize} from 'superjson'
import {describe, expect, it, vi} from 'vitest'
import {
  isBotUserAgent,
  isContentHiddenView,
  isExpectedResourceError,
  RESOURCE_DELETED_MESSAGE,
  toDocumentShell,
} from './resource-payload'
import {createResourceMetadata} from './hypermedia-metadata'
import {unwrap} from './wrapping'

// hypermedia-metadata reaches the editor bundle through providers; only the URL helper is needed.
vi.mock('./providers', () => ({getOptimizedImageUrl: (cid: string) => cid}))

const document = {
  account: 'z6Mk',
  path: '/notes/a',
  version: 'bafy-v1',
  authors: ['z6Mk'],
  genesis: 'bafy-g',
  visibility: 'PUBLIC',
  createTime: '2024-01-01T00:00:00Z',
  updateTime: '2024-01-02T00:00:00Z',
  metadata: {name: 'A note'},
  content: [{block: {id: 'b1', type: 'Paragraph', text: 'hello', annotations: [], attributes: {}}, children: []}],
  detachedBlocks: {navigation: {block: {id: 'nav', type: 'Group', text: '', annotations: [], attributes: {}}}},
} as unknown as HMDocument

describe('toDocumentShell', () => {
  it('drops the block content and keeps everything else', () => {
    const shell = toDocumentShell(document)
    expect(shell).not.toHaveProperty('content')
    expect(shell).not.toHaveProperty('detachedBlocks')
    const {content: _c, detachedBlocks: _d, ...rest} = document
    expect(shell).toEqual(rest)
  })

  it('yields the same page metadata as the full document', () => {
    const id = {id: 'hm://z6Mk/notes/a', uid: 'z6Mk', path: ['notes', 'a']} as any
    expect(createResourceMetadata({id, document: toDocumentShell(document)})).toEqual(
      createResourceMetadata({id, document}),
    )
  })
})

describe('isExpectedResourceError', () => {
  it('treats missing, deleted and private resources as expected', () => {
    expect(isExpectedResourceError(new HMNotFoundError())).toBe(true)
    expect(isExpectedResourceError(new Error(RESOURCE_DELETED_MESSAGE))).toBe(true)
    expect(isExpectedResourceError(new ConnectError('nope', Code.NotFound))).toBe(true)
    expect(isExpectedResourceError(new ConnectError('nope', Code.PermissionDenied))).toBe(true)
  })

  it('treats everything else as unexpected', () => {
    expect(isExpectedResourceError(new ConnectError('down', Code.Unavailable))).toBe(false)
    expect(isExpectedResourceError(new Error('boom'))).toBe(false)
    expect(isExpectedResourceError('string error')).toBe(false)
  })
})

describe('unwrap', () => {
  it('deserializes a wrapped payload once and returns the same result after', () => {
    const wrapped = serialize({n: 5n, d: new Date(0), u: undefined})
    const first = unwrap<any>(wrapped)
    expect(first).toEqual({n: 5n, d: new Date(0), u: undefined})
    expect(unwrap(wrapped)).toBe(first)
    // A different wrapped object is deserialized on its own.
    expect(unwrap(serialize({n: 5n, d: new Date(0), u: undefined}))).not.toBe(first)
  })
})

describe('isContentHiddenView', () => {
  it('is false for the plain document view', () => {
    expect(isContentHiddenView({viewTerm: null, isInspect: false})).toBe(false)
    expect(isContentHiddenView(undefined)).toBe(false)
  })

  it('is true for view-term panels and the inspector', () => {
    for (const viewTerm of ['activity', 'comments', 'collaborators', 'directory', 'feed', 'profile']) {
      expect(isContentHiddenView({viewTerm})).toBe(true)
    }
    expect(isContentHiddenView({viewTerm: null, isInspect: true})).toBe(true)
  })
})

describe('isBotUserAgent', () => {
  it('recognizes crawlers and not browsers', () => {
    expect(isBotUserAgent('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)')).toBe(true)
    expect(
      isBotUserAgent('meta-externalagent/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler)'),
    ).toBe(true)
    expect(
      isBotUserAgent(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36',
      ),
    ).toBe(false)
    expect(isBotUserAgent(null)).toBe(false)
  })
})
