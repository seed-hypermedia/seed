import {describe, expect, it} from 'vitest'
import {buildRobotsTxt} from '../routes/robots[.]txt'

describe('buildRobotsTxt', () => {
  it('lets the gateway host be crawled, including /hm/ paths', () => {
    const body = buildRobotsTxt(true)
    expect(body).toContain('Allow: /')
    expect(body).not.toContain('Disallow: /hm/')
  })

  it('keeps crawlers out of /hm/ on a site host while allowing normal pages', () => {
    const body = buildRobotsTxt(false)
    expect(body).toContain('Allow: /')
    expect(body).toContain('Disallow: /hm/')
    expect(body).not.toMatch(/^Disallow: \/$/m)
  })

  it('keeps the image endpoints crawlable on a site host so link previews keep their images', () => {
    const body = buildRobotsTxt(false)
    expect(body).toContain('Allow: /hm/api/content-image')
    expect(body).toContain('Allow: /hm/api/image/')
  })

  it.each([true, false])('keeps crawlers out of view-term panels (isGateway=%s)', (isGateway) => {
    const body = buildRobotsTxt(isGateway)
    expect(body).toContain('Disallow: /*:profile')
    expect(body).toContain('Disallow: /*:followers')
    expect(body).toContain('Disallow: /*:membership')
    expect(body).toContain('Disallow: /*:comments')
    expect(body).toContain('Disallow: /*:activity')
  })

  it.each([true, false])('closes everything to crawlers on a members-only deployment (isGateway=%s)', (isGateway) => {
    expect(buildRobotsTxt(isGateway, true)).toBe('User-agent: *\nDisallow: /\n')
  })
})
