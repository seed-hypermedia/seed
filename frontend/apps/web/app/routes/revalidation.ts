/** Decides whether the document route loader should re-run for a URL transition. */
export function shouldRevalidateDocumentRoute({
  currentUrl,
  nextUrl,
  defaultShouldRevalidate,
}: {
  currentUrl: URL
  nextUrl: URL
  defaultShouldRevalidate: boolean
}) {
  if (currentUrl.pathname !== nextUrl.pathname) {
    return true
  }

  // On comment permalinks (/:comments/UID/TSID), ?v pins the comment version.
  // The client renders old comment versions from the edit-history query, so a
  // version switch doesn't need fresh loader data.
  if (/\/:(comments?|discussions)\//.test(decodeURIComponent(currentUrl.pathname))) {
    return false
  }

  const currentV = currentUrl.searchParams.get('v')
  const nextV = nextUrl.searchParams.get('v')
  const currentL = currentUrl.searchParams.get('l')
  const nextL = nextUrl.searchParams.get('l')

  if (currentV === nextV && currentL === nextL) {
    return false
  }

  return true
}

/**
 * Decides whether the root loader should re-run. Its data comes from the request host and the
 * server environment, never from the path or query, so a client-side navigation cannot change it.
 *
 * Remix would otherwise refetch it on every search-param change, which includes each panel and
 * comment-reply navigation. A failed refetch replaces the whole app with the root error page, so
 * one rejected request (the proxy answers 429 when a page has too many requests in flight) turned
 * a query-only navigation into a crash.
 */
export function shouldRevalidateRootRoute({
  currentUrl,
  nextUrl,
  formMethod,
  defaultShouldRevalidate,
}: {
  currentUrl: URL
  nextUrl: URL
  formMethod?: string
  defaultShouldRevalidate: boolean
}) {
  // Submissions and explicit revalidations keep Remix's default.
  if (formMethod && formMethod.toUpperCase() !== 'GET') return defaultShouldRevalidate
  if (currentUrl.href === nextUrl.href) return defaultShouldRevalidate
  return currentUrl.origin !== nextUrl.origin
}
