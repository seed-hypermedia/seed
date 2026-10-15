import {requireSignInEnabled} from '@/require-sign-in.server'
import type {LoaderFunctionArgs} from '@remix-run/node'
import {WEB_IS_GATEWAY} from '@shm/shared/constants'
import {VIEW_TERMS} from '@shm/shared/utils/entity-id-url'

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
 *
 * View-term panels (`/:followers`, `/:comments`, `/:activity`, ...) are closed
 * everywhere: they are alternate views of documents and accounts whose URL
 * space grows with every pair of accounts, and crawlers walking them saturated
 * the gateway (2026-10-14). The `*` wildcard is honored by Google and Bing.
 */
export function buildRobotsTxt(isGateway: boolean, requireSignIn = false): string {
  // A members-only site has nothing a crawler could reach anyway; say so
  // rather than letting it collect sign-in redirects.
  if (requireSignIn) {
    return ['User-agent: *', 'Disallow: /', ''].join('\n')
  }
  const panels = VIEW_TERMS.map((term) => `Disallow: /*${term}`)
  if (isGateway) {
    return ['User-agent: *', ...panels, 'Allow: /', ''].join('\n')
  }
  return [
    'User-agent: *',
    'Allow: /hm/api/content-image',
    'Allow: /hm/api/image/',
    'Disallow: /hm/',
    ...panels,
    'Allow: /',
    '',
  ].join('\n')
}

export async function loader({}: LoaderFunctionArgs) {
  return new Response(buildRobotsTxt(WEB_IS_GATEWAY, requireSignInEnabled()), {
    headers: {
      'Content-Type': 'text/plain',
      'Cache-Control': 'public, max-age=3600',
    },
  })
}
