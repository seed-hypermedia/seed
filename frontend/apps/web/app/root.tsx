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
import {Providers} from './providers'
import globalStyles from './styles.css?url'
import localTailwindStyles from './tailwind.css?url'

export const links: LinksFunction = () => {
  return [
    {rel: 'stylesheet', href: globalStyles},
    {rel: 'stylesheet', href: localTailwindStyles},
  ]
}

export function Layout({children}: {children: React.ReactNode}) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body className="bg-muted min-h-screen font-sans antialiased">
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
        <div className="flex h-screen w-screen flex-col">
          <div className="flex flex-1 items-start justify-center px-4 py-12">
            <div className="border-border dark:bg-background flex w-full max-w-lg flex-0 flex-1 flex-col gap-4 rounded-lg border bg-white p-6 shadow-lg">
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

function App(props: any) {
  return <Outlet />
}

export default withSentry(App)
