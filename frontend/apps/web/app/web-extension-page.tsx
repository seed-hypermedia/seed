/**
 * Web host for extension pages (docs/extensions/design.md §4.2).
 *
 * `WebExtensionPage` renders the site providers and `ExtensionPage` from
 * `@shm/ui/extensions` inside an `ExtensionHostProvider` carrying the web
 * platform adapter. Hypermedia reads and writes are not part of the adapter:
 * they go through the universal client that `WebSiteProvider` already
 * supplies.
 */
import {
  buildExtensionRouteHref,
  extensionMountPathPrefix,
  extensionQueryFromSearch,
  extensionSubPathFromPathname,
  setActiveExtensionMountPrefix,
  type ExtensionRouteMatch,
} from '@/extension-route'
import type {SiteHeaderPayload} from '@/loaders'
import {useTheme, WebSiteProvider} from '@/providers'
import {useWebAccountUid} from '@/web-notifications'
import {WebHeaderActions, WebSitePageShell} from '@/web-utils'
import {useLocation, useNavigate} from '@remix-run/react'
import type {HMDocument, HMMetadata, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {createDocumentNavRoute, hmId, hypermediaUrlToRoute, useUniversalAppContext} from '@shm/shared'
import {useAccount, useResource} from '@shm/shared/models/entity'
import {ExtensionHostProvider, ExtensionPage, type ExtensionHostAdapter} from '@shm/ui/extensions'
import {toast} from '@shm/ui/toast'
import {useEffect, useMemo} from 'react'

/** Loader payload for a path served by an installed extension. */
export type ExtensionPagePayload = SiteHeaderPayload & {
  kind: 'extension'
  /**
   * Site uid + the full requested path (mount segments followed by the sub
   * path). `id.uid` is the account whose home document holds the install: the
   * registered site, or the visited account on a gateway path (`/hm/<uid>/...`).
   * `originHomeId` stays the deployment's registered site, as on document pages.
   */
  id: UnpackedHypermediaId
  /** Home document metadata of `id.uid` (drives the page title; the header reads the hydrated home document). */
  siteHomeMetadata: HMMetadata | null
  /** The resolved install record, mount path and sub path for the request. */
  mount: ExtensionRouteMatch
}

export function WebExtensionPage({payload}: {payload: ExtensionPagePayload}) {
  const {originHomeId, siteHost, origin, dehydratedState, id, mount} = payload
  if (!originHomeId) {
    return <h2>Invalid origin home id</h2>
  }
  return (
    <WebSiteProvider
      origin={origin}
      originHomeId={originHomeId}
      siteHost={siteHost}
      dehydratedState={dehydratedState}
      initialRoute={createDocumentNavRoute(id)}
    >
      <WebSitePageShell siteUid={id.uid}>
        <WebExtensionPageInner siteUid={id.uid} mount={mount} origin={origin} />
      </WebSitePageShell>
    </WebSiteProvider>
  )
}

function isHttpUrl(url: string) {
  return /^https?:\/\//i.test(url)
}

function WebExtensionPageInner({
  siteUid,
  mount,
  origin,
}: {
  siteUid: string
  mount: ExtensionRouteMatch
  origin: string
}) {
  const location = useLocation()
  const remixNavigate = useNavigate()
  const {openRoute} = useUniversalAppContext()
  const {theme} = useTheme()

  // The loader payload is frozen while the extension routes beneath its mount
  // (revalidation is skipped for in-mount navigations, see extension-route.ts),
  // so the live sub path and query come from the router location, not from
  // `mount.subPath`.
  const mountSegmentsKey = mount.mountSegments.join('/')
  const mountPrefix = useMemo(
    () => extensionMountPathPrefix(location.pathname, siteUid, mount.mountSegments),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [location.pathname, siteUid, mountSegmentsKey],
  )
  const subPath = useMemo(
    () => extensionSubPathFromPathname(location.pathname, mountPrefix),
    [location.pathname, mountPrefix],
  )
  const query = useMemo(() => extensionQueryFromSearch(location.search), [location.search])
  const subPathKey = subPath.join('/')
  const liveMount = useMemo<ExtensionRouteMatch>(
    () => ({...mount, subPath}),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mount, subPathKey],
  )
  const docId = useMemo(
    () => hmId(siteUid, {path: [...mount.mountSegments, ...subPath], latest: true}),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [siteUid, mountSegmentsKey, subPathKey],
  )

  useEffect(() => {
    setActiveExtensionMountPrefix(mountPrefix)
    return () => setActiveExtensionMountPrefix(null)
  }, [mountPrefix])

  // Home document of the visited site for the header (the registered site on
  // its own origin, the addressed account on gateway paths) — mirrors
  // ResourcePage's `hmId(docId.uid)`. Prefetched by the loader and hydrated
  // into the query cache by WebSiteProvider, so this is a cache read on first
  // render (server and client alike).
  const siteHomeId = useMemo(() => hmId(siteUid, {latest: true}), [siteUid])
  const homeResource = useResource(siteHomeId)
  const siteHomeDocument: HMDocument | undefined =
    homeResource.data?.type === 'document' ? homeResource.data.document : undefined

  const accountUid = useWebAccountUid()
  const account = useAccount(accountUid, {refetchOnWindowFocus: false})
  const accountName = account.data?.metadata?.name || undefined
  const user = useMemo(
    () => (accountUid ? {accountId: accountUid, name: accountName} : null),
    [accountUid, accountName],
  )

  const siteOrigin = typeof window !== 'undefined' ? window.location.origin : origin

  const adapter = useMemo<ExtensionHostAdapter>(() => {
    const fileUrl = (cid: string) => `${siteOrigin}/hm/api/file/${cid}`
    return {
      platform: 'web',
      user,
      theme,
      siteOrigin,
      fileUrl,
      fetchEntryHtml: async (cid) => {
        const res = await fetch(fileUrl(cid))
        if (!res.ok) throw new Error(`Failed to load extension entry ${cid}: HTTP ${res.status}`)
        return res.text()
      },
      readFile: async (cid, maxBytes) => {
        const res = await fetch(fileUrl(cid))
        if (!res.ok) throw new Error(`Failed to read file ${cid}: HTTP ${res.status}`)
        const declaredLength = Number(res.headers.get('content-length'))
        if (declaredLength && declaredLength > maxBytes) {
          throw new Error(`File ${cid} is larger than ${maxBytes} bytes`)
        }
        const buffer = await res.arrayBuffer()
        if (buffer.byteLength > maxBytes) {
          throw new Error(`File ${cid} is larger than ${maxBytes} bytes`)
        }
        return {bytes: new Uint8Array(buffer), contentType: res.headers.get('content-type') || undefined}
      },
      navigate: (url, {replace}) => {
        if (url.startsWith('hm://')) {
          const route = hypermediaUrlToRoute(url)
          if (route && openRoute) {
            openRoute(route, replace)
            return
          }
          toast.error(`Could not open ${url}`)
          return
        }
        if (isHttpUrl(url)) {
          window.open(url, '_blank', 'noopener')
          return
        }
        remixNavigate(url.startsWith('/') ? url : `/${url}`, {replace})
      },
      openExternal: (url) => {
        window.open(url, '_blank', 'noopener')
      },
      // A Remix navigation inside the mount: the URL and router location update,
      // the loader is not re-run (see revalidation.ts) and the page — iframe
      // included — stays mounted. The new sub path reaches the frame through
      // the `mount` prop derived from the location above.
      setRoute: (nextSubPath, nextQuery, {replace}) => {
        remixNavigate(buildExtensionRouteHref(mountPrefix, nextSubPath, nextQuery), {
          replace,
          preventScrollReset: true,
        })
      },
      toast: (message, kind) => {
        if (kind === 'error') toast.error(message)
        else if (kind === 'success') toast.success(message)
        else toast(message)
      },
    }
  }, [user, theme, siteOrigin, openRoute, remixNavigate, mountPrefix])

  return (
    <ExtensionHostProvider adapter={adapter}>
      <ExtensionPage
        docId={docId}
        siteHomeDocument={siteHomeDocument}
        mount={liveMount}
        query={query}
        rightActions={<WebHeaderActions siteUid={siteUid} />}
      />
    </ExtensionHostProvider>
  )
}
