import {ConnectError} from '@connectrpc/connect'
import * as Sentry from '@sentry/remix'

export type ReportErrorContext = {
  feature?: string
  operation?: string
  [key: string]: unknown
}

/**
 * Report an error to Sentry without showing it to the user.
 * Mirrors the desktop `reportError` so call sites stay symmetric across apps.
 * No-ops when Sentry isn't initialized (its own captureException already does).
 */
export function reportError(input: unknown, ctx?: ReportErrorContext): void {
  const error = toError(input)
  Sentry.withScope((scope) => {
    if (ctx) {
      const {feature, operation, ...rest} = ctx
      if (typeof feature === 'string') scope.setTag('feature', feature)
      if (typeof operation === 'string') scope.setTag('operation', operation)
      if (Object.keys(rest).length) scope.setExtras(rest)
    }
    if (input instanceof ConnectError) {
      scope.setTag('connect_code', String(input.code))
      scope.setExtras({
        connect_rawMessage: input.rawMessage,
        connect_metadata: serializeMetadata(input.metadata),
      })
    }
    Sentry.captureException(error)
  })
  if (typeof console !== 'undefined' && typeof console.error === 'function') {
    console.error('📣 🚨', error.message, ctx)
  }
}

function toError(input: unknown): Error {
  if (input instanceof Error) return input
  if (typeof input === 'string') return new Error(input)
  try {
    return new Error(JSON.stringify(input))
  } catch {
    return new Error(String(input))
  }
}

function serializeMetadata(metadata: Headers | undefined): Record<string, string> | undefined {
  if (!metadata) return undefined
  const out: Record<string, string> = {}
  metadata.forEach((value, key) => {
    out[key] = value
  })
  return out
}
