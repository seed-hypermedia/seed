import {describe, expect, it} from 'vitest'
import {buildRobotsTxt} from '../routes/robots[.]txt'

describe('buildRobotsTxt', () => {
  it('leaves /hm/ crawlable on a gateway, which exists to serve any space', () => {
    const body = buildRobotsTxt(true)
    expect(body).toContain('Allow: /')
    expect(body).not.toContain('Disallow')
  })

  it('keeps crawlers out of /hm/ on a site, where it would publish other spaces', () => {
    expect(buildRobotsTxt(false)).toContain('Disallow: /hm/')
  })

  it('keeps the image endpoints crawlable on a site so link previews keep their images', () => {
    // og:image and twitter:image point at /hm/api/content-image, and the
    // favicon at /hm/api/image/<cid>. Both sit under the disallowed prefix, so
    // they need explicit allows.
    const body = buildRobotsTxt(false)
    expect(body).toContain('Allow: /hm/api/content-image')
    expect(body).toContain('Allow: /hm/api/image/')
  })
})
