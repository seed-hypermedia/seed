import {useNavigate} from '@remix-run/react'
import {
  createWebHMUrl,
  NavRoute,
  OptimizedImageSize,
  routeToHref,
  UniversalAppProvider,
  UnpackedHypermediaId,
} from '@shm/shared'
import {
  DAEMON_FILE_URL,
  SEED_ASSET_HOST,
  SITE_BASE_URL,
} from '@shm/shared/constants'
import {languagePacks} from '@shm/shared/language-packs'
import {defaultRoute} from '@shm/shared/routes'
import {
  NavAction,
  NavContextProvider,
  NavState,
  navStateReducer,
  setAppNavDispatch,
} from '@shm/shared/utils/navigation'
import {writeableStateStream} from '@shm/shared/utils/stream'
import {copyTextToClipboard} from '@shm/ui/copy-to-clipboard'
import {toast, Toaster} from '@shm/ui/toast'
import {TooltipProvider} from '@shm/ui/tooltip'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {createContext, useContext, useEffect, useMemo, useState} from 'react'
import {webUniversalClient} from './universal-client'

const queryClient = new QueryClient()

type ThemeContextType = {
  theme: 'light' | 'dark'
  setTheme: (theme: 'light' | 'dark') => void
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined)

export const useTheme = () => {
  const context = useContext(ThemeContext)
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return context
}

export const Providers = (props: {children: any}) => {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        {props.children}
      </QueryClientProvider>
    </ThemeProvider>
  )
}

export function ThemeProvider({children}: {children: React.ReactNode}) {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    // Check system preference on initial load
    if (typeof window !== 'undefined') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
    }
    return 'light'
  })

  // Update document class when theme changes
  useEffect(() => {
    if (typeof document !== 'undefined') {
      if (theme === 'dark') {
        document.documentElement.classList.add('dark')
      } else {
        document.documentElement.classList.remove('dark')
      }
    }
  }, [theme])

  // Listen for system theme changes
  // @ts-expect-error
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
      const handleChange = (e: MediaQueryListEvent) => {
        setTheme(e.matches ? 'dark' : 'light')
      }

      mediaQuery.addEventListener('change', handleChange)
      return () => mediaQuery.removeEventListener('change', handleChange)
    }
  }, [])

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'light' ? 'dark' : 'light'))
  }

  return (
    <ThemeContext.Provider value={{theme, setTheme, toggleTheme}}>
      <TooltipProvider>
        {children}
        <div className="fixed right-0 bottom-0 z-50 h-auto w-full">
          <Toaster theme={theme} />
        </div>
      </TooltipProvider>
    </ThemeContext.Provider>
  )
}

export function getOptimizedImageUrl(cid: string, size?: OptimizedImageSize) {
  let url = SEED_ASSET_HOST || ''
  url += `/hm/api/image/${cid}`
  if (size) url += `?size=${size}`
  return url
}

export function WebSiteProvider(props: {
  originHomeId: UnpackedHypermediaId
  children: React.ReactNode
  siteHost?: string
  origin?: string
  prefersLanguages?: (keyof typeof languagePacks)[]
}) {
  const navigate = useNavigate()
  const languagePack = useMemo(() => {
    const language = props.prefersLanguages?.[0]
    if (language) {
      return languagePacks[language]
    }
    return undefined
  }, [props.prefersLanguages])

  // Create navigation context
  const navigation = useMemo(() => {
    const initialNav: NavState = {
      sidebarLocked: false,
      routes: [defaultRoute],
      routeIndex: 0,
      lastAction: 'replace',
    }
    const [updateNavState, navState] = writeableStateStream(initialNav)

    return {
      dispatch(action: NavAction) {
        const prevState = navState.get()
        const newState = navStateReducer(prevState, action)
        if (prevState !== newState) {
          updateNavState(newState)
        }
      },
      state: navState,
    }
  }, [])

  useEffect(() => {
    setAppNavDispatch(navigation.dispatch)
    return () => {
      setAppNavDispatch(null)
    }
  }, [navigation.dispatch])

  return (
    <UniversalAppProvider
      origin={props.origin}
      originHomeId={props.originHomeId}
      languagePack={languagePack}
      getOptimizedImageUrl={getOptimizedImageUrl}
      ipfsFileUrl={DAEMON_FILE_URL}
      openUrl={(url) => {
        window.open(url, '_blank')
      }}
      universalClient={webUniversalClient}
      openRoute={(route: NavRoute, replace?: boolean) => {
        // Update navigation state
        if (replace) {
          navigation.dispatch({type: 'replace', route})
        } else {
          navigation.dispatch({type: 'push', route})
        }

        // Handle browser navigation
        let href: undefined | string = undefined
        href = routeToHref(route, {
          originHomeId: props.originHomeId,
        })
        if (href !== undefined) {
          if (
            // this is a HACK to redirect to the home page when the user is on the home page of seed.hyper.media because we have an external landing page.
            window.location.host == 'seed.hyper.media' &&
            typeof href == 'string' &&
            (href == '/' || href == '')
          ) {
            console.log('redirecting to seed.hyper.media')
            window.location.assign('https://seed.hyper.media')
          } else {
            navigate(href, {
              replace,
            })
          }
        } else {
          toast.error('Failed to open route')
        }
      }}
      onCopyReference={async (hmId: UnpackedHypermediaId) => {
        const url = createWebHMUrl(hmId.uid, {
          ...hmId,
          hostname: SITE_BASE_URL,
        })
        copyTextToClipboard(url)
        toast.success('Comment link copied to clipboard')
      }}
    >
      <NavContextProvider value={navigation}>
        {props.children}
      </NavContextProvider>
    </UniversalAppProvider>
  )
}
