import {beforeEach, describe, expect, it, vi} from 'vitest'

const mocks = vi.hoisted(() => ({
  isGateway: false,
  serviceConfig: null as null | {rootHostname: string},
}))

// Reading the site-config module throws without a config file on disk, which
// CI never has, so stub the one call the loader makes.
vi.mock('@/site-config.server', () => ({getServiceConfig: async () => mocks.serviceConfig}))
vi.mock('@shm/shared/constants', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    get WEB_IS_GATEWAY() {
      return mocks.isGateway
    },
  }
})

import {buildRobotsTxt, loader} from '../routes/robots[.]txt'

async function robotsFor(hostname: string) {
  const response = (await loader({
    request: new Request(`https://${hostname}/robots.txt`),
    params: {},
    context: {},
  } as any)) as Response
  return response.text()
}

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

describe('robots.txt loader on a gateway process serving several hosts', () => {
  beforeEach(() => {
    mocks.isGateway = true
    mocks.serviceConfig = {rootHostname: 'hyper.media'}
  })

  it('treats only the root hostname as the gateway', async () => {
    expect(await robotsFor('hyper.media')).not.toContain('Disallow: /hm/')
  })

  it('treats a custom domain as a site', async () => {
    expect(await robotsFor('delibera.example.org')).toContain('Disallow: /hm/')
  })

  it('treats a named-service subdomain as a site', async () => {
    expect(await robotsFor('team.hyper.media')).toContain('Disallow: /hm/')
  })

  it('is the gateway for every request when there is no service config', async () => {
    mocks.serviceConfig = null
    expect(await robotsFor('gateway.example')).not.toContain('Disallow: /hm/')
  })

  it('is a site everywhere when the process is not a gateway', async () => {
    mocks.isGateway = false
    expect(await robotsFor('hyper.media')).toContain('Disallow: /hm/')
  })
})
