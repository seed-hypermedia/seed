/**
 * Re-export of the Hypermedia Auth Protocol, which now lives in
 * `@seed-hypermedia/client` so third-party spaces can consume it from a
 * published package. See `@seed-hypermedia/client/auth` for the browser-side
 * session helpers (`startAuth` / `handleCallback`).
 */

export * from '@seed-hypermedia/client/hmauth'
