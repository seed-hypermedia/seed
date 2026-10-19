// Strips `token` query parameters from everything the web app sends to Sentry.
// Email notification links carry an admin token (/hm/email-notifications?token=…)
// that must never leave the browser or server in telemetry. Plain JS so the
// server instrumentation (loaded by Node before the app bundle) can import it too.

const TOKEN_PARAM = /(^|[?&])token=[^&#\s"']*/g
const REDACTED = '[redacted]'
const MAX_DEPTH = 12

/**
 * @param {string} value
 * @returns {string}
 */
export function scrubTokenFromUrl(value) {
  return value.replace(TOKEN_PARAM, `$1token=${REDACTED}`)
}

/**
 * Recursively replaces token query params in every string of a Sentry payload, in place.
 * A parsed query string (`{token: …}` or `[['token', …]]`) has its token value replaced too.
 * @template T
 * @param {T} value
 * @param {number} [depth]
 * @returns {T}
 */
export function scrubSentryPayload(value, depth = 0) {
  if (depth > MAX_DEPTH || value === null || value === undefined) return value
  if (typeof value === 'string') return /** @type {T} */ (/** @type {unknown} */ (scrubTokenFromUrl(value)))
  if (Array.isArray(value)) {
    if (value.length === 2 && value[0] === 'token' && typeof value[1] === 'string') {
      value[1] = REDACTED
      return value
    }
    for (let i = 0; i < value.length; i++) value[i] = scrubSentryPayload(value[i], depth + 1)
    return value
  }
  if (typeof value === 'object') {
    const record = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (value))
    for (const key of Object.keys(record)) {
      record[key] =
        key === 'token' && typeof record[key] === 'string' ? REDACTED : scrubSentryPayload(record[key], depth + 1)
    }
  }
  return value
}

/** Sentry init options that apply {@link scrubSentryPayload} to events, transactions and breadcrumbs. */
export const sentryTokenScrubOptions = {
  /** @type {<E>(event: E) => E} */
  beforeSend: (event) => scrubSentryPayload(event),
  /** @type {<E>(event: E) => E} */
  beforeSendTransaction: (event) => scrubSentryPayload(event),
  /** @type {<B>(breadcrumb: B) => B} */
  beforeBreadcrumb: (breadcrumb) => scrubSentryPayload(breadcrumb),
}
