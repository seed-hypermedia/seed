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
import {isClient} from '@tamagui/core'
import {XStack, YStack} from '@tamagui/stacks'
import {SizableText} from '@tamagui/text'
import Tamagui from '../tamagui.config'
import {Providers, ThemeProvider} from './providers'
import globalStyles from './styles.css?url'
import globalTamaguiStyles from './tamagui.css?url'
import {Container} from './ui/container'

export const links: LinksFunction = () => {
  return [
    {rel: 'stylesheet', href: globalStyles},
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
      <body>
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
        <ThemeProvider>
          <YStack>
            <Container>
              <YStack
                alignSelf="center"
                width={600}
                gap="$5"
                borderWidth={1}
                borderColor="$color8"
                borderRadius="$4"
                padding="$5"
                elevation="$4"
              >
                <XStack alignItems="center" gap="$3">
                  <SizableText size="$10">🤕</SizableText>
                  <SizableText size="$8" fontWeight="bold">
                    Oh oh, it's not you, it's us...
                  </SizableText>
                </XStack>
                <YStack gap="$3">
                  <SizableText>
                    Looks like something didn’t go as planned on our end. Don’t
                    worry, it’s not your fault!
                  </SizableText>
                  <SizableText>
                    Give it a quick refresh or come back in a bit, and we’ll
                    have things sorted. If it keeps happening, just reach out to
                    support and we’ll make it right in no time!
                  </SizableText>
                </YStack>
              </YStack>
            </Container>
          </YStack>
        </ThemeProvider>
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
