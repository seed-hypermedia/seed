/**
 * Desktop host for an extension page (docs/extensions/design.md §4.3).
 *
 * Wraps the platform-agnostic `ExtensionPage` from `@shm/ui/extensions` in an
 * `ExtensionHostProvider` carrying the desktop adapter: the selected account as
 * the viewer, the daemon's HTTP file endpoint for entry/asset bytes, the app
 * navigation for hm:// links and the shell for external URLs.
 *
 * `DesktopResourcePage` renders this component keyed by `mount.mountPath`, so
 * navigating between sub paths beneath one mount (`/board` → `/board/card/1`)
 * re-renders the same element with new props instead of remounting it — the
 * iframe survives and only receives a `context` event.
 */

import {useAppContext} from '@/app-context'
import {JoinButton} from '@/components/join-button'
import {useSelectedAccount} from '@/selected-account'
import {useNavigate} from '@/utils/useNavigate'
import type {ExtensionMount} from '@seed-hypermedia/client/extensions'
import type {HMDocument, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {DAEMON_FILE_URL} from '@shm/shared/constants'
import {useStream} from '@shm/shared/use-stream'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {isHttpUrl} from '@shm/shared/utils/navigation'
import type {StateStream} from '@shm/shared/utils/stream'
import {hypermediaUrlToRoute} from '@shm/shared/utils/url-to-route'
import {ExtensionHostProvider, ExtensionPage, type ExtensionHostAdapter} from '@shm/ui/extensions'
import {toast} from '@shm/ui/toast'
import {useMemo} from 'react'

/** The preload exposes the app theme as a state stream (see src/preload.ts). */
function useDesktopTheme(): 'light' | 'dark' {
  const stream = (window as unknown as {darkMode?: StateStream<boolean>}).darkMode
  const dark = useStream(stream)
  if (typeof dark === 'boolean') return dark ? 'dark' : 'light'
  if (typeof document !== 'undefined' && document.documentElement.classList.contains('dark')) return 'dark'
  return 'light'
}

export function desktopFileUrl(cid: string): string {
  return `${DAEMON_FILE_URL}/${cid}`
}

export function DesktopExtensionPage({
  docId,
  siteHomeDocument,
  mount,
}: {
  docId: UnpackedHypermediaId
  siteHomeDocument: HMDocument | null | undefined
  mount: ExtensionMount & {subPath: string[]}
}) {
  const siteUid = docId.uid
  const selectedAccount = useSelectedAccount()
  const theme = useDesktopTheme()
  const {externalOpen} = useAppContext()
  const push = useNavigate('push')
  const replace = useNavigate('replace')

  const accountId = selectedAccount?.id?.uid
  const accountName = selectedAccount?.metadata?.name
  const mountPath = mount.mountPath

  const adapter = useMemo<ExtensionHostAdapter>(() => {
    const navigateTo = (url: string, replaceRoute: boolean | undefined) => {
      // Site-relative paths resolve against the site the extension is installed on.
      const absolute = url.startsWith('/') ? `hm://${siteUid}${url === '/' ? '' : url}` : url
      const route = hypermediaUrlToRoute(absolute)
      if (route) {
        ;(replaceRoute ? replace : push)(route)
        return
      }
      if (isHttpUrl(absolute)) {
        void externalOpen(absolute)
        return
      }
      toast.error(`Extension tried to open an unsupported URL: ${url}`)
    }
    return {
      platform: 'desktop',
      user: accountId ? {accountId, name: accountName || undefined} : null,
      theme,
      fetchEntryHtml: async (cid) => {
        const res = await fetch(desktopFileUrl(cid))
        if (!res.ok) throw new Error(`Failed to load extension entry (${res.status})`)
        return res.text()
      },
      fileUrl: desktopFileUrl,
      readFile: async (cid, maxBytes) => {
        const res = await fetch(desktopFileUrl(cid))
        if (!res.ok) throw new Error(`Failed to read file (${res.status})`)
        const declared = Number(res.headers.get('content-length') || 0)
        if (declared > maxBytes) throw new Error(`File is larger than ${maxBytes} bytes`)
        const buffer = await res.arrayBuffer()
        if (buffer.byteLength > maxBytes) throw new Error(`File is larger than ${maxBytes} bytes`)
        return {bytes: new Uint8Array(buffer), contentType: res.headers.get('content-type') || undefined}
      },
      navigate: (url, opts) => navigateTo(url, opts.replace),
      openExternal: (url) => {
        if (!isHttpUrl(url)) {
          toast.error('Only http(s) URLs can be opened externally')
          return
        }
        void externalOpen(url)
      },
      // The desktop document route has no query string; `query` is intentionally dropped.
      setRoute: (subPath, _query, opts) => {
        const route = {
          key: 'document' as const,
          id: hmId(siteUid, {path: [...mountPath.split('/'), ...subPath.filter((s) => s !== '')]}),
        }
        ;(opts.replace ? replace : push)(route)
      },
      toast: (message, kind) => {
        if (kind === 'error') toast.error(message)
        else if (kind === 'success') toast.success(message)
        else toast(message)
      },
      storage: typeof window !== 'undefined' ? window.localStorage : undefined,
    }
  }, [accountId, accountName, theme, siteUid, mountPath, externalOpen, push, replace])

  return (
    <ExtensionHostProvider adapter={adapter}>
      <ExtensionPage
        docId={docId}
        siteHomeDocument={siteHomeDocument}
        mount={mount}
        rightActions={<JoinButton siteUid={siteUid} />}
      />
    </ExtensionHostProvider>
  )
}
