import {resolveId, type DomainResolverFn} from '@seed-hypermedia/client'
import type {UniversalClient} from '../universal-client'
import {extractViewTermFromUrl} from './entity-id-url'

/**
 * `hm://<domain>/...` names a space by the site serving it, and the daemon only knows principals
 * ("failed to parse account 'hyper.media'"). Such a link is resolved through the domain resolver
 * (the desktop's domain store, else the daemon's GetDomain) before the app opens it; the path,
 * view term and query are kept as written. Null for any other URL, so callers can open those
 * synchronously.
 */
export function resolveDomainHmUrl(
  url: string,
  opts: {domainResolver?: DomainResolverFn; universalClient: Pick<UniversalClient, 'request'>},
): Promise<string> | null {
  const match = url.match(/^hm:\/\/([^/?#]+)/)
  if (!match || !match[1]!.includes('.')) return null
  const {url: cleanUrl} = extractViewTermFromUrl(url)
  const domainResolver: DomainResolverFn =
    opts.domainResolver ??
    (async (domain) => {
      const info = await opts.universalClient.request('GetDomain', {domain})
      return info.registeredAccountUid
        ? {registeredAccountUid: info.registeredAccountUid, isGateway: info.isGateway}
        : null
    })
  return resolveId(cleanUrl, {domainResolver}).then((id) => url.replace(match[0], `hm://${id.uid}`))
}
