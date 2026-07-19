/**
 * Build a deep-link into the Seed web app's blob/schema editor for a given CID.
 *
 * Pure function: returns the editor URL only when BOTH a non-empty web origin
 * and a cid are present, otherwise null. Any trailing slash on the origin is
 * trimmed so the resulting path is well-formed.
 */
export function seedEditUrl(webOrigin: string | undefined, cid: string | undefined): string | null {
  if (!webOrigin || !cid) return null
  const originWithoutTrailingSlash = webOrigin.replace(/\/+$/, '')
  if (!originWithoutTrailingSlash) return null
  return `${originWithoutTrailingSlash}/hm/blob/ipfs/${cid}`
}
