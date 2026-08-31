import {CID} from 'multiformats/cid'
import {DAEMON_HTTP_URL} from '@shm/shared/constants'

/**
 * Parse the CID out of a `/hm/api/file/<cid>[/...]` or `/hm/api/image/<cid>`
 * splat param. Returns the re-serialized multibase string (so the value can
 * only ever be a plain CID: no `\`, `..`, `?`, `#` or other URL syntax that
 * could reroute the proxied request to another daemon endpoint), or null when
 * the segment is missing or not a valid CID.
 */
export function parseCidParam(splat: string | undefined): string | null {
  const raw = splat?.split('/')[0]
  if (!raw) return null
  try {
    return CID.parse(raw).toString()
  } catch {
    return null
  }
}

/** Daemon URL for a validated CID (see `parseCidParam`). */
export function daemonIpfsUrl(cid: string): string {
  return new URL(`/ipfs/${encodeURIComponent(cid)}`, DAEMON_HTTP_URL).toString()
}
