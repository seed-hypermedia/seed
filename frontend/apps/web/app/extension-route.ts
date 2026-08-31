/**
 * Extension page routing helpers for the web app.
 *
 * Server side: `resolveExtensionRoute` decides whether a request path is
 * served by an extension installed on the site home document (see
 * docs/extensions/design.md §3.3 / §4.2).
 *
 * Client side: an extension does its own routing beneath its mount. The host
 * updates the browser URL with a normal Remix navigation but must keep the
 * iframe alive, so the document route's loader is skipped for URL changes that
 * stay inside the active mount (`isWithinExtensionMount`) and the current
 * `subPath` is derived from the location instead of the loader payload.
 */
import {
  EXTENSION_DEV_QUERY_PARAM,
  parseExtensionInstalls,
  resolveExtensionMount,
  type ExtensionMount,
} from '@seed-hypermedia/client/extensions'
import {isSiteProfileTab} from '@shm/shared'
import {extractViewTermFromPath} from './routes/view-terms'

export type ExtensionRouteMatch = ExtensionMount & {subPath: string[]}

/** Which site's home document a request path is served from, and the path within that site. */
export type ExtensionRequestTarget = {
  /** Account whose home document holds the install records. */
  siteUid: string
  /** Path segments relative to that site's root (view terms included). */
  pathParts: string[]
}

/**
 * Classify a request path (segments of `params['*']`) the way the document
 * loader does: `/hm/<uid>/...` addresses `<uid>`'s site (gateway form),
 * anything else addresses the registered site. Inspector (`/inspect/...`,
 * `/hm/inspect/...`) and utility (`/hm/profile/...`) paths are never
 * extension pages.
 */
export function extensionRequestTarget(
  pathParts: string[],
  registeredAccountUid: string,
): ExtensionRequestTarget | null {
  if (pathParts[0] === 'hm') {
    const uid = pathParts[1]
    if (!uid || uid === 'inspect' || isSiteProfileTab(uid)) return null
    return {siteUid: uid, pathParts: pathParts.slice(2)}
  }
  if (pathParts[0] === 'inspect') return null
  return {siteUid: registeredAccountUid, pathParts}
}

export type ExtensionRequestMatch = ExtensionRouteMatch & {siteUid: string}

/**
 * Resolve the extension page for a request, if any: classify the path, load
 * the target site's home metadata through `getHomeMetadata`, and match a
 * mount. Pure apart from the injected lookup so the loader branch is testable.
 */
export async function resolveExtensionRequest(
  pathParts: string[],
  registeredAccountUid: string,
  getHomeMetadata: (siteUid: string) => Promise<unknown>,
): Promise<ExtensionRequestMatch | null> {
  const target = extensionRequestTarget(pathParts, registeredAccountUid)
  if (!target || target.pathParts.length === 0) return null
  const homeMetadata = await getHomeMetadata(target.siteUid)
  const match = resolveExtensionRoute(homeMetadata, target.pathParts)
  return match ? {...match, siteUid: target.siteUid} : null
}

/**
 * Resolve the extension mounted at a site path. `pathParts` are the URL path
 * segments (relative to the site root, without `/hm/<uid>` or `/inspect`
 * prefixes). View terms (`:activity`, `:comments/...`) are stripped before
 * matching: a mount shadows every page of the document at or beneath it.
 */
export function resolveExtensionRoute(homeMetadata: unknown, pathParts: string[]): ExtensionRouteMatch | null {
  if (!homeMetadata) return null
  const {path} = extractViewTermFromPath(pathParts)
  return resolveExtensionMount(homeMetadata, path)
}

function splitPathname(pathname: string): string[] {
  return pathname
    .split('/')
    .filter(Boolean)
    .map((segment) => {
      try {
        return decodeURIComponent(segment)
      } catch {
        return segment
      }
    })
}

/**
 * The URL pathname prefix of a mount as displayed at `pathname`: `/board` on
 * the site's own origin, `/hm/<uid>/board` on a gateway path. Always starts
 * with `/` and has no trailing slash. Derived from the mount (not from the sub
 * path) so it stays correct while the extension routes beneath it.
 */
export function extensionMountPathPrefix(pathname: string, siteUid: string, mountSegments: string[]): string {
  const segments = splitPathname(pathname)
  const isGatewayPath = segments[0] === 'hm' && segments[1] === siteUid
  const base = isGatewayPath ? ['hm', siteUid] : []
  return '/' + [...base, ...mountSegments].map(encodeURIComponent).join('/')
}

/** True when `pathname` is the mount itself or beneath it. */
export function isWithinExtensionMount(pathname: string, mountPrefix: string): boolean {
  const target = splitPathname(pathname)
  const prefix = splitPathname(mountPrefix)
  if (prefix.length > target.length) return false
  return prefix.every((segment, i) => segment === target[i])
}

/** Segments of `pathname` after the mount prefix (empty when not within it). */
export function extensionSubPathFromPathname(pathname: string, mountPrefix: string): string[] {
  if (!isWithinExtensionMount(pathname, mountPrefix)) return []
  return splitPathname(pathname).slice(splitPathname(mountPrefix).length)
}

/**
 * Parse a `?query` string into the flat record extensions see. The host-only
 * `?extdev=` parameter is consumed by ExtensionPage (which strips it with
 * `history.replaceState`, invisible to the router location) and never shown
 * to the extension.
 */
export function extensionQueryFromSearch(search: string): Record<string, string> {
  const out: Record<string, string> = {}
  new URLSearchParams(search).forEach((value, key) => {
    if (key === EXTENSION_DEV_QUERY_PARAM) return
    out[key] = value
  })
  return out
}

/** Build the site href for a sub path + query beneath a mount. */
export function buildExtensionRouteHref(
  mountPrefix: string,
  subPath: string[],
  query: Record<string, string> | undefined,
): string {
  const base = mountPrefix.replace(/\/+$/, '') || ''
  const path = subPath.filter(Boolean).map(encodeURIComponent).join('/')
  const href = `${base}${path ? `/${path}` : ''}` || '/'
  const search = query ? new URLSearchParams(query).toString() : ''
  return search ? `${href}?${search}` : href
}

// ── Active mount registry (client only) ──────────────────────────────────────
//
// Remix's `shouldRevalidate` has no access to loader data, so the mounted
// extension page registers its mount here and `revalidation.ts` consults it to
// skip loader re-runs for navigations that stay inside the mount.

export type ActiveExtensionMount = {
  /** URL prefix of the displayed mount (see `extensionMountPathPrefix`). */
  prefix: string
  /**
   * URL prefixes of installs mounted strictly beneath `prefix`. Longest mount
   * wins (`resolveExtensionMount`), so a path under one of these belongs to a
   * different extension and must go through the loader.
   */
  childPrefixes: string[]
}

let activeExtensionMount: ActiveExtensionMount | null = null

export function setActiveExtensionMount(mount: ActiveExtensionMount | null) {
  activeExtensionMount = mount
}

export function getActiveExtensionMountPrefix(): string | null {
  return activeExtensionMount?.prefix ?? null
}

/**
 * URL prefixes of the installs nested beneath `mountSegments` in `homeMetadata`,
 * as displayed at `pathname` (site origin or gateway form).
 */
export function extensionChildMountPrefixes(
  homeMetadata: unknown,
  pathname: string,
  siteUid: string,
  mountSegments: string[],
): string[] {
  return parseExtensionInstalls(homeMetadata)
    .filter(
      (m) =>
        m.mountSegments.length > mountSegments.length && mountSegments.every((seg, i) => seg === m.mountSegments[i]),
    )
    .map((m) => extensionMountPathPrefix(pathname, siteUid, m.mountSegments))
}

/**
 * True when both URLs are within the currently displayed extension mount and
 * the next URL is not claimed by a longer nested mount.
 */
export function isExtensionInternalNavigation(currentPathname: string, nextPathname: string): boolean {
  const active = activeExtensionMount
  if (!active) return false
  if (!isWithinExtensionMount(currentPathname, active.prefix) || !isWithinExtensionMount(nextPathname, active.prefix)) {
    return false
  }
  return !active.childPrefixes.some((child) => isWithinExtensionMount(nextPathname, child))
}
