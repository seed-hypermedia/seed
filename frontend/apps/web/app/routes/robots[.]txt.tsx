import type {LoaderFunctionArgs} from '@remix-run/node'
import {WEB_IS_GATEWAY} from '@shm/shared/constants'

/**
 * Build the robots.txt body for a deployment.
 *
 * `/hm/*` serves any document by its hypermedia id, regardless of which space
 * owns it. That is the gateway's purpose, so a gateway leaves it crawlable. On
 * a site deployment the same paths publish other spaces' documents under this
 * site's domain, which competes with the owning space's own copy in search
 * results — so crawlers are kept out.
 *
 * The image endpoints stay crawlable either way: they serve the `og:image`,
 * `twitter:image` and favicon referenced from every page's metadata, and
 * crawlers that honor robots.txt (Google, and the social preview fetchers)
 * would otherwise drop those images from previews and image search.
 */
export function buildRobotsTxt(isGateway: boolean): string {
  if (isGateway) {
    return ['User-agent: *', 'Allow: /', ''].join('\n')
  }
  return [
    'User-agent: *',
    'Allow: /hm/api/content-image',
    'Allow: /hm/api/image/',
    'Disallow: /hm/',
    'Allow: /',
    '',
  ].join('\n')
}

export async function loader({}: LoaderFunctionArgs) {
  return new Response(buildRobotsTxt(WEB_IS_GATEWAY), {
    headers: {
      'Content-Type': 'text/plain',
      'Cache-Control': 'public, max-age=3600',
    },
  })
}
