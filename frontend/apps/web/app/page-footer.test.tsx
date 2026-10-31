/**
 * The footer's "Open App" link must land the desktop app on the same screen
 * the web page is showing. Building it from the bare document id dropped the
 * view term, open panel and reply target, so a comment permalink on the web
 * opened the plain document in the app.
 */
import type {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {hmId} from '@shm/shared'
import type {NavRoute} from '@shm/shared/routes'
import {hypermediaUrlToRoute} from '@shm/shared/utils/url-to-route'
import {createElement} from 'react'
import {renderToString} from 'react-dom/server'
import {describe, expect, it, vi} from 'vitest'

const state = vi.hoisted(() => ({navRoute: null as unknown}))

vi.mock('@shm/shared/utils/navigation', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {...actual, useNavRouteOrNull: () => state.navRoute}
})
vi.mock('./auth', () => ({AccountFooterActions: () => null}))
vi.mock('./client-lazy', () => ({ClientOnly: () => null}))

import {PageFooter} from './page-footer'

function openAppHref(route: NavRoute | null, id: UnpackedHypermediaId | null) {
  state.navRoute = route
  const html = renderToString(createElement(PageFooter, {id}))
  return html.match(/<a href="([^"]*)"[^>]*>[^<]*<svg/)?.[1]?.replace(/&amp;/g, '&') ?? null
}

describe('PageFooter Open App link', () => {
  const docId = hmId('uid1', {path: ['docs', 'intro']})

  it('carries the comments view, open comment and reply target', () => {
    const route = hypermediaUrlToRoute('hm://uid1/docs/intro/:comments/uid2/tsid1?v=cv1&reply=uid3/tsid2')!
    expect(openAppHref(route, docId)).toBe('hm://uid1/docs/intro/:comments/uid2/tsid1?v=cv1&reply=uid3/tsid2')
  })

  it('carries the open panel, pinned version and block fragment of a document', () => {
    const route = hypermediaUrlToRoute('hm://uid1/docs/intro?v=v1&panel=activity#blk1')!
    expect(openAppHref(route, docId)).toBe('hm://uid1/docs/intro?v=v1&panel=activity#blk1')
  })

  it('carries the directory view term', () => {
    const route = hypermediaUrlToRoute('hm://uid1/docs/intro/:directory')!
    expect(openAppHref(route, docId)).toBe('hm://uid1/docs/intro/:directory')
  })

  it('falls back to the document id when there is no route', () => {
    expect(openAppHref(null, hmId('uid1', {path: ['a'], version: 'v1'}))).toBe('hm://uid1/a?v=v1')
  })

  it('renders no link without a route or id', () => {
    expect(openAppHref(null, null)).toBeNull()
  })
})
