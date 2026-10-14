/**
 * All the configuration for the Vault server is defined here.
 * Flags are the source of truth for configuration values. Everything is defined as flags first.
 * Then we map flags to config objects.
 * There's no global singleton config values. Everything should be defined as a flag, and then parsed into objects.
 * See `create()` function defined here.
 *
 * Never use `process.env` directly in the code, especially on the frontend. Most configuration should be runtime, not build-time.
 *
 * The frontend fetched public config from the server, which explicitly exposes only what's needed. Check [GetConfigResponse] in `./api.ts`.
 */

import {HOSTED_NOTIFY_SERVICE_URL} from '@shm/shared/notify-url'
import type * as email from '@/email'
import type * as cleye from 'cleye'

export type RelyingParty = {
  id: string
  name: string
  origin: string
}

export type Server = {
  port: number
  hostname: string
}

export type Config = {
  http: Server
  backend: {
    httpBaseUrl: string
    grpcBaseUrl: string
  }
  notificationServerUrl: string
  relyingParty: RelyingParty
  dbPath: string
  smtp: email.SmtpConfig | null
  /** HTTPS email relay of the hosting service; takes precedence over SMTP when set. */
  emailRelay: email.RelayConfig | null
  /** Public web reader base URL for "open profile" links ('' = same origin). */
  webBaseUrl: string
  /** When true, creating an account requires a valid, unused invitation code. */
  inviteOnly: boolean
  /** Bearer secret for the admin API ('' = admin API disabled, answers 404). */
  adminSecret: string
}

/**
 * Unset = the hosted notify server. Set to an empty string = no notify server
 * (the frontend hides notification settings), for isolated deployments.
 */
function getDefaultNotificationServerUrl(env: NodeJS.ProcessEnv = process.env) {
  const value = env.SEED_VAULT_DEFAULT_NOTIFY_SERVER
  return value === undefined ? HOSTED_NOTIFY_SERVICE_URL : value.trim()
}

function parseBooleanEnv(value: string | undefined): boolean {
  return ['1', 'true', 'yes'].includes((value ?? '').trim().toLowerCase())
}

/** Creates flag definitions with default values parsed from the current env. */
export const flags = (env: NodeJS.ProcessEnv = process.env) => ({
  'server-hostname': {
    type: String,
    default: env.SEED_VAULT_HTTP_HOSTNAME || '0.0.0.0',
    description: 'The hostname to bind the HTTP server to',
  },
  'server-port': {
    type: Number,
    default: Number(env.SEED_VAULT_HTTP_PORT) || 3000,
    description: 'The port to bind the HTTP server to',
  },

  'rp-id': {
    type: String,
    default: env.SEED_VAULT_RP_ID || '',
    description: 'The relying party ID',
  },
  'rp-name': {
    type: String,
    default: env.SEED_VAULT_RP_NAME || 'Seed Hypermedia Identity Vault',
    description: 'The relying party name',
  },
  'rp-origin': {
    type: String,
    default: env.SEED_VAULT_RP_ORIGIN || '',
    description: 'The relying party origin',
  },

  'db-path': {
    type: String,
    default: env.SEED_VAULT_DB_PATH || './data/vault.sqlite',
    description: 'Path to the database file',
  },

  'backend-http-base-url': {
    type: String,
    default: env.SEED_VAULT_BACKEND_HTTP_BASE_URL || env.SEED_VAULT_RP_ORIGIN || '',
    description: 'Base URL for the backend daemon HTTP server used for public /ipfs access',
  },
  'backend-grpc-base-url': {
    type: String,
    default: env.SEED_VAULT_BACKEND_GRPC_BASE_URL || '',
    description: 'Base URL for the backend daemon gRPC-Web server used by the Vault backend',
  },
  'web-base-url': {
    type: String,
    default: env.SEED_VAULT_WEB_BASE_URL || '',
    description: 'Base URL of the public web reader, used for "open profile" links (empty = same origin)',
  },

  'smtp-host': {
    type: String,
    default: env.SEED_VAULT_SMTP_HOST || '',
    description: 'The SMTP host to use for sending emails',
  },
  'smtp-port': {
    type: Number,
    default: Number(env.SEED_VAULT_SMTP_PORT) || 587,
    description: 'The SMTP port to use for sending emails',
  },
  'smtp-user': {
    type: String,
    default: env.SEED_VAULT_SMTP_USER || '',
    description: 'The SMTP username to use for sending emails',
  },
  'smtp-password': {
    type: String,
    default: env.SEED_VAULT_SMTP_PASSWORD || '',
    description: 'The SMTP password to use for sending emails',
  },
  'smtp-sender': {
    type: String,
    default: env.SEED_VAULT_SMTP_SENDER || '',
    description: 'The email address to use as the sender',
  },

  'email-relay-url': {
    type: String,
    default: env.SEED_VAULT_EMAIL_RELAY_URL || '',
    description: 'HTTPS email relay to POST outgoing emails to instead of SMTP (takes precedence over SMTP)',
  },
  'email-relay-token': {
    type: String,
    default: env.SEED_VAULT_EMAIL_RELAY_TOKEN || '',
    description: 'Bearer token for the email relay',
  },

  'invite-only': {
    type: Boolean,
    default: parseBooleanEnv(env.SEED_VAULT_INVITE_ONLY),
    description: 'Require a valid invitation code to create an account (sign-in is unaffected)',
  },
  'admin-secret': {
    type: String,
    default: env.SEED_VAULT_ADMIN_SECRET || '',
    description: 'Bearer secret for the admin API under /vault/api/admin (empty = admin API disabled)',
  },
})

type FlagsDef = ReturnType<typeof flags>

type ParsedFlags = cleye.TypeFlag<FlagsDef>['flags']

export function create(pflags: ParsedFlags, env: NodeJS.ProcessEnv = process.env): Config {
  const http: Server = {
    hostname: pflags['server-hostname'],
    port: pflags['server-port'],
  }

  const relyingParty: RelyingParty = {
    id: pflags['rp-id'],
    name: pflags['rp-name'],
    origin: pflags['rp-origin'],
  }

  const backend = {
    httpBaseUrl: pflags['backend-http-base-url'],
    grpcBaseUrl: pflags['backend-grpc-base-url'] || pflags['backend-http-base-url'],
  }
  const notificationServerUrl = getDefaultNotificationServerUrl(env)

  if (!relyingParty.id) {
    throw new Error('Relying party ID configuration is required')
  }

  if (!relyingParty.origin) {
    throw new Error('Relying party origin configuration is required')
  }

  if (!backend.httpBaseUrl) {
    throw new Error('Backend HTTP base URL configuration is required')
  }

  try {
    new URL(backend.httpBaseUrl)
  } catch {
    throw new Error(`Invalid backend HTTP base URL: ${backend.httpBaseUrl}`)
  }

  if (!backend.grpcBaseUrl) {
    throw new Error('Backend gRPC base URL configuration is required')
  }

  try {
    new URL(backend.grpcBaseUrl)
  } catch {
    throw new Error(`Invalid backend gRPC base URL: ${backend.grpcBaseUrl}`)
  }

  if (notificationServerUrl) {
    try {
      new URL(notificationServerUrl)
    } catch {
      throw new Error(`Invalid notification server URL: ${notificationServerUrl}`)
    }
  }

  const dbPath = pflags['db-path']

  const smtp = pflags['smtp-host']
    ? {
        host: pflags['smtp-host'],
        port: pflags['smtp-port'],
        user: pflags['smtp-user'],
        password: pflags['smtp-password'],
        sender: pflags['smtp-sender'],
      }
    : null

  const emailRelay = pflags['email-relay-url']
    ? {
        url: pflags['email-relay-url'],
        token: pflags['email-relay-token'],
      }
    : null

  if (emailRelay) {
    try {
      new URL(emailRelay.url)
    } catch {
      throw new Error(`Invalid email relay URL: ${emailRelay.url}`)
    }
    if (!emailRelay.token) {
      throw new Error('Email relay token configuration is required when the email relay URL is set')
    }
  }

  return {
    http,
    backend,
    notificationServerUrl,
    relyingParty,
    dbPath,
    smtp,
    emailRelay,
    webBaseUrl: pflags['web-base-url'],
    inviteOnly: pflags['invite-only'],
    adminSecret: pflags['admin-secret'],
  }
}
