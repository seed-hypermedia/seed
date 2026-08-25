import {hmId} from '@shm/shared'
import {describe, expect, it} from 'vitest'
import {createResourceRedirectUrl} from './resource-redirect'

const SPACE_UID = 'z6MkvSiteAccountUid'
const originHomeId = hmId(SPACE_UID)
const target = hmId(SPACE_UID, {path: ['notes', 'high-network-usage-in-activity-monitor']})

describe('createResourceRedirectUrl', () => {
  it('redirects a plain document URL to the new path', () => {
    expect(createResourceRedirectUrl(target, {}, originHomeId)).toBe('/notes/high-network-usage-in-activity-monitor')
  })

  it('preserves an open comment deep link (/:comments/UID/TSID)', () => {
    const openComment = 'z6MkwRWdU6HY11Qzi9SQZrwSx3rxFw94ipYyiN7Dtbrcg2yU/z6GeWHYXTLa49x'
    expect(createResourceRedirectUrl(target, {viewTerm: 'comments', openComment}, originHomeId)).toBe(
      `/notes/high-network-usage-in-activity-monitor/:comments/${openComment}`,
    )
  })

  it('preserves plain view terms', () => {
    expect(createResourceRedirectUrl(target, {viewTerm: 'directory'}, originHomeId)).toBe(
      '/notes/high-network-usage-in-activity-monitor/:directory',
    )
  })

  it('preserves an activity filter slug', () => {
    expect(
      createResourceRedirectUrl(target, {viewTerm: 'activity', panelParam: 'activity/versions'}, originHomeId),
    ).toBe('/notes/high-network-usage-in-activity-monitor/:activity/versions')
  })

  it('preserves a panel query param on a document route', () => {
    const url = createResourceRedirectUrl(target, {panelParam: 'comments'}, originHomeId)
    const parsed = new URL(url, 'http://example.com')
    expect(parsed.pathname).toBe('/notes/high-network-usage-in-activity-monitor')
    expect(parsed.searchParams.get('panel')).toBe('comments')
  })

  it('uses the /hm/UID prefix when the target is not the origin home account', () => {
    const otherTarget = hmId('z6MkvOtherAccountUid', {path: ['docs']})
    expect(createResourceRedirectUrl(otherTarget, {viewTerm: 'comments', openComment: 'a/b'}, originHomeId)).toBe(
      '/hm/z6MkvOtherAccountUid/docs/:comments/a/b',
    )
  })
})
