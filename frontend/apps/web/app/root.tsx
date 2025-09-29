import {json, LinksFunction, LoaderFunctionArgs} from '@remix-run/node'
import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLoaderData,
  useRouteError,
} from '@remix-run/react'
import {captureRemixErrorBoundaryError, withSentry} from '@sentry/remix'
import {SizableText} from '@shm/ui/text'
import sonnerStyles from 'sonner/dist/styles.css?url'
import {Providers} from './providers'
import globalStyles from './styles.css?url'
import localTailwindStyles from './tailwind.css?url'

export const links: LinksFunction = () => {
  return [
    {rel: 'stylesheet', href: globalStyles},
    {rel: 'stylesheet', href: localTailwindStyles},
    {rel: 'stylesheet', href: sonnerStyles},
  ]
}

// enable statistics when SEED_ENABLE_STATISTICS is "true" or "1" at build-time

function getBaseDomain(host: string) {
  if (!host || host === 'localhost' || /^[0-9.]+$/.test(host)) return host
  const parts = host.split('.')
  if (parts.length <= 2) return host

  const twoLevel = new Set([
    'co.uk',
    'org.uk',
    'gov.uk',
    'ac.uk',
    'net.uk',
    'sch.uk',
  ])
  const lastTwo = parts.slice(-2).join('.')
  if (twoLevel.has(lastTwo) && parts.length >= 3) {
    return parts.slice(-3).join('.')
  }
  return lastTwo
}

export async function loader({request}: LoaderFunctionArgs) {
  const url = new URL(request.url)
  const runtimeDomain = getBaseDomain(url.hostname)

  // Gate everything on the server so no client env access is needed
  const isProd = process.env.NODE_ENV === 'production'

  const enableStats =
    process.env.SEED_ENABLE_STATISTICS === 'true' ||
    process.env.SEED_ENABLE_STATISTICS === '1'

  const domain = process.env.MONITORING_DOMAIN || runtimeDomain

  const result = {isProd, enableStats, domain}

  return json(result)
}

export function Layout({children}: {children: React.ReactNode}) {
  const {isProd, enableStats, domain} = useLoaderData<typeof loader>()
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
        {/* Put Plausible in <head> so it loads ASAP */}
        {isProd && enableStats ? (
          <script
            defer
            data-domain={domain}
            // enable the same plugins you had:
            file-types="rpm,deb,dmg,exe"
            src="https://plausible.io/js/script.file-downloads.hash.outbound-links.pageview-props.revenue.tagged-events.js"
          />
        ) : null}
      </head>
      <body className="bg-muted min-h-screen font-sans antialiased">
        <Providers>{children}</Providers>

        <ScrollRestoration />
        <Scripts />
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
            <div className="border-border dark:bg-background flex w-full max-w-lg flex-1 flex-col gap-4 rounded-lg border bg-white p-6 shadow-lg">
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
