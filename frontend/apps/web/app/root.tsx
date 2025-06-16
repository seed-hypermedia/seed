import {LinksFunction} from '@remix-run/node'
import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useRouteError,
} from '@remix-run/react'
import {captureRemixErrorBoundaryError, withSentry} from '@sentry/remix'
import {SizableText} from '@shm/ui/text'
import {isClient} from '@tamagui/core'
import Tamagui from '../tamagui.config'
import {Providers} from './providers'
import globalStyles from './styles.css?url'
import localTailwindStyles from './tailwind.css?url'
import globalTamaguiStyles from './tamagui.css?url'

export const links: LinksFunction = () => {
  return [
    {rel: 'stylesheet', href: globalStyles},
    {rel: 'stylesheet', href: localTailwindStyles},
    {rel: 'stylesheet', href: globalTamaguiStyles},
  ]
}

// onQueryInvalidation(queryClient.invalidateQueries);

export function Layout({children}: {children: React.ReactNode}) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
        <Styles />
      </head>
      <body className="min-h-screen font-sans antialiased bg-muted">
        <Providers>{children}</Providers>
        <ScrollRestoration />
        <Scripts />
        {process.env.MONITORING_DOMAIN && (
          <>
            <script
              defer
              file-types="rpm,deb,dmg,exe"
              data-domain={process.env.MONITORING_DOMAIN}
              src="https://plausible.io/js/script.file-downloads.hash.outbound-links.pageview-props.revenue.tagged-events.js"
            ></script>
            <script>
              {`window.plausible = window.plausible || function() {
                (window.plausible.q = window.plausible.q || []).push(arguments)
              }`}
            </script>
          </>
        )}
      </body>
    </html>
  )
}

export function ErrorBoundary({}: {}) {
  const error = useRouteError()

  let errorMessage = 'Unknown Error'
  if (isRouteErrorResponse(error)) {
    errorMessage = error.data.message
  } else if (error instanceof Error) {
    errorMessage = error.message
  }

  captureRemixErrorBoundaryError(error)

  return (
    <html>
      <head>
        <title>Oops! Something went wrong</title>
      </head>
      <body>
        <div className="h-screen w-screen flex flex-col">
          <div className="flex-1 justify-center flex items-start py-12 px-4">
            <div className="flex flex-col gap-4 flex-1 w-full max-w-lg p-6 rounded-lg border border-border flex-0 bg-white dark:bg-background shadow-lg">
              <SizableText size="5xl">🤕</SizableText>
              <SizableText size="2xl" weight="bold">
                Uh oh, it's not you, it's us...
              </SizableText>

              <SizableText asChild>
                <p>
                  Looks like something didn't go as planned on our end. Don't
                  worry, it's not your fault!
                </p>
              </SizableText>
              <SizableText asChild>
                <p>
                  Give it a quick refresh or come back in a bit, and we'll have
                  things sorted. If it keeps happening, just reach out to
                  support and we'll make it right in no time!
                </p>
              </SizableText>
            </div>
          </div>
        </div>
        <Scripts />
      </body>
    </html>
  )
}

function App() {
  return <Outlet />
}

export default withSentry(App)

export const Styles = () => {
  if (isClient) {
    return null
  }
  return (
    <style
      dangerouslySetInnerHTML={{
        __html: Tamagui.getCSS({
          // design system generated into tamagui.css
          // exclude: "design-system",
        }),
      }}
    />
  )
}
