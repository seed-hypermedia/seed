/**
 * ExtensionFrame — owns the sandboxed <iframe> and the bridge server
 * (docs/extensions/design.md §4.1). Client-only: render it after mount.
 */

import {
  EXTENSION_PROTOCOL_VERSION,
  extensionEntryCid,
  type ExtensionContext,
  type ExtensionManifest,
  type ExtensionMount,
} from '@seed-hypermedia/client/extensions'
import type {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {useUniversalAppContext, useUniversalClient} from '@shm/shared/routing'
import {useCallback, useEffect, useMemo, useRef, useState, type CSSProperties} from 'react'
import {Button} from '../button'
import {Spinner} from '../spinner'
import {Text} from '../text'
import {cn} from '../utils'
import {createExtensionBridgeServer, type ExtensionHandlers} from './bridge-server'
import {useExtensionHost} from './extension-host-context'
import {createExtensionHandlers} from './host-handlers'
import {useSignConfirmDialog} from './sign-confirm-dialog'

/** Sandbox flags for extension iframes. `allow-same-origin` must never be added (design §6). */
export const EXTENSION_IFRAME_SANDBOX = 'allow-scripts allow-forms allow-popups allow-modals allow-downloads'

export type ExtensionFrameProps = {
  /** `hm://` id of the extension document without version (see `extensionIdString`). */
  extensionId: string
  /** Version of the extension document actually loaded. */
  extensionVersion: string | null
  /** Display name (the extension document's name). */
  extensionName: string
  manifest: ExtensionManifest
  mount: ExtensionMount & {subPath: string[]}
  siteUid: string
  siteName?: string
  /** The id being viewed (site uid + full path). */
  docId: UnpackedHypermediaId
  /** Query parameters of the current URL. */
  query?: Record<string, string>
  /** Developer override: load this URL instead of the published entry. */
  devUrl?: string | null
  onClearDevUrl?: () => void
  className?: string
  style?: CSSProperties
}

type LoadState =
  | {status: 'loading'}
  | {status: 'ready'; srcdoc?: string; src?: string}
  | {status: 'error'; message: string}

const EMPTY_QUERY: Record<string, string> = {}

function stableKey(value: unknown): string {
  try {
    return JSON.stringify(value) ?? ''
  } catch {
    return String(value)
  }
}

export function ExtensionFrame({
  extensionId,
  extensionVersion,
  extensionName,
  manifest,
  mount,
  siteUid,
  siteName,
  query,
  devUrl,
  onClearDevUrl,
  className,
  style,
}: ExtensionFrameProps) {
  const adapter = useExtensionHost()
  const client = useUniversalClient()
  const appContext = useUniversalAppContext()
  const {confirmSign, content: confirmDialog} = useSignConfirmDialog()

  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const [frameLoaded, setFrameLoaded] = useState(false)
  const [load, setLoad] = useState<LoadState>({status: 'loading'})
  const [reloadToken, setReloadToken] = useState(0)

  // ── Context ──
  // Hosts pass fresh `mount` / `query` / `user` objects on every render, so the
  // context is keyed on VALUES: a `context` event is emitted only when
  // something the extension can observe actually changed.
  const subPathKey = mount.subPath.join('/')
  const settings = mount.record.settings
  const settingsKey = stableKey(settings ?? {})
  const queryKey = stableKey(query ?? EMPTY_QUERY)
  const manifestKey = stableKey(manifest)
  const user = adapter.user
  const userKey = user ? `${user.accountId}|${user.name ?? ''}` : ''
  const latest = useRef({mount, query, manifest, user, settings})
  latest.current = {mount, query, manifest, user, settings}
  const context = useMemo<ExtensionContext>(
    () => ({
      protocol: EXTENSION_PROTOCOL_VERSION,
      platform: adapter.platform,
      extensionId,
      extensionVersion,
      manifest: latest.current.manifest,
      site: {uid: siteUid, name: siteName, origin: adapter.siteOrigin},
      mountPath: mount.mountPath,
      subPath: latest.current.mount.subPath,
      query: latest.current.query ?? EMPTY_QUERY,
      settings: latest.current.settings ?? {},
      user: latest.current.user,
      theme: adapter.theme,
      // Host policy for v1: every permission the manifest declares is granted.
      permissions: latest.current.manifest.permissions,
      dev: !!devUrl,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      adapter.platform,
      adapter.siteOrigin,
      adapter.theme,
      userKey,
      extensionId,
      extensionVersion,
      manifestKey,
      siteUid,
      siteName,
      mount.mountPath,
      subPathKey,
      queryKey,
      settingsKey,
      devUrl,
    ],
  )
  const contextRef = useRef(context)
  contextRef.current = context

  // ── Handlers (recreated when their inputs change; the server reads them through a ref) ──
  const onPushPublished = appContext.onPushPublished
  const handlers = useMemo<ExtensionHandlers>(
    () =>
      createExtensionHandlers({
        client,
        adapter,
        extension: {id: extensionId, name: extensionName, version: extensionVersion},
        site: {uid: siteUid, name: siteName},
        getUser: () => contextRef.current.user,
        confirmSign,
        onPushPublished,
        // ui.resize is only honoured in embedded contexts (future block use); pages fill the body.
        onResize: undefined,
      }),
    [client, adapter, extensionId, extensionName, extensionVersion, siteUid, siteName, confirmSign, onPushPublished],
  )
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers

  // ── Bridge server ──
  // Created inside the effect (not memoised) because `dispose()` is final:
  // React StrictMode mounts → unmounts → remounts effects in development, and
  // a memoised server disposed in the first cleanup would never answer `hello`.
  const serverRef = useRef<ReturnType<typeof createExtensionBridgeServer> | null>(null)
  useEffect(() => {
    const delegating = new Proxy({} as ExtensionHandlers, {
      get: (_target, method: string) => {
        const impl = handlersRef.current[method as keyof ExtensionHandlers] as unknown
        return impl
      },
      has: (_target, method: string) => method in handlersRef.current,
    })
    const server = createExtensionBridgeServer({
      post: (msg) => {
        const win = iframeRef.current?.contentWindow
        if (win) win.postMessage(msg, '*')
      },
      isTrustedSource: (source) => !!source && source === iframeRef.current?.contentWindow,
      getContext: () => contextRef.current,
      handlers: delegating,
    })
    serverRef.current = server
    const onMessage = (event: MessageEvent) => server.handleMessage(event)
    window.addEventListener('message', onMessage)
    return () => {
      window.removeEventListener('message', onMessage)
      server.dispose()
      if (serverRef.current === server) serverRef.current = null
    }
  }, [])

  // Push context changes (user, theme, route, query…) to a loaded extension.
  const isFirstContext = useRef(true)
  useEffect(() => {
    if (isFirstContext.current) {
      isFirstContext.current = false
      return
    }
    if (frameLoaded) serverRef.current?.emit('context', context)
  }, [context, frameLoaded])

  // ── Load entry ──
  const entryCid = extensionEntryCid(manifest)
  const fetchEntryHtml = adapter.fetchEntryHtml
  useEffect(() => {
    let cancelled = false
    setFrameLoaded(false)
    if (devUrl) {
      setLoad({status: 'ready', src: devUrl})
      return
    }
    setLoad({status: 'loading'})
    fetchEntryHtml(entryCid).then(
      (html) => {
        if (cancelled) return
        setLoad({status: 'ready', srcdoc: html})
      },
      (error: unknown) => {
        if (cancelled) return
        setLoad({status: 'error', message: error instanceof Error ? error.message : String(error)})
      },
    )
    return () => {
      cancelled = true
    }
  }, [devUrl, entryCid, fetchEntryHtml, reloadToken])

  const retry = useCallback(() => setReloadToken((t) => t + 1), [])

  return (
    <div
      className={cn('relative flex min-h-0 w-full flex-1 flex-col', className)}
      style={style}
      data-testid="extension-frame"
    >
      {devUrl ? (
        <button
          type="button"
          onClick={onClearDevUrl}
          className="flex shrink-0 items-center justify-between gap-3 bg-amber-100 px-3 py-1 text-left text-xs text-amber-900 hover:bg-amber-200 dark:bg-amber-900/40 dark:text-amber-100 dark:hover:bg-amber-900/60"
          data-testid="extension-dev-banner"
          title="Click to clear the dev override"
        >
          <span className="truncate">
            Dev override: <span className="font-mono">{devUrl}</span>
          </span>
          <span className="shrink-0 underline">clear</span>
        </button>
      ) : null}

      <div className="relative flex min-h-0 flex-1 flex-col">
        {load.status === 'error' ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
            <Text className="text-base font-medium">Could not load the extension</Text>
            <Text className="text-muted-foreground max-w-md text-sm break-words">{load.message}</Text>
            <Button variant="outline" size="sm" onClick={retry}>
              Retry
            </Button>
          </div>
        ) : null}

        {load.status === 'ready' ? (
          <iframe
            // Keyed on the code source only — never on route props — so
            // subPath/query changes update the context without reloading.
            key={devUrl ? `src:${devUrl}` : `cid:${entryCid}:${reloadToken}`}
            ref={iframeRef}
            title={extensionName}
            sandbox={EXTENSION_IFRAME_SANDBOX}
            allow=""
            referrerPolicy="no-referrer"
            src={load.src}
            srcDoc={load.srcdoc}
            onLoad={() => setFrameLoaded(true)}
            className="block h-full min-h-[60dvh] w-full flex-1 border-0 bg-transparent"
            data-testid="extension-iframe"
          />
        ) : null}

        {load.status === 'loading' || (load.status === 'ready' && !frameLoaded) ? (
          <div className="bg-background/60 pointer-events-none absolute inset-0 flex items-center justify-center">
            <Spinner size="large" />
          </div>
        ) : null}
      </div>

      {confirmDialog}
    </div>
  )
}
