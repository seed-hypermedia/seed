import {describe, expect, it} from 'vitest'
import {emailNotifTokenUrl} from './email-notifications-token-models'

describe('emailNotifTokenUrl', () => {
  it('uses the configured canonical notify base', () => {
    expect(emailNotifTokenUrl('abc', 'https://hyper.media/hm/api/notify', 'https://site.com')).toBe(
      'https://hyper.media/hm/api/notify/email-notif-token?token=abc',
    )
  })

  it('uses legacy paths on an origin-only notify base', () => {
    expect(emailNotifTokenUrl('abc', 'https://notify.example.com', 'https://site.com')).toBe(
      'https://notify.example.com/hm/api/email-notif-token?token=abc',
    )
  })

  it("falls back to the notify service on the site's own origin", () => {
    expect(emailNotifTokenUrl('a b', undefined, 'https://site.com')).toBe(
      'https://site.com/hm/api/notify/email-notif-token?token=a%20b',
    )
  })
})
