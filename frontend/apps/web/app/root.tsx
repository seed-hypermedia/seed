import {LinksFunction} from '@remix-run/node'
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
import {hmId} from '@shm/shared'
import {SizableText} from '@shm/ui/text'
import {isClient} from '@tamagui/core'
import Tamagui from '../tamagui.config'
import {DocumentPage} from './document'
import {loadSiteResource, WebResourcePayload} from './loaders'
import {Providers} from './providers'
import {parseRequest} from './request'
import {getConfig} from './site-config'
import globalStyles from './styles.css?url'
import localTailwindStyles from './tailwind.css?url'
import globalTamaguiStyles from './tamagui.css?url'
import {unwrap, wrapJSON} from './wrapping'

export const links: LinksFunction = () => {
  return [
    {rel: 'stylesheet', href: globalStyles},
    {rel: 'stylesheet', href: globalTamaguiStyles},
    {rel: 'stylesheet', href: localTailwindStyles},
  ]
}

export const loader = async ({request}: {request: Request}) => {
  const parsedRequest = parseRequest(request)
  const {url, hostname, pathParts} = parsedRequest
  if (pathParts.length !== 0) return null
  const version = url.searchParams.get('v')
  const latest = url.searchParams.get('l') === ''
  console.log('~~ url', url)
  const serviceConfig = await getConfig(hostname)
  if (!serviceConfig) return wrapJSON('no-site', {status: 404})
  const {registeredAccountUid} = serviceConfig
  if (!registeredAccountUid) return wrapJSON('unregistered', {status: 404})

  let documentId

  // Determine document type based on URL pattern
  if (pathParts[0] === 'hm' && pathParts.length > 1) {
    // Hypermedia document (/hm/uid/path...)
    const commentTarget = url.searchParams.get('target')?.split('/')
    const targetDocUid = !!commentTarget?.[0] ? commentTarget?.[0] : undefined
    const targetDocPath = targetDocUid ? commentTarget?.slice(1) : undefined

    documentId = hmId(pathParts[1], {
      path: pathParts.slice(2),
      version,
      latest,
      targetDocUid,
    })
  } else {
    // Site document (regular path)
    const path = url.pathname.split('/').filter(Boolean)
    documentId = hmId(registeredAccountUid, {path, version, latest})
  }

  return await loadSiteResource(parsedRequest, documentId, {
    prefersLanguages: parsedRequest.prefersLanguages,
  })
}

// onQueryInvalidation(queryClient.invalidateQueries);

export function Layout({children}: {children: React.ReactNode}) {
  return (
    <html lang="en">
      <head>
        <Styles />
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

// function App(props: any) {
//   const lolerData = useLoaderData<typeof loader>()
//   console.log('~~ lolerData', lolerData)
//   return <Outlet />
// }

export function AppWithDocument() {
  const wrappedData = useLoaderData()
  if (wrappedData === null) return <Outlet />
  const data = unwrap<WebResourcePayload>(wrappedData)
  console.log('~~ root data', data)
  return <DocumentPage {...data} />
}

export default withSentry(AppWithDocument)

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
