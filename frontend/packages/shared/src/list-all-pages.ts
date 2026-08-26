/**
 * Page size for paginated list RPCs fetched via {@link listAllPages}.
 *
 * Use this instead of BIG_INT page sizes: the daemon clamps huge page sizes
 * and would silently truncate the result, so callers that want the whole list
 * must actually paginate.
 */
export const LIST_PAGE_SIZE = 500

/**
 * Safety cap on the total number of items {@link listAllPages} accumulates,
 * so one pathological document can't make a client fetch forever.
 */
const MAX_LIST_ITEMS = 10_000

/**
 * Fetches every page of a paginated list RPC and returns the concatenated items.
 *
 * @param fetchPage - Fetches one page; must pass the given token as `pageToken`
 * and request `pageSize: LIST_PAGE_SIZE`.
 * @param getPage - Extracts the page's items and `nextPageToken` from the response.
 * @param opts.maxPages - Hard cap on round-trips. Callers hitting RPCs whose
 * server-side cost is high per call (notably ListCitations, which materializes
 * the target's whole citation fan-out before applying its LIMIT) must bound
 * this: unbounded enumeration of a hot document held the daemon's small read
 * pool and took production down on 2026-08-11 — see
 * docs/daemon-saturation-incident.md.
 */
export async function listAllPages<TResponse, TItem>(
  fetchPage: (pageToken: string) => Promise<TResponse>,
  getPage: (response: TResponse) => {items: TItem[]; nextPageToken: string},
  opts?: {maxPages?: number},
): Promise<TItem[]> {
  const maxPages = opts?.maxPages ?? Infinity
  const items: TItem[] = []
  let pageToken = ''
  let pagesFetched = 0
  while (true) {
    const response = await fetchPage(pageToken)
    const page = getPage(response)
    items.push(...page.items)
    pagesFetched++
    if (!page.nextPageToken || pagesFetched >= maxPages || items.length >= MAX_LIST_ITEMS) {
      return items.length > MAX_LIST_ITEMS ? items.slice(0, MAX_LIST_ITEMS) : items
    }
    pageToken = page.nextPageToken
  }
}
