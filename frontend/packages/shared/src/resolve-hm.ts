import {parseFragment} from './utils/entity-id-url'
import {unpackHmId} from './utils'

export async function resolveHypermediaUrl(url: string) {
  // Parse query params and fragment from original URL
  let latest = false
  let blockRef: string | null = null
  let blockRange: {start: number; end: number} | {expanded: boolean} | null =
    null
  try {
    const parsedUrl = new URL(url)
    const hasVersion = parsedUrl.searchParams.has('v')
    const hasLatest = parsedUrl.searchParams.has('l')
    // latest is true if ?l is present OR if no version is specified
    latest = hasLatest || !hasVersion

    // Extract blockRef and blockRange from fragment
    if (parsedUrl.hash) {
      const fragment = parseFragment(parsedUrl.hash.slice(1))
      if (fragment) {
        blockRef = fragment.blockId
        if ('start' in fragment && fragment.start !== undefined) {
          blockRange = {start: fragment.start, end: fragment.end!}
        } else if ('expanded' in fragment && fragment.expanded) {
          blockRange = {expanded: fragment.expanded}
        }
      }
    }
  } catch {
    // If URL parsing fails, continue with defaults
  }

  const response = await fetch(url, {
    method: 'OPTIONS',
  })
  if (response.status === 200) {
    const rawId = response.headers.get('x-hypermedia-id')
    const id = rawId ? decodeURIComponent(rawId) : null
    const version = response.headers.get('x-hypermedia-version')
    const encodedTitle = response.headers.get('x-hypermedia-title')
    const title = encodedTitle ? decodeURIComponent(encodedTitle) : null
    const rawTarget = response.headers.get('x-hypermedia-target')
    const target = rawTarget ? unpackHmId(decodeURIComponent(rawTarget)) : null
    const rawAuthors = response.headers.get('x-hypermedia-authors')
    const authors = rawAuthors
      ? decodeURIComponent(rawAuthors)
          .split(',')
          .map((author) => unpackHmId(author))
      : null
    const type = response.headers.get('x-hypermedia-type')
    if (id) {
      const hmId = unpackHmId(id)
      return {
        id,
        hmId: hmId ? {...hmId, latest, blockRef, blockRange} : null,
        version,
        title,
        target,
        authors,
        type,
      }
    }
    return null
  }
  return null
}
