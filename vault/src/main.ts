import type * as api from '@/api'
import * as apisvc from '@/api-service'
import * as challenge from '@/challenge'
import * as config from '@/config'
import {createClient} from '@/daemon-client'
import * as email from '@/email'
import index from '@/frontend/index.html'
import schemaMismatch from '@/frontend/schema-mismatch.html'
import * as session from '@/session'
import * as sqlite from '@/sqlite'
import {Message} from '@bufbuild/protobuf'
import {type BunRequest, serve} from 'bun'
import {cli} from 'cleye'
import * as fs from 'node:fs'
import filepath from 'node:path'

/** Scan directory for built assets and create a lookup map for O(1) serving. */
function collectStaticAssets(dir: string, urlPrefix: string): Map<string, ReturnType<typeof Bun.file>> {
  const assets = new Map<string, ReturnType<typeof Bun.file>>()
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    if (entry.isDirectory()) {
      // Don't append subdir to URL — publicPath already handles URL mapping.
      for (const [k, v] of collectStaticAssets(filepath.join(dir, entry.name), urlPrefix)) {
        assets.set(k, v)
      }
    } else if (entry.name !== 'main.js' && !entry.name.endsWith('.map')) {
      assets.set(`${urlPrefix}${entry.name}`, Bun.file(filepath.join(dir, entry.name)))
    }
  }
  return assets
}

const isProd = process.env.NODE_ENV === 'production'

async function main() {
  const argv = cli({
    name: 'seed-vault',
    flags: config.flags(),
    strictFlags: true,
  })

  const cfg = config.create(argv.flags)
  const result = sqlite.open(cfg.dbPath)

  if (!result.ok) {
    console.error(
      `❌ Database schema mismatch: stored version is ${result.current}, but server expects ${result.desired}.`,
    )
    console.error(`   Delete the database file (rm ${cfg.dbPath}*) and restart the server.`)

    const server = serve({
      port: cfg.http.port,
      hostname: cfg.http.hostname,
      routes: {
        '/*': schemaMismatch,
      },
    })

    const hostname = cfg.http.hostname === '0.0.0.0' ? 'localhost' : cfg.http.hostname
    console.error(`   Server running at http://${hostname}:${server.port} (schema mismatch mode)`)
    return
  }

  const db = result.db
  const hmacSecret = sqlite.getOrCreateHmacSecret(db)
  const emailSender = email.createSender(cfg.smtp)
  const grpcClient = createClient(cfg.backend.grpcBaseUrl)
  const svc = new apisvc.Service(
    db,
    cfg.backend.httpBaseUrl,
    cfg.notificationServerUrl,
    grpcClient,
    cfg.relyingParty,
    hmacSecret,
    emailSender,
  )

  // Pre-build asset lookup map at startup for O(1) serving.
  const assets = isProd ? collectStaticAssets('frontend', '/vault/') : new Map()

  const server = serve({
    port: cfg.http.port,
    hostname: cfg.http.hostname,
    development: !isProd && {
      hmr: true,
      console: true,
    },
    error: handleError,
    routes: {
      ...createAPIRoutes(svc),
      // In development, proxy /hm/api/config to the web app (shares the same daemon in prod).
      '/hm/api/config': {
        GET: () => {
          if (isProd) return new Response('Not Found', {status: 404})
          return fetch('http://localhost:3000/hm/api/config').then(
            (res) => new Response(res.body, {status: res.status, headers: res.headers}),
          )
        },
      },
      '/vault': index,
      '/vault/*': isProd
        ? (req: BunRequest) => {
            const asset = assets.get(new URL(req.url).pathname)
            if (asset) {
              return new Response(asset, {
                headers: {'Content-Type': asset.type},
              })
            }
            return new Response(Bun.file('frontend/index.html'), {
              headers: {'Content-Type': 'text/html;charset=utf-8'},
            })
          }
        : index,
    },
    fetch(req) {
      const url = new URL(req.url)
      if (url.pathname === '/') {
        return Response.redirect(`${url.origin}/vault`, 302)
      }
      return new Response('Not Found', {status: 404})
    },
  })

  let shuttingDown = false
  const shutdown = async () => {
    if (shuttingDown) {
      return
    }

    console.log('Shutting down gracefully...')
    shuttingDown = true
    await server.stop()
    db.close()
    process.exit(0)
  }

  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)

  const hostname = cfg.http.hostname === '0.0.0.0' ? 'localhost' : cfg.http.hostname

  console.log(`🔐 Vault Server is running at http://${hostname}:${server.port}`)
  console.log(`   Database: ${cfg.dbPath}`)
}

if (import.meta.main) {
  main()
}

function createAPIRoutes(svc: apisvc.Service): Bun.Serve.Routes<undefined, string> {
  return {
    '/vault/api/config': {
      GET: async (req) => {
        const ctx = getRequestContext(req)
        const result = await svc.getConfig(ctx)
        return handleResponse(result, ctx)
      },
    },
    '/vault/api/session': {
      GET: async (req) => {
        const ctx = getRequestContext(req)
        const result = await svc.getSession(ctx)
        return handleResponse(result, ctx)
      },
    },
    '/vault/api/logout': {
      POST: async (req) => {
        const ctx = getRequestContext(req)
        const result = await svc.logout(ctx)
        return handleResponse(result, ctx)
      },
    },
    '/vault/api/pre-login': {
      POST: async (req) => {
        const body = await req.json()
        const ctx = getRequestContext(req)
        const result = await svc.preLogin(body, ctx)
        return handleResponse(result, ctx)
      },
    },
    '/vault/api/login': {
      POST: async (req) => {
        const body = await req.json()
        const ctx = getRequestContext(req)
        const result = await svc.login(body, ctx)
        return handleResponse(result, ctx)
      },
    },
    '/vault/api/login/passkey/start': {
      POST: async (req) => {
        const body = await req.json()
        const ctx = getRequestContext(req)
        const result = await svc.loginPasskeyStart(body, ctx)
        return handleResponse(result, ctx)
      },
    },
    '/vault/api/login/passkey/finish': {
      POST: async (req) => {
        const body = await req.json()
        const ctx = getRequestContext(req)
        const result = await svc.loginPasskeyFinish(body, ctx)
        return handleResponse(result, ctx)
      },
    },
    '/vault/api/register/start': {
      POST: async (req) => {
        const body = await req.json()
        const ctx = getRequestContext(req)
        const result = await svc.registerStart(body, ctx)
        return handleResponse(result, ctx)
      },
    },
    '/vault/api/register/poll': {
      POST: async (req) => {
        const body = await req.json()
        const ctx = getRequestContext(req)
        const result = await svc.registerPoll(body, ctx)
        return handleResponse(result, ctx)
      },
    },
    '/vault/api/register/verify-link': {
      POST: async (req) => {
        const body = await req.json()
        const ctx = getRequestContext(req)
        const result = await svc.registerVerifyLink(body, ctx)
        return handleResponse(result, ctx)
      },
    },
    '/vault/api/vault': {
      GET: async (req) => {
        const knownVersion = parseKnownVersion(new URL(req.url).searchParams.get('knownVersion'))
        const ctx = getRequestContext(req)
        const result = await svc.getVault({...(knownVersion !== undefined ? {knownVersion} : {})}, ctx)
        return handleResponse(result, ctx, 200, {
          'Cache-Control': 'no-store, private, max-age=0',
          Pragma: 'no-cache',
          Expires: '0',
          Vary: 'Authorization, Cookie',
        })
      },
      POST: async (req) => {
        const body = await req.json()
        const ctx = getRequestContext(req)
        const result = await svc.saveVault(body, ctx)
        return handleResponse(result, ctx)
      },
    },
    '/vault/api/credentials/password': {
      POST: async (req) => {
        const body = await req.json()
        const ctx = getRequestContext(req)
        const result = await svc.addPassword(body, ctx)
        return handleResponse(result, ctx)
      },
    },
    '/vault/api/credentials/password/change': {
      POST: async (req) => {
        const body = await req.json()
        const ctx = getRequestContext(req)
        const result = await svc.changePassword(body, ctx)
        return handleResponse(result, ctx)
      },
    },
    '/vault/api/credentials/secret': {
      POST: async (req) => {
        const body = await req.json()
        const ctx = getRequestContext(req)
        const result = await svc.addSecretCredential(body, ctx)
        return handleResponse(result, ctx)
      },
    },
    '/vault/api/credentials/passkey/start': {
      POST: async (req) => {
        const ctx = getRequestContext(req)
        const result = await svc.addPasskeyStart(ctx)
        return handleResponse(result, ctx)
      },
    },
    '/vault/api/credentials/passkey/finish': {
      POST: async (req) => {
        const body = await req.json()
        const ctx = getRequestContext(req)
        const result = await svc.addPasskeyFinish(body, ctx)
        return handleResponse(result, ctx)
      },
    },
    '/vault/api/email-change/start': {
      POST: async (req) => {
        const body = await req.json()
        const ctx = getRequestContext(req)
        const result = await svc.changeEmailStart(body, ctx)
        return handleResponse(result, ctx)
      },
    },
    '/vault/api/email-change/poll': {
      POST: async (req) => {
        const body = await req.json()
        const ctx = getRequestContext(req)
        const result = await svc.changeEmailPoll(body, ctx)
        return handleResponse(result, ctx)
      },
    },
    '/vault/api/email-change/verify-link': {
      POST: async (req) => {
        const body = await req.json()
        const ctx = getRequestContext(req)
        const result = await svc.changeEmailVerifyLink(body, ctx)
        return handleResponse(result, ctx)
      },
    },
    '/vault/api/accounts/:id': {
      GET: async (req) => {
        const ctx = getRequestContext(req)
        if (!req.params.id) {
          return handleResponse({error: 'Missing id'}, ctx, 400)
        }

        const result = await svc.getAccount({id: req.params.id}, ctx)
        return handleResponse(result.toJson({enumAsInteger: false, emitDefaultValues: true}), ctx)
      },
    },
  }
}

function handleResponse(data: unknown, ctx: api.ServerContext, status = 200, extraHeaders?: HeadersInit): Response {
  const headers = new Headers({'Content-Type': 'application/json'})

  if (extraHeaders) {
    new Headers(extraHeaders).forEach((value, key) => {
      headers.set(key, value)
    })
  }

  if (ctx.sessionCookie !== undefined) {
    headers.append('Set-Cookie', ctx.sessionCookie === null ? session.clearCookie() : ctx.sessionCookie)
  }

  if (ctx.outboundChallengeCookie !== undefined) {
    headers.append(
      'Set-Cookie',
      ctx.outboundChallengeCookie === null ? challenge.clearCookieHeader(isProd) : ctx.outboundChallengeCookie,
    )
  }

  const body =
    data instanceof Message
      ? data.toJson({
          emitDefaultValues: true,
          enumAsInteger: false,
        })
      : data

  return new Response(JSON.stringify(body), {status, headers})
}

function getRequestContext(req: BunRequest): api.ServerContext {
  const sessionId = req.cookies.get(session.SESSION_COOKIE_NAME) || null
  const challengeCookie = req.cookies.get(challenge.getCookieName(isProd)) || null
  const bearerAuth = parseBearerToken(req.headers.get('authorization'))
  return {sessionId, bearerAuth, challengeCookie}
}

function parseBearerToken(authorizationHeader: string | null): string | null {
  if (!authorizationHeader) {
    return null
  }

  const parts = authorizationHeader.trim().split(/\s+/)
  if (parts.length !== 2) {
    return null
  }

  const [scheme, token] = parts
  if (!scheme || !token || scheme.toLowerCase() !== 'bearer') {
    return null
  }

  return token
}

function parseKnownVersion(knownVersionRaw: string | null): number | undefined {
  if (knownVersionRaw === null) {
    return undefined
  }
  if (knownVersionRaw.trim() === '') {
    throw new apisvc.APIError('Invalid knownVersion', 400)
  }

  const knownVersion = Number(knownVersionRaw)
  if (!Number.isSafeInteger(knownVersion) || knownVersion < 0) {
    throw new apisvc.APIError('Invalid knownVersion', 400)
  }

  return knownVersion
}

async function handleError(error: unknown): Promise<Response> {
  if ((error as apisvc.APIError).statusCode) {
    const apiError = error as apisvc.APIError
    return Response.json({error: apiError.message}, {status: apiError.statusCode})
  }
  console.error('Unexpected error:', error)
  return Response.json({error: 'Internal server error'}, {status: 500})
}
