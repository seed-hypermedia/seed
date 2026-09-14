import {useAppContext} from '@/app-context'
import {domainResolver} from '@/grpc-client'
import {ipc} from '@/ipc'
import {useExperiments} from '@/models/experiments'
import {resolveOmnibarUrlToRoute} from '@/omnibar-url'
import {commitBrowserLocation, resolveBrowserRoute} from '@/utils/navigation-container'
import {useListenAppEvent} from '@/utils/window-events'
import {useNavRoute, useNavigationDispatch} from '@shm/shared/utils/navigation'
import {hypermediaUrlToRoute} from '@shm/shared/utils/url-to-route'
import {Button} from '@shm/ui/button'
import type {WebviewTag} from 'electron'
import {ExternalLink, Globe, RotateCw, X} from 'lucide-react'
import {useEffect, useRef, useState} from 'react'

let nextRequestId = 0

/** Keeps a website guest alive across native routes so Chromium can restore page history and form state. */
export function WebBrowser() {
  const route = useNavRoute()
  const dispatch = useNavigationDispatch()
  const experiments = useExperiments()
  const enabled = experiments.data?.webBrowser === true
  const {externalOpen} = useAppContext()
  const container = useRef<HTMLDivElement>(null)
  const guest = useRef<WebviewTag | null>(null)
  const [browserId, setBrowserId] = useState<number>()
  const [loading, setLoading] = useState(false)
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
  }, [active])

  useEffect(() => {
    if (!enabled || !mounted || !container.current) return
    const view = document.createElement('webview') as WebviewTag
    view.setAttribute('partition', 'persist:seed-web-browser')
    view.setAttribute('src', 'about:blank')
    view.setAttribute('allowpopups', '')
    view.setAttribute('aria-label', 'Web page')
    view.style.width = '100%'
    view.style.height = '100%'
    const attached = () => setBrowserId(view.getWebContentsId())
    const started = () => {
      setLoading(true)
      setError(null)
    }
    const stopped = () => setLoading(false)
    const failed = (event: Electron.DidFailLoadEvent) => {
      if (event.isMainFrame && event.errorCode !== -3) {
        setLoading(false)
        setError(event.errorDescription || 'The page could not be loaded.')
      }
    }
    const crashed = () => {
      setLoading(false)
      setError('The web page stopped responding. Reload to try again.')
    }
    view.addEventListener('did-attach', attached)
    view.addEventListener('did-start-loading', started)
    view.addEventListener('did-stop-loading', stopped)
    view.addEventListener('did-fail-load', failed)
    view.addEventListener('render-process-gone', crashed)
    guest.current = view
    container.current.appendChild(view)
    return () => {
      resolution.current++
      view.remove()
      guest.current = null
      setBrowserId(undefined)
      location.current = undefined
    }
  }, [enabled, mounted])

  useEffect(() => {
    if (route.key !== 'web' || !browserId || !enabled) {
      resolution.current++
      pending.current = undefined
      location.current = undefined
      if (browserId) guest.current?.stop()
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
    ipc.send('web-browser-navigate', {
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
    void resolveOmnibarUrlToRoute(event.url, {domainResolver}).then((nativeRoute) => {
      if (nativeRoute && generation === resolution.current) resolveBrowserRoute(event.url, nativeRoute)
    })
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
          <span className="text-muted-foreground min-w-0 flex-1 truncate text-xs" role="status">
            {loading ? 'Loading…' : route.title || route.url}
          </span>
          <Button
            size="icon"
            variant="ghost"
            aria-label={loading ? 'Stop loading' : 'Reload page'}
            disabled={!enabled || !browserId}
            onClick={() => (loading ? guest.current?.stop() : guest.current?.reload())}
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
          <Button variant="outline" onClick={() => guest.current?.reload()}>
            Try again
          </Button>
        </div>
      )}
      <div ref={container} className="min-h-0 flex-1" />
    </div>
  )
}
