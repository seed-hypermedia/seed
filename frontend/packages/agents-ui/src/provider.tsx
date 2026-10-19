import {createSeedClient} from '@seed-hypermedia/client'
import {registerQueryClient} from '@shm/shared/models/query-client'
import type {NavRoute} from '@shm/shared/routes'
import {UniversalAppProvider} from '@shm/shared/routing'
import type {UniversalClient} from '@shm/shared/universal-client'
import {createWebHMUrl, routeToHmUrl, unpackHmId} from '@shm/shared/utils/entity-id-url'
import {
  NavContextProvider,
  navStateReducer,
  useNavRoute,
  type NavAction,
  type NavigationContext,
  type NavMode,
  type NavState,
} from '@shm/shared/utils/navigation'
import {writeableStateStream} from '@shm/shared/utils/stream'
import {normalizeAgentServerUrl} from '@shm/ui/agents/client'
import {setAgentsPlatform, type AgentsPlatform, type AgentsRichEditorProps} from '@shm/ui/agents/platform'
import {Toaster} from '@shm/ui/toast'
import {TooltipProvider} from '@shm/ui/tooltip'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import * as React from 'react'
import {createContext, lazy, Suspense, useContext, useEffect, useMemo, useRef} from 'react'
import type {SeedAgentsHost, SeedAgentsNavigationMode} from './host'
import {toBlobsSigner} from './internal/signer'
import {isSeedAgentsRoute, seedAgentsRouteToWebUrl, type SeedAgentsRoute} from './routes'

const DEFAULT_GATEWAY_URL = 'https://hyper.media'
const SETTING_STORAGE_PREFIX = 'seed.agents.setting.'

type KitState = {
  host: SeedAgentsHost
  gatewayUrl: string
  navigate: (route: SeedAgentsRoute, mode: SeedAgentsNavigationMode) => void
}

const KitContext = createContext<KitState | null>(null)

function useKit(): KitState {
  const kit = useContext(KitContext)
  if (!kit) throw new Error('Seed agents UI must render inside <SeedAgentsProvider>')
  return kit
}

/** The host the nearest {@link SeedAgentsProvider} was given. */
export function useSeedAgentsHost(): SeedAgentsHost {
  return useKit().host
}

/** Navigates the agents UI from host code (a sidebar, a command palette, a notification). */
export function useSeedAgentsNavigate(): (route: SeedAgentsRoute, mode?: SeedAgentsNavigationMode) => void {
  const {navigate} = useKit()
  return (route, mode = 'push') => navigate(route, mode)
}

/** The route the agents UI currently shows. */
export function useSeedAgentsRoute(): SeedAgentsRoute {
  const route = useNavRoute()
  return isSeedAgentsRoute(route) ? route : {key: 'agents'}
}

// The shared agents UI reads its platform from a module singleton, registered once. The kit keeps
// the live host in this module so the registered functions always see the latest props.
let currentKit: KitState | null = null

function requireKit(): KitState {
  if (!currentKit) throw new Error('Seed agents UI used before <SeedAgentsProvider> rendered')
  return currentKit
}

function localStorageSettings(): NonNullable<SeedAgentsHost['settings']> {
  return {
    get: async (key) => {
      try {
        const raw = window.localStorage.getItem(SETTING_STORAGE_PREFIX + key)
        return raw == null ? null : JSON.parse(raw)
      } catch {
        return null
      }
    },
    set: async (key, value) => {
      try {
        if (value === undefined || value === null) window.localStorage.removeItem(SETTING_STORAGE_PREFIX + key)
        else window.localStorage.setItem(SETTING_STORAGE_PREFIX + key, JSON.stringify(value))
      } catch {
        // Private windows and blocked storage: settings stay in memory for this page.
      }
    },
  }
}

/** Opens hm:// links on the gateway and everything else in a new tab. */
function defaultOpenUrl(gatewayUrl: string) {
  return (url: string) => {
    let target = url
    if (url.startsWith('hm://')) {
      const id = unpackHmId(url)
      if (!id) return
      target = createWebHMUrl(id.uid, {
        path: id.path,
        version: id.version,
        latest: id.latest,
        blockRef: id.blockRef,
        blockRange: id.blockRange,
        hostname: gatewayUrl,
      })
    }
    window.open(target, '_blank', 'noopener,noreferrer')
  }
}

function openUrl(url?: string, newWindow?: boolean) {
  if (!url) return
  const {host, gatewayUrl} = requireKit()
  ;(host.openUrl ?? defaultOpenUrl(gatewayUrl))(url, newWindow)
}

function navigateTo(route: NavRoute, mode: NavMode) {
  if (isSeedAgentsRoute(route)) {
    requireKit().navigate(
      route,
      mode === 'spawn' ? 'spawn' : mode === 'replace' || mode === 'backplace' ? 'replace' : 'push',
    )
    return
  }
  // Documents, profiles and other Seed routes live outside the agents UI.
  const url = routeToHmUrl(route)
  if (url) openUrl(url, mode === 'spawn')
}

// Seed's own block editor and viewer (what its apps use), loaded on first use: they are most of the bundle.
const SeedCommentEditor = lazy(() =>
  import('@shm/editor/comment-editor').then((m) => ({
    default: m.CommentEditor as unknown as React.ComponentType<AgentsRichEditorProps>,
  })),
)
const SeedReadOnlyViewer = lazy(() => import('@shm/editor/readonly-viewer').then((m) => ({default: m.ReadOnlyViewer})))

function HostEditor(props: AgentsRichEditorProps) {
  const {host} = useKit()
  const Editor = host.Editor as React.ComponentType<AgentsRichEditorProps> | undefined
  if (Editor) return <Editor {...props} />
  return (
    <Suspense fallback={<div className="text-muted-foreground min-h-8 px-1 py-1 text-sm">Loading editor…</div>}>
      <SeedCommentEditor {...props} />
    </Suspense>
  )
}

type MessageViewerProps = React.ComponentProps<NonNullable<AgentsPlatform['ReadOnlyMessageViewer']>>

// Callers wrap this in a Suspense whose fallback shows the message as markdown while it loads.
function HostMessageViewer(props: MessageViewerProps) {
  const {host} = useKit()
  const Viewer = host.MessageViewer as React.ComponentType<MessageViewerProps> | undefined
  return Viewer ? <Viewer {...props} /> : <SeedReadOnlyViewer {...props} />
}

const platform: AgentsPlatform = {
  defaultServerUrl: () => currentKit?.host.serverUrl ?? null,
  getSigner: async (accountUid) => {
    const signer = requireKit().host.signer
    if (!signer) throw new Error('Sign in to use agents')
    if (signer.accountUid !== accountUid) throw new Error(`No signer for account ${accountUid}`)
    return toBlobsSigner(signer)
  },
  getDelegation: async (accountUid) => {
    const signer = requireKit().host.signer
    if (!signer || signer.accountUid !== accountUid || !signer.delegation) return null
    return signer.delegation
  },
  getSetting: (key) => (requireKit().host.settings ?? localStorageSettings()).get(key),
  setSetting: (key, value) => (requireKit().host.settings ?? localStorageSettings()).set(key, value),
  useAccountUid: () => useKit().host.signer?.accountUid ?? null,
  useNavigate:
    (mode: NavMode = 'push') =>
    (route: NavRoute) =>
      navigateTo(route, mode),
  useOpenUrl: () => openUrl,
  useGatewayUrl: () => useKit().gatewayUrl,
  useSignInPrompt: () => {
    const {host} = useKit()
    return {hasAccounts: false, signIn: host.signIn}
  },
  CommentEditor: HostEditor,
  ReadOnlyMessageViewer: HostMessageViewer,
}

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnMount: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
      },
    },
  })
}

function createUniversalClient(hmApiUrl: string): UniversalClient {
  const client = createSeedClient(hmApiUrl)
  return {
    request: client.request as UniversalClient['request'],
    publish: client.publish,
  }
}

/**
 * The route without `serverUrl` when it names the host's own server, which is what an absent
 * `serverUrl` means. Routes the host stores then stay valid wherever the page is opened from (the
 * host's proxy URL differs per origin), and match the route the UI holds whether or not it was set.
 */
function portableRoute(route: SeedAgentsRoute, serverUrl: string): SeedAgentsRoute {
  if (!('serverUrl' in route) || !route.serverUrl || route.key === 'agent-server') return route
  if (normalizeServer(route.serverUrl) !== normalizeServer(serverUrl)) return route
  const {serverUrl: _omit, ...rest} = route
  return rest as SeedAgentsRoute
}

function normalizeServer(url: string): string {
  try {
    return normalizeAgentServerUrl(url)
  } catch {
    return url
  }
}

function sameRoute(a: SeedAgentsRoute, b: SeedAgentsRoute, serverUrl: string): boolean {
  const strip = (route: SeedAgentsRoute) =>
    JSON.stringify(portableRoute(route, serverUrl), (_key, value) => (value === undefined ? undefined : value))
  return strip(a) === strip(b)
}

export type SeedAgentsProviderProps = {
  host: SeedAgentsHost
  /**
   * The route to show. Pass it to keep the agents UI in step with the host's URL; the provider
   * follows changes to it. Omit it to let the agents UI navigate on its own.
   */
  route?: SeedAgentsRoute
  /** Called after every navigation inside the agents UI (push or replace), with the new route. */
  onRouteChange?: (route: SeedAgentsRoute, mode: Exclude<SeedAgentsNavigationMode, 'spawn'>) => void
  /**
   * Opens a route in a new window ("open in new tab"). Without it, such links open Seed's web app
   * on the gateway.
   */
  openRouteInNewWindow?: (route: SeedAgentsRoute) => void
  children: React.ReactNode
}

/**
 * Supplies everything the Seed agents UI needs: the host's signer and server, a query cache, its
 * own navigation stack, and a Seed API client for accounts and documents. Render one per page;
 * the agents UI registers a single platform adapter.
 */
export function SeedAgentsProvider({
  host,
  route,
  onRouteChange,
  openRouteInNewWindow,
  children,
}: SeedAgentsProviderProps) {
  const gatewayUrl = (host.gatewayUrl ?? DEFAULT_GATEWAY_URL).replace(/\/+$/, '')
  const hmApiUrl = (host.hmApiUrl ?? gatewayUrl).replace(/\/+$/, '')
  const callbacks = useRef({onRouteChange, openRouteInNewWindow})
  callbacks.current = {onRouteChange, openRouteInNewWindow}

  const queryClient = useMemo(() => {
    const client = createQueryClient()
    registerQueryClient(client)
    return client
  }, [])
  const universalClient = useMemo(() => createUniversalClient(hmApiUrl), [hmApiUrl])

  const navigation = useMemo<NavigationContext>(() => {
    const initial: NavState = {routes: [(route ?? {key: 'agents'}) as NavRoute], routeIndex: 0, lastAction: 'replace'}
    const [write, state] = writeableStateStream(initial)
    return {
      state,
      dispatch(action: NavAction) {
        const prev = state.get()
        const next = navStateReducer(prev, action)
        if (next !== prev) write(next)
      },
    }
    // The stack is created once; later `route` props are applied by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const kit = useMemo<KitState>(
    () => ({
      host,
      gatewayUrl,
      navigate: (next, mode) => {
        if (mode === 'spawn') {
          const open = callbacks.current.openRouteInNewWindow
          if (open) open(next)
          else window.open(seedAgentsRouteToWebUrl(next, gatewayUrl), '_blank', 'noopener,noreferrer')
          return
        }
        navigation.dispatch({type: mode, route: next as NavRoute})
        callbacks.current.onRouteChange?.(portableRoute(next, host.serverUrl), mode)
      },
    }),
    [host, gatewayUrl, navigation],
  )
  currentKit = kit
  setAgentsPlatform(platform)

  // Follow the host's route (its URL changed: back button, a link elsewhere in the host).
  useEffect(() => {
    if (!route) return
    const current = navigation.state.get()
    const shown = current.routes[current.routeIndex]
    if (shown && isSeedAgentsRoute(shown) && sameRoute(shown, route, host.serverUrl)) return
    navigation.dispatch({type: 'replace', route: route as NavRoute})
  }, [route, navigation, host.serverUrl])

  return (
    <KitContext.Provider value={kit}>
      <QueryClientProvider client={queryClient}>
        <UniversalAppProvider
          universalClient={universalClient}
          origin={gatewayUrl}
          ipfsFileUrl={`${hmApiUrl}/ipfs`}
          openUrl={(url, newWindow) => openUrl(url, newWindow)}
          openRoute={(next, replace) => navigateTo(next, replace ? 'replace' : 'push')}
          openRouteNewWindow={(next) => navigateTo(next, 'spawn')}
        >
          <NavContextProvider value={navigation}>
            <TooltipProvider>
              {children}
              <Toaster />
            </TooltipProvider>
          </NavContextProvider>
        </UniversalAppProvider>
      </QueryClientProvider>
    </KitContext.Provider>
  )
}
