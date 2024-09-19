import { captureRemixErrorBoundaryError, withSentry } from "@sentry/remix";
import {LinksFunction} from "@remix-run/node";
import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useRouteError,
} from "@remix-run/react";
import {isClient, Text} from "@tamagui/core";
import {YStack} from "@tamagui/stacks";
import {Heading} from "@tamagui/text";
import Tamagui from "../tamagui.config";
import {Providers, ThemeProvider} from "./providers";
import globalStyles from "./styles.css?url";
import globalTamaguiStyles from "./tamagui.css?url";

export const links: LinksFunction = () => {
  return [
    {rel: "stylesheet", href: globalStyles},
    {rel: "stylesheet", href: globalTamaguiStyles},
  ];
};

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
      </body>
    </html>
  );
}

export function ErrorBoundary({}: {}) {
  const error = useRouteError();

  let errorMessage = "Unknown Error";
  if (isRouteErrorResponse(error)) {
    errorMessage = error.data.message;
  } else if (error instanceof Error) {
    errorMessage = error.message;
  }

  captureRemixErrorBoundaryError(error);

  return (
    <html>
      <head>
        <title>Oops! Something went wrong</title>
      </head>
      <body>
        <ThemeProvider>
          <YStack gap="$4">
            <Heading>Something went wrong!</Heading>
            <Text>{errorMessage}</Text>
          </YStack>
        </ThemeProvider>
        <Scripts />
      </body>
    </html>
  );
}

function App() {
  return <Outlet />;
}

export default withSentry(App);

export const Styles = () => {
  if (isClient) {
    return null;
  }
  return (
    <style
      dangerouslySetInnerHTML={{
        __html: Tamagui.getCSS({
          // design system generated into tamagui.css
          exclude: "design-system",
        }),
      }}
    />
  );
};