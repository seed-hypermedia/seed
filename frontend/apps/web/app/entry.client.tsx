import * as Sentry from '@sentry/remix'

/**
 * By default, Remix will handle hydrating your app on the client for you.
 * You are free to delete this file if you'd like to, but if you ever want it revealed again, you can run `npx remix reveal` ✨
 * For more information, see https://remix.run/file-conventions/entry.client
 */

import {RemixBrowser, useLocation, useMatches} from '@remix-run/react'
import {seedBrowserTracePropagationTargets} from '@shm/shared/sentry-tracing'
import {startTransition, StrictMode, useEffect} from 'react'
import {hydrateRoot} from 'react-dom/client'

if (process.env.NODE_ENV === 'production' && process.env.SITE_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SITE_SENTRY_DSN,
    release: process.env.SITE_SENTRY_RELEASE || process.env.SENTRY_RELEASE || undefined,
    environment: process.env.SITE_SENTRY_ENVIRONMENT || process.env.SENTRY_ENVIRONMENT || 'production',
    integrations: [
      Sentry.browserTracingIntegration({
        useEffect,
        useLocation,
        useMatches,
      }),
      Sentry.browserProfilingIntegration(),
      Sentry.replayIntegration({
        maskAllText: true,
        blockAllMedia: true,
      }),
    ],
    tracesSampleRate: 0.2,
    profilesSampleRate: 1.0,
    tracePropagationTargets: seedBrowserTracePropagationTargets,
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1,
    sendDefaultPii: false,
    ignoreErrors: [
      'ResizeObserver loop limit exceeded',
      'ResizeObserver loop completed with undelivered notifications',
      'NetworkError when attempting to fetch resource',
      /Loading chunk \d+ failed/,
      /Failed to fetch dynamically imported module/,
    ],
  })
  Sentry.setTag('app', 'web')
}

function HydratedRemixBrowser() {
  useEffect(() => {
    document.documentElement.dataset.seedHydrated = 'true'
  }, [])

  return <RemixBrowser />
}

startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <HydratedRemixBrowser />
    </StrictMode>,
  )
})
