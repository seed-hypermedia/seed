import * as Sentry from '@sentry/bun'

const dsn = process.env.NOTIFY_SENTRY_DSN
const release = process.env.NOTIFY_SENTRY_RELEASE || process.env.SENTRY_RELEASE || undefined
const environment =
  process.env.NOTIFY_SENTRY_ENVIRONMENT || process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'production'

// Initialized on import (main.ts imports this module first) when NOTIFY_SENTRY_DSN is set.
if (dsn) {
  Sentry.init({
    dsn,
    release,
    environment,
    tracesSampleRate: 0.1,
    sendDefaultPii: false,
  })
}

/** Reports an unexpected error to Sentry (when initialized). */
export function captureException(error: unknown) {
  if (dsn) Sentry.captureException(error)
}
