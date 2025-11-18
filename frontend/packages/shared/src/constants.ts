/// <reference types="vite/client" />

// we are using this ternary ugly thing with `import.meta.env?` and `process.env` because this variables will be loaded in different runtimes, and not in all runtines both "ways" are available.

const IME: Record<string, any> = (() => {
  try {
    // Check if we're in a Vite environment by looking for import.meta
    if (typeof globalThis !== 'undefined' && 'importMeta' in globalThis) {
      return (globalThis as any).importMeta?.env ?? {}
    }
    // Try direct access in modern environments
    // @ts-ignore
    if (typeof import.meta !== 'undefined' && import.meta.env) {
      // @ts-ignore
      return import.meta.env
    }
    return {}
  } catch {
    return {}
  }
})()

const WEB_ENV = (() => {
  try {
    return (window as any).ENV || {}
  } catch (e) {
    return {}
  }
})()

export const HYPERMEDIA_SCHEME = 'hm'

export const DEFAULT_GATEWAY_URL: string =
  IME.VITE_GATEWAY_URL || process.env.VITE_GATEWAY_URL || 'https://hyper.media'

export const P2P_PORT =
  IME.VITE_DESKTOP_P2P_PORT || process.env.VITE_DESKTOP_P2P_PORT || 56000

export const DAEMON_HTTP_PORT =
  process.env.DAEMON_HTTP_PORT ||
  IME.VITE_DESKTOP_HTTP_PORT ||
  process.env.VITE_DESKTOP_HTTP_PORT ||
  56001
export const DAEMON_GRPC_PORT =
  IME.VITE_DESKTOP_GRPC_PORT || process.env.VITE_DESKTOP_GRPC_PORT || 56002

export const METRIC_SERVER_HTTP_PORT =
  IME.VITE_METRIC_SERVER_HTTP_PORT ||
  process.env.VITE_METRIC_SERVER_HTTP_PORT ||
  56003

export const DAEMON_HOSTNAME =
  IME.VITE_DESKTOP_HOSTNAME || process.env.VITE_DESKTOP_HOSTNAME

export const DESKTOP_APPDATA =
  IME.VITE_DESKTOP_APPDATA || process.env.VITE_DESKTOP_APPDATA || 'Seed'

export const VERSION =
  IME.VITE_VERSION || process.env.VITE_VERSION || '0.0.100-dev'

export const COMMIT_HASH =
  IME.VITE_COMMIT_HASH ||
  process.env.VITE_COMMIT_HASH ||
  'LOCAL_abcdefghijklmnopqrst0123456789qwertyuiopasdfghjklzxcvbnm'

// this is injected by Vite, so it indicates if we are in the production build of the DESKTOP app

export const IS_PROD_DESKTOP =
  !!IME.PROD || process.env.NODE_ENV === 'production'

export const IS_DESKTOP = (() => {
  try {
    return typeof window !== 'undefined' && 'ipc' in window
  } catch {
    return false
  }
})()

export const IS_WEB = !IS_DESKTOP

export const AVOID_UPDATES =
  !!IME.VITE_AVOID_UPDATES || process.env.VITE_AVOID_UPDATES == 'true' || false

export const IS_PROD_DEV = IS_PROD_DESKTOP && VERSION?.includes('-dev')
export const IS_TEST = process.env.NODE_ENV == 'test'

export const DAEMON_HTTP_URL =
  IME.DAEMON_HTTP_URL ||
  process.env.DAEMON_HTTP_URL ||
  `${DAEMON_HOSTNAME || 'http://localhost'}:${DAEMON_HTTP_PORT}`

export const DAEMON_FILE_UPLOAD_URL = `${DAEMON_HTTP_URL}/ipfs/file-upload`

export const DAEMON_GRAPHQL_ENDPOINT = `${DAEMON_HOSTNAME}:${DAEMON_HTTP_PORT}/graphql`

export const SITE_BASE_URL =
  WEB_ENV.SITE_BASE_URL || process.env.SEED_BASE_URL || 'https://hyper.media'

export const LIGHTNING_API_URL =
  WEB_ENV.LIGHTNING_API_URL ||
  process.env.LIGHTNING_API_URL ||
  IME.VITE_LIGHTNING_API_URL ||
  'https://ln.seed.hyper.media'

export const VITE_DESKTOP_SENTRY_DSN =
  IME.VITE_DESKTOP_SENTRY_DSN || process.env.VITE_DESKTOP_SENTRY_DSN

export const BIG_INT = 2 ** 25 // 2^31 was too big for grpc

export const SEED_HOST_URL =
  process.env.VITE_SEED_HOST_URL ||
  IME.VITE_SEED_HOST_URL ||
  'http://localhost:5555'

export const SEED_ASSET_HOST =
  WEB_ENV.SEED_ASSET_HOST || process.env.SEED_ASSET_HOST || IME.SEED_ASSET_HOST

export const DAEMON_FILE_URL = `${SEED_ASSET_HOST || DAEMON_HTTP_URL}/ipfs`

export const WEB_IDENTITY_ORIGIN =
  WEB_ENV.WEB_IDENTITY_ORIGIN ||
  process.env.SEED_IDENTITY_DEFAULT_ORIGIN ||
  'https://hyper.media'

// when web identity is enabled, we will REDIRECT to web identity origin to sign comments
// this will be enabled on all origins
export const WEB_IDENTITY_ENABLED =
  WEB_ENV.WEB_IDENTITY_ENABLED || process.env.SEED_IDENTITY_ENABLED !== 'false' // ENABLED BY DEFAULT

// this will be enabled when the web origin matches the SEED_BASE_URL, and passed to the client explicitly in props
export const WEB_SIGNING_ENABLED = true

export const NOTIFY_SMTP_HOST = process.env.NOTIFY_SMTP_HOST
export const NOTIFY_SMTP_PORT = process.env.NOTIFY_SMTP_PORT
export const NOTIFY_SMTP_USER = process.env.NOTIFY_SMTP_USER
export const NOTIFY_SMTP_PASSWORD = process.env.NOTIFY_SMTP_PASSWORD
export const NOTIFY_SENDER = process.env.NOTIFY_SENDER

export const WEB_IS_GATEWAY = process.env.SEED_IS_GATEWAY === 'true'

export const WEB_API_DISABLED = process.env.SEED_API_ENABLED === 'false'

export const ENABLE_EMAIL_NOTIFICATIONS =
  WEB_ENV.ENABLE_EMAIL_NOTIFICATIONS ||
  !!(
    NOTIFY_SMTP_HOST &&
    NOTIFY_SMTP_PORT &&
    NOTIFY_SMTP_USER &&
    NOTIFY_SMTP_PASSWORD &&
    NOTIFY_SENDER
  )

export const NOTIFY_SERVICE_HOST: string | undefined =
  IME.VITE_NOTIFY_SERVICE_HOST || // desktop app
  process.env.NOTIFY_SERVICE_HOST || // web server
  WEB_ENV.NOTIFY_SERVICE_HOST // web client
