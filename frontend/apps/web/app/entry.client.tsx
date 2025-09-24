import * as Sentry from '@sentry/react'
/**
 * By default, Remix will handle hydrating your app on the client for you.
 * You are free to delete this file if you'd like to, but if you ever want it revealed again, you can run `npx remix reveal` ✨
 * For more information, see https://remix.run/file-conventions/entry.client
 */

import {HydratedRouter, useLocation, useMatches} from 'react-router-dom'
import {startTransition, StrictMode, useEffect} from 'react'
import {hydrateRoot} from 'react-dom/client'

console.log('Will initialize Sentry Client. DSN: ', process.env.SITE_SENTRY_DSN)

Sentry.init({
  dsn: process.env.SITE_SENTRY_DSN,
  tracesSampleRate: 1,

  integrations: [
    Sentry.reactRouterV7BrowserTracingIntegration({
      useEffect,
      useLocation,
      useMatches,
    }),
    Sentry.replayIntegration({
      maskAllText: true,
      blockAllMedia: true,
    }),
  ],

  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1,
})

startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <HydratedRouter />
    </StrictMode>,
  )
})
