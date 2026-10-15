import {describe, expect, it} from 'vitest'
import {
  HOSTED_NOTIFY_SERVICE_URL,
  isCanonicalNotifyServiceUrl,
  normalizeNotifyServiceUrl,
  notifyEndpointUrl,
  notifyServiceOrigin,
} from './notify-url'

describe('normalizeNotifyServiceUrl', () => {
  it('returns null for empty input', () => {
    expect(normalizeNotifyServiceUrl(undefined)).toBeNull()
    expect(normalizeNotifyServiceUrl(null)).toBeNull()
    expect(normalizeNotifyServiceUrl('  ')).toBeNull()
  })

  it('trims and strips trailing slashes', () => {
    expect(normalizeNotifyServiceUrl(' https://site.com/hm/api/notify/ ')).toBe('https://site.com/hm/api/notify')
    expect(normalizeNotifyServiceUrl('https://notify.example.com//')).toBe('https://notify.example.com')
  })

  it('rewrites retired hosted hosts regardless of path', () => {
    expect(normalizeNotifyServiceUrl('https://notify.seed.hyper.media')).toBe(HOSTED_NOTIFY_SERVICE_URL)
    expect(normalizeNotifyServiceUrl('https://notify.seed.hyper.media/hm/api/notifications')).toBe(
      'https://hyper.media/hm/api/notify',
    )
    expect(normalizeNotifyServiceUrl('https://notify-dev.seed.hyper.media/')).toBe(
      'https://dev.hyper.media/hm/api/notify',
    )
  })
})

describe('notifyEndpointUrl', () => {
  it('appends the leaf to canonical bases', () => {
    expect(notifyEndpointUrl('https://hyper.media/hm/api/notify', 'notifications')).toBe(
      'https://hyper.media/hm/api/notify/notifications',
    )
    expect(notifyEndpointUrl('https://site.com/hm/api/notify/', 'public-subscribe/abc')).toBe(
      'https://site.com/hm/api/notify/public-subscribe/abc',
    )
  })

  it('uses legacy /hm/api/<leaf> paths on origin-only bases', () => {
    expect(notifyEndpointUrl('https://notify.example.com', 'notification-config')).toBe(
      'https://notify.example.com/hm/api/notification-config',
    )
    expect(notifyEndpointUrl('http://localhost:3060', 'email-notif-token')).toBe(
      'http://localhost:3060/hm/api/email-notif-token',
    )
  })

  it('rewrites retired hosts first', () => {
    expect(notifyEndpointUrl('https://notify.seed.hyper.media', 'notifications')).toBe(
      'https://hyper.media/hm/api/notify/notifications',
    )
  })
})

describe('helpers', () => {
  it('detects canonical bases', () => {
    expect(isCanonicalNotifyServiceUrl('https://hyper.media/hm/api/notify')).toBe(true)
    expect(isCanonicalNotifyServiceUrl('https://hyper.media')).toBe(false)
    expect(isCanonicalNotifyServiceUrl('not a url')).toBe(false)
  })

  it('returns the origin', () => {
    expect(notifyServiceOrigin('https://hyper.media/hm/api/notify')).toBe('https://hyper.media')
  })
})
