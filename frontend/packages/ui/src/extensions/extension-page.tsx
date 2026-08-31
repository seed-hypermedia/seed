/**
 * ExtensionPage — site header + a sandboxed extension iframe as the body
 * (docs/extensions/design.md §4.1). Resolves the extension document from the
 * install record (pinned version or latest), parses the manifest and renders
 * friendly states for everything that can go wrong. SSR-safe: the frame and
 * anything touching `window` render only after mount.
 */

import {
  EXTENSION_DEV_OVERRIDES_STORAGE_KEY,
  EXTENSION_DEV_QUERY_PARAM,
  EXTENSION_PROTOCOL_VERSION,
  parseExtensionManifest,
  readExtensionDevOverrides,
  writeExtensionDevOverride,
  type ExtensionManifest,
  type ExtensionMount,
} from '@seed-hypermedia/client/extensions'
import {unpackHmId, type HMDocument, type UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {useResource} from '@shm/shared/models/entity'
import {useRouteLink} from '@shm/shared/routing'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {useCallback, useEffect, useMemo, useState, type ReactNode} from 'react'
import {computeHeaderData, PageWrapper} from '../resource-page-common'
import {Spinner} from '../spinner'
import {Text} from '../text'
import {ExtensionFrame} from './extension-frame'
import {useExtensionHost} from './extension-host-context'
import {extensionIdString, loopbackDevUrl} from './host-utils'

export type ExtensionPageProps = {
  /** The id being viewed (site uid + full path, including the mount and any sub path). */
  docId: UnpackedHypermediaId
  /** Site home document (for the header). May be undefined while loading. */
  siteHomeDocument?: HMDocument | null
  /** Resolved mount for `docId`, from `resolveExtensionMount(siteHomeDocument.metadata, docId.path)`. */
  mount: ExtensionMount & {subPath: string[]}
  /** Header right-side actions (account button etc.), platform-specific. */
  rightActions?: ReactNode
  /**
   * Query parameters of the current URL, passed to the extension. Defaults to
   * `window.location.search` (read after mount, re-read on navigation).
   */
  query?: Record<string, string>
}

export function ExtensionPage({docId, siteHomeDocument, mount, rightActions, query}: ExtensionPageProps) {
  const siteHomeId = useMemo(() => hmId(docId.uid), [docId.uid])
  const homeDoc = siteHomeDocument ?? null
  const headerData = computeHeaderData(homeDoc)
  const siteName = typeof homeDoc?.metadata?.name === 'string' ? homeDoc.metadata.name : undefined

  return (
    <PageWrapper
      siteHomeId={siteHomeId}
      docId={docId}
      headerData={headerData}
      document={homeDoc ?? undefined}
      rightActions={rightActions}
    >
      <ExtensionPageBody docId={docId} mount={mount} siteName={siteName} query={query} />
    </PageWrapper>
  )
}

function ExtensionPageBody({
  docId,
  mount,
  siteName,
  query,
}: {
  docId: UnpackedHypermediaId
  mount: ExtensionMount & {subPath: string[]}
  siteName?: string
  query?: Record<string, string>
}) {
  const adapter = useExtensionHost()
  const {record} = mount
  const extId = useMemo(() => unpackHmId(record.ext), [record.ext])
  const extensionId = useMemo(() => extensionIdString(record), [record])
  const extDocId = useMemo(
    () =>
      extId ? hmId(extId.uid, {path: extId.path, version: record.version ?? null, latest: !record.version}) : null,
    [extId, record.version],
  )
  const extResource = useResource(extDocId, {subscribed: true})

  // Client-only concerns: dev overrides, ?extdev=, current query string.
  const extDocument = extResource.data?.type === 'document' ? extResource.data.document : null
  const manifest = useMemo(() => (extDocument ? parseExtensionManifest(extDocument.metadata) : null), [extDocument])

  const mounted = useMounted()
  const {devUrl, clearDevUrl} = useDevOverride(extensionId, mounted, adapter.storage)
  const locationQuery = useLocationQuery(mounted, docId.id)
  const effectiveQuery = query ?? locationQuery

  if (!extId || !extensionId) {
    return (
      <Notice title="Invalid extension reference" extensionId={record.ext}>
        The install record at <code>/{mount.mountPath}</code> does not point to a valid hypermedia document.
      </Notice>
    )
  }

  if (extResource.isInitialLoading || (!extResource.data && extResource.isLoading)) {
    return <Centered>{mounted ? <Spinner size="large" /> : null}</Centered>
  }

  const resource = extResource.data
  if (!resource || resource.type !== 'document') {
    const reason =
      resource?.type === 'tombstone'
        ? 'The extension document was deleted.'
        : resource?.type === 'redirect'
          ? 'The extension document was moved. Re-install the extension from its new location.'
          : resource?.type === 'error'
            ? resource.message
            : extResource.error
              ? String((extResource.error as Error).message ?? extResource.error)
              : record.version
                ? 'The pinned version of the extension is not available on this node yet.'
                : 'The extension document is not available on this node yet.'
    return (
      <Notice title="Extension unavailable" extensionId={extensionId} extDocId={extDocId}>
        {reason}
      </Notice>
    )
  }

  const document = resource.document
  if (!manifest) {
    return (
      <Notice title="Not an extension" extensionId={extensionId} extDocId={extDocId}>
        The document installed at <code>/{mount.mountPath}</code> has no valid <code>seedExtension</code> manifest.
      </Notice>
    )
  }
  if (manifest.kind !== 'page') {
    return (
      <Notice title="Unsupported extension kind" extensionId={extensionId} extDocId={extDocId}>
        This host can only mount <code>page</code> extensions; this one is a <code>{manifest.kind}</code> extension.
      </Notice>
    )
  }
  if (manifest.minProtocol && manifest.minProtocol > EXTENSION_PROTOCOL_VERSION) {
    return (
      <Notice title="Extension needs a newer app" extensionId={extensionId} extDocId={extDocId}>
        This extension requires bridge protocol {manifest.minProtocol}, but this app speaks protocol{' '}
        {EXTENSION_PROTOCOL_VERSION}. Update the app to use it.
      </Notice>
    )
  }

  if (!mounted) {
    // SSR / pre-hydration: the header is rendered, the frame mounts on the client.
    return <Centered />
  }

  return (
    <ExtensionFrame
      extensionId={extensionId}
      extensionVersion={document.version || record.version || null}
      extensionName={extensionDisplayName(document, manifest, mount)}
      manifest={manifest}
      mount={mount}
      siteUid={docId.uid}
      siteName={siteName}
      docId={docId}
      query={effectiveQuery}
      devUrl={devUrl}
      onClearDevUrl={clearDevUrl}
    />
  )
}

function extensionDisplayName(
  document: HMDocument,
  _manifest: ExtensionManifest,
  mount: ExtensionMount & {subPath: string[]},
): string {
  const name = document.metadata?.name
  if (typeof name === 'string' && name) return name
  return mount.record.title || mount.mountPath
}

// ── Client-only hooks ────────────────────────────────────────────────────────

function useMounted(): boolean {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  return mounted
}

/**
 * Developer override for this extension. Also consumes `?extdev=<url|off>`
 * from the current URL (web): writes the override and strips the param.
 *
 * Only loopback URLs are accepted from the URL param (see `loopbackDevUrl`):
 * anything else is ignored — nothing is written — but the param is still
 * stripped. Overrides written by the desktop settings editor may be any
 * http(s) URL; they are read back as-is and applied live via `storage` events.
 */
function useDevOverride(
  extensionId: string | null,
  mounted: boolean,
  storage: Parameters<typeof readExtensionDevOverrides>[0],
): {devUrl: string | null; clearDevUrl: () => void} {
  const [devUrl, setDevUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!mounted || !extensionId || typeof window === 'undefined') return
    const store = storage ?? safeLocalStorage()
    try {
      const url = new URL(window.location.href)
      const param = url.searchParams.get(EXTENSION_DEV_QUERY_PARAM)
      if (param !== null) {
        if (param === 'off' || param === '') {
          writeExtensionDevOverride(store as Storage | null, extensionId, null)
        } else {
          const value = loopbackDevUrl(param)
          // Non-loopback values are dropped without touching the stored override.
          if (value) writeExtensionDevOverride(store as Storage | null, extensionId, value)
        }
        url.searchParams.delete(EXTENSION_DEV_QUERY_PARAM)
        window.history.replaceState(window.history.state, '', url.toString())
      }
    } catch {
      // URL parsing / history unavailable — ignore
    }
    setDevUrl(readExtensionDevOverrides(store)[extensionId] ?? null)
  }, [mounted, extensionId, storage])

  // Overrides edited elsewhere (desktop Settings window, another tab) arrive
  // as `storage` events; re-read so the open page switches without a remount.
  useEffect(() => {
    if (!mounted || !extensionId || typeof window === 'undefined') return
    const store = storage ?? safeLocalStorage()
    const onStorage = (e: StorageEvent) => {
      if (e.key !== null && e.key !== EXTENSION_DEV_OVERRIDES_STORAGE_KEY) return
      setDevUrl(readExtensionDevOverrides(store)[extensionId] ?? null)
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [mounted, extensionId, storage])

  const clearDevUrl = useCallback(() => {
    if (!extensionId) return
    writeExtensionDevOverride((storage ?? safeLocalStorage()) as Storage | null, extensionId, null)
    setDevUrl(null)
  }, [extensionId, storage])

  return {devUrl, clearDevUrl}
}

function safeLocalStorage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null
  } catch {
    return null
  }
}

/** Query string of the current URL as a record; re-read when the route changes and on popstate. */
function useLocationQuery(mounted: boolean, routeKey: string): Record<string, string> {
  const [query, setQuery] = useState<Record<string, string>>({})
  useEffect(() => {
    if (!mounted || typeof window === 'undefined') return
    const read = () => {
      const next: Record<string, string> = {}
      try {
        new URLSearchParams(window.location.search).forEach((v, k) => {
          if (k !== EXTENSION_DEV_QUERY_PARAM) next[k] = v
        })
      } catch {
        // ignore
      }
      setQuery((prev) => (shallowEqual(prev, next) ? prev : next))
    }
    read()
    window.addEventListener('popstate', read)
    return () => window.removeEventListener('popstate', read)
  }, [mounted, routeKey])
  return query
}

function shallowEqual(a: Record<string, string>, b: Record<string, string>): boolean {
  const ak = Object.keys(a)
  const bk = Object.keys(b)
  if (ak.length !== bk.length) return false
  return ak.every((k) => a[k] === b[k])
}

// ── Presentational ───────────────────────────────────────────────────────────

function Centered({children}: {children?: ReactNode}) {
  return <div className="flex min-h-[40dvh] flex-1 items-center justify-center">{children}</div>
}

function Notice({
  title,
  extensionId,
  extDocId,
  children,
}: {
  title: string
  extensionId: string
  extDocId?: UnpackedHypermediaId | null
  children: ReactNode
}) {
  const link = useRouteLink(extDocId ? {key: 'document', id: extDocId} : null)
  return (
    <Centered>
      <div
        className="border-border bg-background m-4 flex max-w-lg flex-col gap-3 rounded-lg border p-6"
        data-testid="extension-page-notice"
      >
        <Text className="text-lg font-semibold">{title}</Text>
        <Text className="text-muted-foreground text-sm">{children}</Text>
        <Text className="text-muted-foreground font-mono text-xs break-all">
          {link.href ? (
            <a href={link.href} onClick={link.onClick} className="underline">
              {extensionId}
            </a>
          ) : (
            extensionId
          )}
        </Text>
      </div>
    </Centered>
  )
}
