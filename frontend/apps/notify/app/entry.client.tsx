import * as Sentry from '@sentry/remix'
/**
 * By default, Remix will handle hydrating your app on the client for you.
 * You are free to delete this file if you'd like to, but if you ever want it revealed again, you can run `npx remix reveal` ✨
 * For more information, see https://remix.run/file-conventions/entry.client
 */

import {RemixBrowser, useLocation, useMatches} from '@remix-run/react'
import {startTransition, StrictMode, useEffect} from 'react'
import {hydrateRoot} from 'react-dom/client'

if (process.env.NODE_ENV === 'production' && process.env.NOTIFY_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NOTIFY_SENTRY_DSN,
    release: process.env.NOTIFY_SENTRY_RELEASE || process.env.SENTRY_RELEASE || undefined,
    environment: process.env.NOTIFY_SENTRY_ENVIRONMENT || process.env.SENTRY_ENVIRONMENT || 'production',
    integrations: [
      Sentry.browserTracingIntegration({
        useEffect,
        useLocation,
        useMatches,
      }),
      Sentry.replayIntegration({
        maskAllText: true,
        blockAllMedia: true,
      }),
    ],
    tracesSampleRate: 0.2,
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1,
    sendDefaultPii: false,
    ignoreErrors: [
      'ResizeObserver loop limit exceeded',
      'ResizeObserver loop completed with undelivered notifications',
      /Loading chunk \d+ failed/,
    ],
  })
  Sentry.setTag('app', 'notify')
}

startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <RemixBrowser />
    </StrictMode>,
  )
})
