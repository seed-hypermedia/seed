import * as Sentry from '@sentry/remix'
import {nodeProfilingIntegration} from '@sentry/profiling-node'
import fs from 'node:fs'
import path from 'node:path'

const dsn = process.env.SITE_SENTRY_DSN
const release =
  process.env.SITE_SENTRY_RELEASE || process.env.SENTRY_RELEASE || readFileFirstLine('COMMIT_HASH') || undefined
const environment =
  process.env.SITE_SENTRY_ENVIRONMENT || process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'production'

if (dsn) {
  Sentry.init({
    dsn,
    release,
    environment,
    autoInstrumentRemix: true,
    integrations: [nodeProfilingIntegration()],
    tracesSampler: (samplingContext) => {
      const url =
        samplingContext?.normalizedRequest?.url ||
        samplingContext?.request?.url ||
        samplingContext?.transactionContext?.name ||
        ''
      if (typeof url === 'string') {
        if (url.includes('/healthz') || url.includes('/health')) return 0
        if (url.endsWith('.map') || url.endsWith('.ico')) return 0
      }
      return 0.1
    },
    profilesSampleRate: 1.0,
    sendDefaultPii: false,
    ignoreErrors: ['AbortError', /Unexpected token '<'/, /Loading chunk \d+ failed/],
  })
}

function readFileFirstLine(name) {
  try {
    const p = path.join(process.cwd(), name)
    return fs.readFileSync(p, 'utf8').trim() || null
  } catch {
    return null
  }
}
