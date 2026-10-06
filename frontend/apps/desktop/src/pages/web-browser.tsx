import {useAppContext} from '@/app-context'
import {domainResolver} from '@/grpc-client'
import {useExperiments} from '@/models/experiments'
import {resolveOmnibarUrlToRoute} from '@/omnibar-url'
import {client} from '@/trpc'
import {commitBrowserLocation, resolveBrowserRoute} from '@/utils/navigation-container'
import {useListenAppEvent} from '@/utils/window-events'
import {useNavRoute, useNavigationDispatch} from '@shm/shared/utils/navigation'
import {hypermediaUrlToRoute} from '@shm/shared/utils/url-to-route'
import {Button} from '@shm/ui/button'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@shm/ui/components/alert-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@shm/ui/components/dropdown-menu'
import {ExternalLink, EyeOff, Globe, Lock, LockOpen, MoreHorizontal, RotateCw, X} from 'lucide-react'
import {useEffect, useRef, useState} from 'react'

let nextRequestId = 0

/**
 * The origin to show for a page: the host as Chromium sees it, so look-alike domains appear in
 * their raw punycode form, never the pretty version the page might prefer.
 */
export function displayedOrigin(url: string): {host: string; secure: boolean} | null {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
    return {host: parsed.host, secure: parsed.protocol === 'https:'}
  } catch {
    return null
  }
}

/** Whether an app overlay (dialog, menu, popover) is open; the native page view would otherwise cover it. */
function useOverlayPresence(enabled: boolean) {
  const [present, setPresent] = useState(false)
  useEffect(() => {
    if (!enabled || typeof MutationObserver !== 'function') return
    const selector =
      '[data-radix-popper-content-wrapper], [role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [role="menu"]'
    const check = () => setPresent(!!document.querySelector(selector))
    const observer = new MutationObserver(check)
    observer.observe(document.body, {childList: true, subtree: true, attributes: true, attributeFilter: ['data-state']})
    check()
    return () => observer.disconnect()
  }, [enabled])
  return present
}

/**
 * Shows a website in a main-process-owned view. This renderer never holds a web view: it asks the
 * main process for a guest, reports the rectangle to draw it in, and receives its events. The guest
 * stays alive across native routes so Chromium can restore page history and form state.
 */
export function WebBrowser() {
  const route = useNavRoute()
  const dispatch = useNavigationDispatch()
  const experiments = useExperiments()
  const enabled = experiments.data?.webBrowser === true
  const {externalOpen} = useAppContext()
  const container = useRef<HTMLDivElement>(null)
  const [privatePage, setPrivatePage] = useState(false)
  const [guest, setGuest] = useState<{browserId: number; privatePage: boolean}>()
  const browserId = guest?.privatePage === privatePage ? guest.browserId : undefined
  const normalRoute = useRef(route)
  const [loading, setLoading] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [clearMessage, setClearMessage] = useState<string>()
  const [dialogOrigin, setDialogOrigin] = useState<string>()
  const [error, setError] = useState<string | null>(null)
  const [favicons, setFavicons] = useState<{url: string; icons: string[]}>({url: '', icons: []})
  const pending = useRef<number>()
  const location = useRef<{url: string; historyIndex: number; title: string}>()
  const resolution = useRef(0)
  const currentRoute = useRef(route)
  currentRoute.current = route
  const active = route.key === 'web'
  const [mounted, setMounted] = useState(active)
  useEffect(() => {
    if (active) setMounted(true)
    else setPrivatePage(false)
  }, [active])

  useEffect(() => {
    if (!enabled || !mounted) {
      setGuest(undefined)
      setPrivatePage(false)
      return
    }
    let cancelled = false
    let createdId: number | undefined
    setError(null)
    setDialogOrigin(undefined)
    window.webBrowser
      .create({private: privatePage})
      .then((result) => {
        const id = (result as {browserId?: unknown} | undefined)?.browserId
        if (typeof id !== 'number') return
        createdId = id
        if (!cancelled) setGuest({browserId: id, privatePage})
        else if (privatePage) void window.webBrowser.destroy({browserId: id}).catch(() => {})
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason))
      })
    return () => {
      cancelled = true
      if (privatePage && createdId !== undefined) void window.webBrowser.destroy({browserId: createdId}).catch(() => {})
      resolution.current++
      location.current = undefined
    }
  }, [enabled, mounted, privatePage])

  const obscured = useOverlayPresence(active && browserId !== undefined)
  // The main process draws the page where this element is, and only while it should be seen.
  useEffect(() => {
    if (browserId === undefined) return
    const element = container.current
    const shown = active && enabled && !error && !obscured
    const report = () => {
      const rect = element?.getBoundingClientRect()
      window.webBrowser.setBounds({
        browserId,
        visible: shown && !!rect && rect.width > 0 && rect.height > 0,
        ...(rect ? {bounds: {x: rect.left, y: rect.top, width: rect.width, height: rect.height}} : {}),
      })
    }
    report()
    const observer = typeof ResizeObserver === 'function' && element ? new ResizeObserver(report) : undefined
    if (element) observer?.observe(element)
    window.addEventListener('resize', report)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', report)
      window.webBrowser.setBounds({browserId, visible: false})
    }
  }, [browserId, active, enabled, error, obscured])

  useEffect(() => {
    if (route.key !== 'web' || !browserId || !enabled) {
      resolution.current++
      pending.current = undefined
      location.current = undefined
      if (browserId) window.webBrowser.control({browserId, action: 'stop'})
      return
    }
    if (
      location.current?.url === route.url &&
      route.browserId === browserId &&
      location.current.historyIndex === route.historyIndex
    )
      return
    resolution.current++
    pending.current = ++nextRequestId
    setError(null)
    window.webBrowser.navigate({
      browserId,
      requestId: pending.current,
      url: route.url,
      historyIndex: route.browserId === browserId ? route.historyIndex : undefined,
    })
  }, [
    active,
    route.key === 'web' ? route.url : null,
    route.key === 'web' ? route.historyIndex : null,
    browserId,
    enabled,
  ])

  useListenAppEvent('browser-location', (event) => {
    if (event.browserId !== browserId || currentRoute.current.key !== 'web') return
    if (event.requestId !== undefined && event.requestId !== pending.current) return
    if (pending.current !== undefined && event.requestId === undefined) return
    pending.current = undefined
    location.current = event
    commitBrowserLocation(event, event.requestId !== undefined)
    const generation = ++resolution.current
    if (!event.userInitiated) return
    void resolveOmnibarUrlToRoute(event.url, {domainResolver}).then((nativeRoute) => {
      if (nativeRoute && generation === resolution.current) resolveBrowserRoute(event.url, nativeRoute)
    })
  })
  useListenAppEvent('browser-loading', (event) => {
    if (event.browserId !== browserId) return
    setLoading(event.loading)
    if (event.loading) {
      setError(null)
      setDialogOrigin(undefined)
    }
  })
  useListenAppEvent('browser-dialog', (event) => {
    if (event.browserId === browserId) setDialogOrigin(event.origin)
  })
  useListenAppEvent('browser-load-error', (event) => {
    if (event.browserId !== browserId) return
    setLoading(false)
    setError(event.description)
  })
  useListenAppEvent('browser-title', (event) => {
    if (event.browserId !== browserId || !location.current || pending.current !== undefined) return
    const current = currentRoute.current
    if (current.key !== 'web' || current.browserId !== browserId || current.url !== location.current.url) return
    location.current = {...location.current, title: event.title}
    commitBrowserLocation({...location.current, browserId}, true)
  })
  useListenAppEvent('browser-favicons', (event) => {
    if (event.browserId !== browserId) return
    setFavicons({url: event.url, icons: event.icons})
  })
  useListenAppEvent('browser-open-url', (event) => {
    if (event.browserId !== browserId || currentRoute.current.key !== 'web' || !enabled) return
    resolution.current++
    const nativeRoute = hypermediaUrlToRoute(event.url)
    if (nativeRoute) dispatch({type: 'push', route: nativeRoute})
    else if (/^https?:\/\//.test(event.url)) dispatch({type: 'push', route: {key: 'web', url: event.url}})
  })

  return (
    <div className={active ? 'flex h-full min-h-0 flex-col overflow-hidden rounded-lg border' : 'hidden'}>
      {active && (
        <div className="bg-muted/30 flex shrink-0 items-center gap-2 border-b px-3 py-1">
          {favicons.url === route.url && favicons.icons[0] ? (
            <img
              key={favicons.icons[0]}
              src={favicons.icons[0]}
              alt=""
              aria-hidden="true"
              className="size-4 shrink-0 object-contain"
              onError={() => setFavicons((value) => ({...value, icons: value.icons.slice(1)}))}
            />
          ) : (
            <Globe aria-hidden="true" className="text-muted-foreground size-4 shrink-0" />
          )}
          {(() => {
            const origin = displayedOrigin(route.url)
            return origin ? (
              <span
                className="flex min-w-0 shrink-0 items-center gap-1 font-mono text-xs"
                data-testid="browser-origin"
                title={origin.secure ? 'Secure connection' : 'Not secure'}
              >
                {origin.secure ? (
                  <Lock aria-label="Secure connection" className="size-3 shrink-0" />
                ) : (
                  <LockOpen aria-label="Not secure" className="text-destructive size-3 shrink-0" />
                )}
                <span className="max-w-[40%] truncate">{origin.host}</span>
              </span>
            ) : null
          })()}
          <span className="text-muted-foreground min-w-0 flex-1 truncate text-xs" role="status">
            {dialogOrigin ? `${dialogOrigin} is showing dialogs` : loading ? 'Loading…' : route.title || route.url}
          </span>
          {privatePage && <span className="bg-muted rounded px-2 py-1 text-xs">Private</span>}
          <Button
            size="icon"
            variant="ghost"
            aria-label={privatePage ? 'Close private page' : 'New private page'}
            disabled={!enabled || (!privatePage && !browserId)}
            onClick={() => {
              if (privatePage) {
                setPrivatePage(false)
                dispatch({type: 'replace', route: normalRoute.current})
              } else {
                normalRoute.current = route
                setPrivatePage(true)
              }
            }}
          >
            {privatePage ? <X className="size-4" /> : <EyeOff className="size-4" />}
          </Button>
          <Button
            size="icon"
            variant="ghost"
            aria-label={loading ? 'Stop loading' : 'Reload page'}
            disabled={!enabled || !browserId}
            onClick={() =>
              browserId !== undefined && window.webBrowser.control({browserId, action: loading ? 'stop' : 'reload'})
            }
          >
            {loading ? <X className="size-4" /> : <RotateCw className="size-4" />}
          </Button>
          <Button
            size="icon"
            variant="ghost"
            aria-label="Open in default browser"
            onClick={() => externalOpen(route.url)}
          >
            <ExternalLink className="size-4" />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="ghost" aria-label="Page menu">
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onSelect={() => {
                  setClearMessage(undefined)
                  setConfirmClear(true)
                }}
              >
                Clear browsing data
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
      {active && !enabled && !experiments.isLoading && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6">
          <p>The experimental web browser is disabled.</p>
          <Button variant="outline" onClick={() => externalOpen(route.url)}>
            Open in default browser
          </Button>
        </div>
      )}
      {error && active && enabled && (
        <div role="alert" className="bg-background flex flex-col items-center gap-3 p-6">
          <p>Unable to load this page</p>
          <p className="text-muted-foreground text-sm">{error}</p>
          <Button
            variant="outline"
            onClick={() => browserId !== undefined && window.webBrowser.control({browserId, action: 'reload'})}
          >
            Try again
          </Button>
        </div>
      )}
      <div ref={container} className="min-h-0 flex-1" />
      <AlertDialog open={confirmClear} onOpenChange={setConfirmClear}>
        <AlertDialogContent>
          <AlertDialogTitle>Clear browsing data?</AlertDialogTitle>
          <AlertDialogDescription>
            This clears cookies, saved website data and the cache for normal pages. You will be signed out of websites.
          </AlertDialogDescription>
          {clearMessage && (
            <p role="alert" className="text-sm">
              {clearMessage}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <AlertDialogCancel disabled={clearing}>Cancel</AlertDialogCancel>
            <Button
              disabled={clearing}
              onClick={async () => {
                setClearing(true)
                try {
                  await client.experiments.clearBrowserData.mutate()
                  setConfirmClear(false)
                } catch {
                  setClearMessage('Unable to clear browser data')
                } finally {
                  setClearing(false)
                }
              }}
            >
              {clearing ? 'Clearing…' : 'Clear browsing data'}
            </Button>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
