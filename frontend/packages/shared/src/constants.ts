/// <reference types="vite/client" />

// we are using this ternary ugly thing with `import.meta.env?` and `process.env` because this variables will be loaded in different runtimes, and not in all runtines both "ways" are available.

export const HYPERMEDIA_SCHEME = 'hm'

export const DEFAULT_GATEWAY_URL =
  (import.meta.env && import.meta.env.VITE_GATEWAY_URL) ||
  process.env.VITE_GATEWAY_URL ||
  'https://hyper.media'

export const P2P_PORT =
  (import.meta.env && import.meta.env.VITE_DESKTOP_P2P_PORT) ||
  process.env.VITE_DESKTOP_P2P_PORT ||
  56000

export const DAEMON_HTTP_PORT =
  process.env.DAEMON_HTTP_PORT ||
  (import.meta.env && import.meta.env.VITE_DESKTOP_HTTP_PORT) ||
  process.env.VITE_DESKTOP_HTTP_PORT ||
  56001
export const DAEMON_GRPC_PORT =
  (import.meta.env && import.meta.env.VITE_DESKTOP_GRPC_PORT) ||
  process.env.VITE_DESKTOP_GRPC_PORT ||
  56002

export const METRIC_SERVER_HTTP_PORT =
  (import.meta.env && import.meta.env.VITE_METRIC_SERVER_HTTP_PORT) ||
  process.env.VITE_METRIC_SERVER_HTTP_PORT ||
  56003

export const DAEMON_HOSTNAME =
  (import.meta.env && import.meta.env.VITE_DESKTOP_HOSTNAME) ||
  process.env.VITE_DESKTOP_HOSTNAME

export const DESKTOP_APPDATA =
  (import.meta.env && import.meta.env.VITE_DESKTOP_APPDATA) ||
  process.env.VITE_DESKTOP_APPDATA ||
  'Seed'

export const VERSION =
  (import.meta.env && import.meta.env.VITE_VERSION) ||
  process.env.VITE_VERSION ||
  '0.0.100-dev'

export const COMMIT_HASH =
  (import.meta.env && import.meta.env.VITE_COMMIT_HASH) ||
  process.env.VITE_COMMIT_HASH ||
  'LOCAL_abcdefghijklmnopqrst0123456789qwertyuiopasdfghjklzxcvbnm'

// this is injected by Vite, so it indicates if we are in the production build of the DESKTOP app
export const IS_PROD_DESKTOP = !!import.meta.env?.PROD
export const IS_PROD_DEV = VERSION?.includes('-dev')

export const DAEMON_HTTP_URL =
  process.env.DAEMON_HTTP_URL ||
  `${DAEMON_HOSTNAME || 'http://localhost'}:${DAEMON_HTTP_PORT}`

export const DAEMON_FILE_UPLOAD_URL = `${DAEMON_HOSTNAME}:${DAEMON_HTTP_PORT}/ipfs/file-upload`

const appFileURL = DAEMON_HOSTNAME
  ? `${DAEMON_HOSTNAME}:${DAEMON_HTTP_PORT}/ipfs`
  : undefined
const webFileURL = process.env.SEED_BASE_URL
  ? `${process.env.SEED_BASE_URL}/ipfs`
  : undefined
export const DAEMON_FILE_URL = // this is used to find /ipfs/ urls on the app and web, in dev and prod.
  process.env.DAEMON_FILE_URL ?? // first we check for an explicit configuration which is used in web dev script
  webFileURL ?? // then we handle web production which has SEED_BASE_URL set
  appFileURL ?? // appFileURL for desktop
  '/ipfs'
export const DAEMON_GRAPHQL_ENDPOINT = `${DAEMON_HOSTNAME}:${DAEMON_HTTP_PORT}/graphql`

const WEB_ENV = (() => {
  try {
    return window.ENV || {}
  } catch (e) {
    return {}
  }
})()

export const SITE_BASE_URL = WEB_ENV.SITE_BASE_URL || process.env.SEED_BASE_URL

export const LIGHTNING_API_URL =
  WEB_ENV.LIGHTNING_API_URL ||
  process.env.LIGHTNING_API_URL ||
  (import.meta.env && import.meta.env.VITE_LIGHTNING_API_URL) ||
  'https://ln.seed.hyper.media'

export const VITE_DESKTOP_SENTRY_DSN =
  (import.meta.env && import.meta.env.VITE_DESKTOP_SENTRY_DSN) ||
  process.env.VITE_DESKTOP_SENTRY_DSN

export const BIG_INT = 2 ** 25 // 2^31 was too big for grpc
