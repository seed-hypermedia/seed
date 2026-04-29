import * as Sentry from '@sentry/remix'

const dsn = process.env.NOTIFY_SENTRY_DSN
const release = process.env.NOTIFY_SENTRY_RELEASE || process.env.SENTRY_RELEASE || undefined
const environment =
  process.env.NOTIFY_SENTRY_ENVIRONMENT ||
  process.env.SENTRY_ENVIRONMENT ||
  process.env.NODE_ENV ||
  'production'

if (dsn) {
  Sentry.init({
    dsn,
    release,
    environment,
    autoInstrumentRemix: true,
    tracesSampleRate: 0.1,
    sendDefaultPii: false,
  })
}
