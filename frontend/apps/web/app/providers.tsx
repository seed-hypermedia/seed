import {
  createWebHMUrl,
  DAEMON_FILE_URL,
  ENABLE_EMAIL_NOTIFICATIONS,
  LIGHTNING_API_URL,
  OptimizedImageSize,
  SITE_BASE_URL,
  UniversalAppProvider,
  UnpackedHypermediaId,
  WEB_IDENTITY_ENABLED,
  WEB_IDENTITY_ORIGIN,
} from '@shm/shared'
import {copyTextToClipboard} from '@shm/ui/copy-to-clipboard'
import {toast, Toaster} from '@shm/ui/toast'
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
    <TamaguiProvider
      defaultTheme="light"
      // disableInjectCSS
      disableRootThemeClass
      config={tamaConf}
    >
      {children}
    </TamaguiProvider>
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
  return (
    <UniversalAppProvider
      origin={props.origin}
      originHomeId={props.originHomeId}
      getOptimizedImageUrl={getOptimizedImageUrl}
      ipfsFileUrl={DAEMON_FILE_URL}
      openUrl={(url) => {
        window.open(url, '_blank')
      }}
      openRoute={null}
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
