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

export const IS_PROD_DEV = IS_PROD_DESKTOP && VERSION?.includes('-dev')
export const IS_TEST = process.env.NODE_ENV == 'test'

export const DAEMON_HTTP_URL =
  IME.DAEMON_HTTP_URL ||
  process.env.DAEMON_HTTP_URL ||
  `${DAEMON_HOSTNAME || 'http://localhost'}:${DAEMON_HTTP_PORT}`

export const DAEMON_FILE_UPLOAD_URL = `${DAEMON_HTTP_URL}/ipfs/file-upload`

export const DAEMON_FILE_URL = `${DAEMON_HTTP_URL}/ipfs`
export const DAEMON_GRAPHQL_ENDPOINT = `${DAEMON_HOSTNAME}:${DAEMON_HTTP_PORT}/graphql`

export const SITE_BASE_URL = WEB_ENV.SITE_BASE_URL || process.env.SEED_BASE_URL

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

export const WEB_IDENTITY_ORIGIN =
  WEB_ENV.WEB_IDENTITY_ORIGIN ||
  process.env.SEED_IDENTITY_DEFAULT_ORIGIN ||
  'https://hyper.media'

// when web identity is enabled, we will REDIRECT to web identity origin to sign comments
// this will be enabled on all origins
export const WEB_IDENTITY_ENABLED =
  WEB_ENV.WEB_IDENTITY_ENABLED || process.env.SEED_IDENTITY_ENABLED !== 'false' // ENABLED BY DEFAULT

// this will be enabled when the web origin matches the SEED_BASE_URL, and passed to the client explicitly in props
export const WEB_SIGNING_ENABLED = process.env.SEED_SIGNING_ENABLED === 'true'

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

// Debug logging for all constants
console.log('📊 Constants Configuration:')
console.log('  HYPERMEDIA_SCHEME:', HYPERMEDIA_SCHEME)
console.log('  DEFAULT_GATEWAY_URL:', DEFAULT_GATEWAY_URL)
console.log('  P2P_PORT:', P2P_PORT)
console.log('  DAEMON_HTTP_PORT:', IME.VITE_DESKTOP_HTTP_PORT, DAEMON_HTTP_PORT)
console.log('  DAEMON_GRPC_PORT:', DAEMON_GRPC_PORT)
console.log('  METRIC_SERVER_HTTP_PORT:', METRIC_SERVER_HTTP_PORT)
console.log('  DAEMON_HOSTNAME:', DAEMON_HOSTNAME)
console.log('  DESKTOP_APPDATA:', DESKTOP_APPDATA)
console.log('  VERSION:', VERSION)
console.log('  COMMIT_HASH:', COMMIT_HASH)
console.log('  IS_PROD_DESKTOP:', IS_PROD_DESKTOP)
console.log('  IS_PROD_DEV:', IS_PROD_DEV)
console.log('  IS_TEST:', IS_TEST)
console.log('  🔗 DAEMON_HTTP_URL:', DAEMON_HTTP_URL)
console.log('  DAEMON_FILE_UPLOAD_URL:', DAEMON_FILE_UPLOAD_URL)
console.log('  📁 DAEMON_FILE_URL:', DAEMON_FILE_URL)
console.log('  DAEMON_GRAPHQL_ENDPOINT:', DAEMON_GRAPHQL_ENDPOINT)
console.log('  SITE_BASE_URL:', SITE_BASE_URL)
console.log('  ⚡ LIGHTNING_API_URL:', LIGHTNING_API_URL)
console.log(
  '  VITE_DESKTOP_SENTRY_DSN:',
  VITE_DESKTOP_SENTRY_DSN ? '[REDACTED]' : 'undefined',
)
console.log('  BIG_INT:', BIG_INT)
console.log('  SEED_HOST_URL:', SEED_HOST_URL)
console.log('  🔐 WEB_IDENTITY_ORIGIN:', WEB_IDENTITY_ORIGIN)
console.log('  WEB_IDENTITY_ENABLED:', WEB_IDENTITY_ENABLED)
console.log('  WEB_SIGNING_ENABLED:', WEB_SIGNING_ENABLED)
console.log('  📧 Email Config:')
console.log('    NOTIFY_SMTP_HOST:', NOTIFY_SMTP_HOST)
console.log('    NOTIFY_SMTP_PORT:', NOTIFY_SMTP_PORT)
console.log(
  '    NOTIFY_SMTP_USER:',
  NOTIFY_SMTP_USER ? '[REDACTED]' : 'undefined',
)
console.log(
  '    NOTIFY_SMTP_PASSWORD:',
  NOTIFY_SMTP_PASSWORD ? '[REDACTED]' : 'undefined',
)
console.log('    NOTIFY_SENDER:', NOTIFY_SENDER)
console.log('    ENABLE_EMAIL_NOTIFICATIONS:', ENABLE_EMAIL_NOTIFICATIONS)
console.log('  🌐 Web Flags:')
console.log('    WEB_IS_GATEWAY:', WEB_IS_GATEWAY)
console.log('    WEB_API_DISABLED:', WEB_API_DISABLED)
console.log('  Environment Sources:')
console.log(
  '    window.ENV available:',
  !!WEB_ENV && Object.keys(WEB_ENV).length > 0,
)
console.log('    import.meta.env available:', Object.keys(IME).length > 0)
console.log('    NODE_ENV:', process.env.NODE_ENV)
console.log('📊 End Constants Configuration')
