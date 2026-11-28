import type {AllDocumentsRoute, AllDocumentsSort, AllDocumentsType, AllDocumentsView} from '../routes'
import type {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'

/** Default sort direction for each sortable All documents column. `location` is the default sort. */
export const ALL_DOCUMENTS_DEFAULT_ORDER: Record<'title' | 'location' | 'type' | 'updated', 'asc' | 'desc'> = {
  title: 'asc',
  location: 'asc',
  type: 'asc',
  updated: 'desc',
}

/** The All documents view state, mirrored in the route URL. */
export type AllDocumentsViewState = {
  view: AllDocumentsView | 'list'
  tab: AllDocumentsType | 'all'
  sort: AllDocumentsSort | 'location'
  order: 'asc' | 'desc'
  q: string
}

/**
 * Parses All documents search params from a `URLSearchParams` or string-keyed record,
 * dropping invalid values. Used by both the URL→route parser and the web full-page loader.
 */
export function parseAllDocumentsSearchParams(params: URLSearchParams | Record<string, string>): {
  view?: AllDocumentsView
  type?: AllDocumentsType
  sort?: AllDocumentsSort
  order?: 'asc' | 'desc'
  q?: string
} {
  const get = (key: string) => (params instanceof URLSearchParams ? params.get(key) : params[key] ?? undefined)
  const view = get('view')
  const type = get('type')
  const sort = get('sort')
  const order = get('order')
  const q = get('q')
  return {
    view: view === 'tree' || view === 'list' ? view : undefined,
    type: type === 'documents' || type === 'collections' ? type : undefined,
    sort: sort === 'title' || sort === 'type' || sort === 'updated' ? sort : undefined,
    order: order === 'asc' || order === 'desc' ? order : undefined,
    q: q || undefined,
  }
}

/** Derives the All documents view state from an all-documents route, filling defaults. */
export function allDocumentsStateFromRoute(route: AllDocumentsRoute): AllDocumentsViewState {
  const sort = (route.sort ?? 'location') as AllDocumentsSort | 'location'
  return {
    view: route.view ?? 'list',
    tab: route.type ?? 'all',
    sort,
    order: route.order ?? ALL_DOCUMENTS_DEFAULT_ORDER[sort],
    q: route.q ?? '',
  }
}

/** Builds an all-documents route from the view state, omitting defaults so they stay out of the URL. */
export function allDocumentsRouteFromState(id: UnpackedHypermediaId, state: AllDocumentsViewState): AllDocumentsRoute {
  const defaultOrder = ALL_DOCUMENTS_DEFAULT_ORDER[state.sort]
  return {
    key: 'all-documents',
    id,
    view: state.view === 'tree' ? 'tree' : undefined,
    type: state.tab === 'documents' ? 'documents' : state.tab === 'collections' ? 'collections' : undefined,
    sort: state.sort === 'location' ? undefined : state.sort,
    order: state.order === defaultOrder ? undefined : state.order,
    q: state.q || undefined,
  }
}

/**
 * Serializes an all-documents route's view state as a query string, omitting defaults.
 * Returns '' when everything is default. Shared by all three URL producers (routeToHref,
 * routeToUrl, routeToHmUrl) so they stay in sync.
 */
export function allDocumentsQueryString(route: AllDocumentsRoute): string {
  const params = new URLSearchParams()
  if (route.view) params.set('view', route.view)
  if (route.type) params.set('type', route.type)
  if (route.sort) params.set('sort', route.sort)
  const defaultOrder = route.sort ? ALL_DOCUMENTS_DEFAULT_ORDER[route.sort] : 'asc'
  if (route.order && route.order !== defaultOrder) params.set('order', route.order)
  if (route.q) params.set('q', route.q)
  return params.toString()
}
