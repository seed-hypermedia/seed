import {useNavigate} from '@remix-run/react'
import {
  createWebHMUrl,
  DAEMON_FILE_URL,
  ENABLE_EMAIL_NOTIFICATIONS,
  idToUrl,
  LIGHTNING_API_URL,
  NavRoute,
  OptimizedImageSize,
  SITE_BASE_URL,
  UniversalAppProvider,
  UnpackedHypermediaId,
  WEB_IDENTITY_ENABLED,
  WEB_IDENTITY_ORIGIN,
} from '@shm/shared'
import {copyTextToClipboard} from '@shm/ui/copy-to-clipboard'
import {toast, Toaster} from '@shm/ui/toast'
import {TooltipProvider} from '@shm/ui/tooltip'
import {TamaguiProvider} from '@tamagui/core'
import {PortalProvider} from '@tamagui/portal'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {createContext, useContext, useEffect, useState} from 'react'
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
          <Toaster
          // position="bottom-center"
          // toastOptions={{className: 'toaster'}}
          />
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
}) {
  const navigate = useNavigate()
  return (
    <UniversalAppProvider
      origin={props.origin}
      originHomeId={props.originHomeId}
      getOptimizedImageUrl={getOptimizedImageUrl}
      ipfsFileUrl={DAEMON_FILE_URL}
      openUrl={(url) => {
        window.open(url, '_blank')
      }}
      openRoute={(route: NavRoute, replace?: boolean) => {
        let href: null | string = null
        if (route.key === 'document') {
          href = idToUrl(route.id, {
            originHomeId: props.originHomeId,
          })
        }
        if (href) {
          navigate(href, {
            replace,
          })
        } else {
          toast.error('Failed to open route')
        }
      }}
      onCopyReference={async (hmId: UnpackedHypermediaId) => {
        const url = createWebHMUrl(hmId.type, hmId.uid, {
          ...hmId,
          hostname: SITE_BASE_URL,
        })
        copyTextToClipboard(url)
        toast('Comment link copied to clipboard')
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
