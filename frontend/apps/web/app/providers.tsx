import {useNavigate} from '@remix-run/react'
import {
  createWebHMUrl,
  DAEMON_FILE_URL,
  ENABLE_EMAIL_NOTIFICATIONS,
  LIGHTNING_API_URL,
  NavRoute,
  OptimizedImageSize,
  routeToHref,
  SITE_BASE_URL,
  UniversalAppProvider,
  UnpackedHypermediaId,
  WEB_IDENTITY_ENABLED,
  WEB_IDENTITY_ORIGIN,
} from '@shm/shared'
import {languagePacks} from '@shm/shared/language-packs'
import {copyTextToClipboard} from '@shm/ui/copy-to-clipboard'
import {toast, Toaster} from '@shm/ui/toast'
import {TooltipProvider} from '@shm/ui/tooltip'
import {TamaguiProvider} from '@tamagui/core'
import {PortalProvider} from '@tamagui/portal'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {createContext, useContext, useEffect, useMemo, useState} from 'react'
import tamaConf from '../tamagui.config'

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
      <PortalProvider>
        <QueryClientProvider client={queryClient}>
          {props.children}
        </QueryClientProvider>
      </PortalProvider>
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
        <TamaguiProvider
          defaultTheme={theme}
          disableRootThemeClass
          config={tamaConf}
        >
          {children}
          <div className="pointer-events-none fixed right-0 bottom-0 z-50 h-auto w-full">
            <Toaster theme={theme} />
          </div>
        </TamaguiProvider>
      </TooltipProvider>
    </ThemeContext.Provider>
  )
}

export function getOptimizedImageUrl(cid: string, size?: OptimizedImageSize) {
  let url = `/hm/api/image/${cid}`
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
      openRoute={(route: NavRoute, replace?: boolean) => {
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
      <script
        dangerouslySetInnerHTML={{
          __html: `window.ENV = ${JSON.stringify({
            LIGHTNING_API_URL,
            SITE_BASE_URL: props.siteHost || SITE_BASE_URL,
            WEB_IDENTITY_ORIGIN,
            WEB_IDENTITY_ENABLED,
            ENABLE_EMAIL_NOTIFICATIONS,
          })}`,
        }}
      />
      {props.children}
    </UniversalAppProvider>
  )
}
