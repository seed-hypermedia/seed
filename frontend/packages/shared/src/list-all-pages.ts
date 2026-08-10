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
 */
export async function listAllPages<TResponse, TItem>(
  fetchPage: (pageToken: string) => Promise<TResponse>,
  getPage: (response: TResponse) => {items: TItem[]; nextPageToken: string},
): Promise<TItem[]> {
  const items: TItem[] = []
  let pageToken = ''
  while (true) {
    const response = await fetchPage(pageToken)
    const page = getPage(response)
    items.push(...page.items)
    if (!page.nextPageToken || items.length >= MAX_LIST_ITEMS) {
      return items.length > MAX_LIST_ITEMS ? items.slice(0, MAX_LIST_ITEMS) : items
    }
    pageToken = page.nextPageToken
  }
}
