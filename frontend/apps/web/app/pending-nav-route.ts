import type {NavRoute} from '@shm/shared'

/** A route opened in-app whose NavContext commit waits for Remix to land the navigation. */
export type PendingNavRoute = {
  route: NavRoute
  /** Committed location (pathname + search) the route belongs to. */
  location: string
  replace: boolean
}

function getRouteDocumentKey(route: NavRoute | null | undefined): string | null {
  if (!route || !('id' in route) || typeof route.id !== 'object' || !route.id) return null
  const {id} = route
  return `${route.key}|${id.id}|${id.version ?? ''}|${id.latest ? 1 : 0}`
}

/**
 * Whether NavContext should take `next` only once Remix commits its location.
 *
 * Moving to another document runs the loader, and Remix keeps the current page on screen until it
 * resolves. Committing the route first would label that page with the next document, so any of
 * its embeds of that document would read as embedding itself. Changes within the same document
 * (panels, block focus) commit right away so they stay instant.
 */
export function shouldDeferNavRoute(current: NavRoute | null | undefined, next: NavRoute): boolean {
  const nextKey = getRouteDocumentKey(next)
  return nextKey === null || nextKey !== getRouteDocumentKey(current)
}

/** Pathname + search of an href, the part of the location Remix commits after loading. */
export function getHrefLocation(href: string, origin: string): string {
  const url = new URL(href, origin)
  return `${url.pathname}${url.search}`
}

/** Returns the pending route when the committed location is the one it was opened for. */
export function takePendingNavRoute(
  pending: PendingNavRoute | null,
  committedLocation: string,
): PendingNavRoute | null {
  return pending && pending.location === committedLocation ? pending : null
}
