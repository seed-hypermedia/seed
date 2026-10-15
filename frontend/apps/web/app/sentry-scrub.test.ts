import {describe, expect, it} from 'vitest'
import {scrubSentryPayload, scrubTokenFromUrl, sentryTokenScrubOptions} from './sentry-scrub.mjs'

describe('scrubTokenFromUrl', () => {
  it('redacts token query params and keeps the rest', () => {
    expect(scrubTokenFromUrl('https://site.com/hm/email-notifications?token=abc123')).toBe(
      'https://site.com/hm/email-notifications?token=[redacted]',
    )
    expect(scrubTokenFromUrl('/hm/api/notify/unsubscribe?a=1&token=xyz&b=2#frag')).toBe(
      '/hm/api/notify/unsubscribe?a=1&token=[redacted]&b=2#frag',
    )
    expect(scrubTokenFromUrl('token=abc&x=1')).toBe('token=[redacted]&x=1')
    expect(scrubTokenFromUrl('/doc?mytoken=keep')).toBe('/doc?mytoken=keep')
  })
})

describe('scrubSentryPayload', () => {
  it('scrubs request, transaction, spans and breadcrumbs of an event', () => {
    const event = {
      transaction: 'GET /hm/email-notifications?token=secret',
      request: {
        url: 'https://site.com/hm/email-notifications?token=secret',
        query_string: [['token', 'secret']],
      },
      spans: [{description: 'GET https://hyper.media/hm/api/notify/email-notif-token?token=secret'}],
      breadcrumbs: [{category: 'navigation', data: {from: '/', to: '/hm/email-notifications?token=secret'}}],
    }
    const scrubbed = sentryTokenScrubOptions.beforeSendTransaction(event)
    expect(JSON.stringify(scrubbed)).not.toContain('secret')
    expect(scrubbed.request.url).toBe('https://site.com/hm/email-notifications?token=[redacted]')
  })

  it('scrubs a parsed query object and a breadcrumb', () => {
    expect(scrubSentryPayload({query: {token: 'secret', a: '1'}})).toEqual({query: {token: '[redacted]', a: '1'}})
    const crumb = sentryTokenScrubOptions.beforeBreadcrumb({data: {url: '/x?token=secret'}})
    expect(crumb.data.url).toBe('/x?token=[redacted]')
  })
})
