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
import tamaConf from '../tamagui.config'

const queryClient = new QueryClient()

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
  return (
    <TooltipProvider>
      <TamaguiProvider
        defaultTheme="light"
        // disableInjectCSS
        disableRootThemeClass
        config={tamaConf}
      >
        {children}
      </TamaguiProvider>
    </TooltipProvider>
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
