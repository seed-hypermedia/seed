import {lookup} from 'node:dns/promises'
import {isIP} from 'node:net'
import {isPublicIPAddress, normalizeIPHostname} from './remote-file-security'

/** Checks literal hosts without DNS; malformed URLs and non-web schemes fail closed. */
export function isPrivateHost(url: string): boolean {
  try {
    const parsed = new URL(url)
    if (!['http:', 'https:'].includes(parsed.protocol)) return true
    const host = normalizeIPHostname(parsed.hostname).replace(/\.$/, '')
    if (/^(localhost|local|internal)$|\.(localhost|local|internal)$/.test(host)) return true
    if (!isIP(host)) return false
    // WHATWG URL canonicalizes integer, shortened, octal and hex IPv4 notation.
    const authority = url
      .match(/^https?:\/\/([^/?#]+)/i)?.[1]
      ?.split('@')
      .pop()
    const literal = authority?.replace(/:\d*$/, '').toLowerCase()
    if (isIP(host) === 4 && literal !== host) return true
    return !isPublicIPAddress(host)
  } catch {
    return true
  }
}

/** Rejects private destinations, including hostnames with any private DNS answer. */
export async function assertPublicWebUrl(url: string): Promise<void> {
  if (isPrivateHost(url)) throw new Error('Agent navigation requires a public HTTP(S) URL')
  const host = normalizeIPHostname(new URL(url).hostname).replace(/\.$/, '')
  if (isIP(host)) return
  const addresses = await lookup(host, {all: true})
  if (!addresses.length || addresses.some(({address}) => !isPublicIPAddress(address))) {
    throw new Error('Agent navigation to private networks is blocked')
  }
}
