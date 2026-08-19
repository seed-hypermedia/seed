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
