import {afterEach, describe, expect, it, vi} from 'vitest'
import {buildRobotsTxt} from '../routes/robots[.]txt'

afterEach(() => vi.unstubAllEnvs())

describe.each(['true', 'false'])('buildRobotsTxt with SEED_IS_GATEWAY=%s', (isGateway) => {
  it('keeps crawlers out of /hm/ while allowing normal site pages', () => {
    vi.stubEnv('SEED_IS_GATEWAY', isGateway)
    const body = buildRobotsTxt()
    expect(body).toContain('Allow: /')
    expect(body).toContain('Disallow: /hm/')
    expect(body).not.toMatch(/^Disallow: \/$/m)
  })

  it('keeps crawlers out of view-term panels', () => {
    vi.stubEnv('SEED_IS_GATEWAY', isGateway)
    const body = buildRobotsTxt()
    expect(body).toContain('Disallow: /*:profile')
    expect(body).toContain('Disallow: /*:followers')
    expect(body).toContain('Disallow: /*:membership')
    expect(body).toContain('Disallow: /*:comments')
    expect(body).toContain('Disallow: /*:activity')
  })

  it('closes everything to crawlers on a members-only site', () => {
    vi.stubEnv('SEED_IS_GATEWAY', isGateway)
    expect(buildRobotsTxt(true)).toBe('User-agent: *\nDisallow: /\n')
  })

  it('keeps the image endpoints crawlable so link previews keep their images', () => {
    vi.stubEnv('SEED_IS_GATEWAY', isGateway)
    const body = buildRobotsTxt()
    expect(body).toContain('Allow: /hm/api/content-image')
    expect(body).toContain('Allow: /hm/api/image/')
  })
})
