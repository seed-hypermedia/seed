import { type BunRequest, serve } from "bun"
import { cli } from "cleye"
import type * as api from "@/api"
import * as apisvc from "@/api-service"
import * as challenge from "@/challenge"
import * as config from "@/config"
import * as email from "@/email"
import index from "@/frontend/index.html"
import * as session from "@/session"
import * as sqlite from "@/sqlite"

async function main() {
	const argv = cli({
		name: "seed-vault",
		flags: config.flags,
		strictFlags: true,
	})

	const cfg = config.create(argv.flags)

	const db = sqlite.open(cfg.dbPath)

	const isProd = process.env.NODE_ENV === "production"

	const hmacSecret = sqlite.getOrCreateHmacSecret(db)
	const emailSender = email.createSender(cfg.smtp)
	const svc = new apisvc.Service(db, cfg.relyingParty, hmacSecret, emailSender)

	// Challenges are cleaned up when replaced or claimed.

	const server = serve({
		port: cfg.http.port,
		hostname: cfg.http.hostname,

		development: !isProd && {
			hmr: true,
			console: true,
		},

		error: handleError,

		routes: {
			// Frontend.
			"/*": index,

			...createAPIRoutes(svc),
		},
	})

	let shuttingDown = false
	const shutdown = async () => {
		if (shuttingDown) {
			return
		}

		console.log("Shutting down gracefully...")
		shuttingDown = true
		await server.stop()
		db.close()
		process.exit(0)
	}

	process.once("SIGINT", shutdown)
	process.once("SIGTERM", shutdown)

	const hostname = cfg.http.hostname === "0.0.0.0" ? "localhost" : cfg.http.hostname

	console.log(`🔐 Vault Server is running at http://${hostname}:${server.port}`)
	console.log(`   Database: ${cfg.dbPath}`)
}

if (import.meta.main) {
	main()
}

export function createAPIRoutes(svc: apisvc.Service): Bun.Serve.Routes<undefined, string> {
	return {
		"/api/pre-login": {
			POST: async (req) => {
				const body = await req.json()
				const ctx = getRequestContext(req)
				const result = await svc.preLogin(body, ctx)
				return handleResponse(result, ctx)
			},
		},
		"/api/register/start": {
			POST: async (req) => {
				const body = await req.json()
				const ctx = getRequestContext(req)
				const result = await svc.registerStart(body, ctx)
				return handleResponse(result, ctx)
			},
		},
		"/api/register/poll": {
			POST: async (req) => {
				const body = await req.json()
				const ctx = getRequestContext(req)
				const result = await svc.registerPoll(body, ctx)
				return handleResponse(result, ctx)
			},
		},
		"/api/register/verify-link": {
			POST: async (req) => {
				const body = await req.json()
				const ctx = getRequestContext(req)
				const result = await svc.registerVerifyLink(body, ctx)
				return handleResponse(result, ctx)
			},
		},

		"/api/add-password": {
			POST: async (req) => {
				const body = await req.json()
				const ctx = getRequestContext(req)
				const result = await svc.addPassword(body, ctx)
				return handleResponse(result, ctx)
			},
		},
		"/api/change-password": {
			POST: async (req) => {
				const body = await req.json()
				const ctx = getRequestContext(req)
				const result = await svc.changePassword(body, ctx)
				return handleResponse(result, ctx)
			},
		},
		"/api/login": {
			POST: async (req) => {
				const body = await req.json()
				const ctx = getRequestContext(req)
				const result = await svc.login(body, ctx)
				return handleResponse(result, ctx)
			},
		},
		"/api/vault": {
			GET: async (req) => {
				const ctx = getRequestContext(req)
				const result = await svc.getVault(ctx)
				return handleResponse(result, ctx)
			},
			POST: async (req) => {
				const body = await req.json()
				const ctx = getRequestContext(req)
				const result = await svc.saveVaultData(body, ctx)
				return handleResponse(result, ctx)
			},
		},
		"/api/logout": {
			POST: async (req) => {
				const ctx = getRequestContext(req)
				const result = await svc.logout(ctx)
				return handleResponse(result, ctx)
			},
		},
		"/api/session": {
			GET: async (req) => {
				const ctx = getRequestContext(req)
				const result = await svc.getSession(ctx)
				return handleResponse(result, ctx)
			},
		},

		// Email Change API.
		"/api/change-email/start": {
			POST: async (req) => {
				const body = await req.json()
				const ctx = getRequestContext(req)
				const result = await svc.changeEmailStart(body, ctx)
				return handleResponse(result, ctx)
			},
		},
		"/api/change-email/poll": {
			POST: async (req) => {
				const body = await req.json()
				const ctx = getRequestContext(req)
				const result = await svc.changeEmailPoll(body, ctx)
				return handleResponse(result, ctx)
			},
		},
		"/api/change-email/verify-link": {
			POST: async (req) => {
				const body = await req.json()
				const ctx = getRequestContext(req)
				const result = await svc.changeEmailVerifyLink(body, ctx)
				return handleResponse(result, ctx)
			},
		},

		// WebAuthn API.
		"/api/webauthn/register/start": {
			POST: async (req) => {
				const ctx = getRequestContext(req)
				const result = await svc.webAuthnRegisterStart(ctx)
				return handleResponse(result, ctx)
			},
		},
		"/api/webauthn/register/complete": {
			POST: async (req) => {
				const body = await req.json()
				const ctx = getRequestContext(req)
				const result = await svc.webAuthnRegisterComplete(body, ctx)
				return handleResponse(result, ctx)
			},
		},
		"/api/webauthn/login/start": {
			POST: async (req) => {
				const body = await req.json()
				const ctx = getRequestContext(req)
				const result = await svc.webAuthnLoginStart(body, ctx)
				return handleResponse(result, ctx)
			},
		},
		"/api/webauthn/login/complete": {
			POST: async (req) => {
				const body = await req.json()
				const ctx = getRequestContext(req)
				const result = await svc.webAuthnLoginComplete(body, ctx)
				return handleResponse(result, ctx)
			},
		},
		"/api/webauthn/vault": {
			POST: async (req) => {
				const body = await req.json()
				const ctx = getRequestContext(req)
				const result = await svc.webAuthnVaultStore(body, ctx)
				return handleResponse(result, ctx)
			},
		},
	}
}

// Helper to handle response and set/clear cookies based on context.
function handleResponse(data: unknown, ctx: api.ServerContext, status = 200): Response {
	const headers = new Headers({ "Content-Type": "application/json" })
	const isProd = process.env.NODE_ENV === "production"

	if (ctx.sessionCookie !== undefined) {
		headers.append("Set-Cookie", ctx.sessionCookie === null ? session.clearCookie() : ctx.sessionCookie)
	}

	if (ctx.outboundChallengeCookie !== undefined) {
		headers.append(
			"Set-Cookie",
			ctx.outboundChallengeCookie === null ? challenge.clearCookieHeader(isProd) : ctx.outboundChallengeCookie,
		)
	}

	return new Response(JSON.stringify(data), { status, headers })
}

function getRequestContext(req: BunRequest): api.ServerContext {
	const sessionId = req.cookies.get(session.SESSION_COOKIE_NAME) || null
	const isProd = process.env.NODE_ENV === "production"
	const challengeCookie = req.cookies.get(challenge.getCookieName(isProd)) || null
	return { sessionId, challengeCookie }
}

async function handleError(error: unknown): Promise<Response> {
	if ((error as apisvc.APIError).statusCode) {
		const apiError = error as apisvc.APIError
		return Response.json({ error: apiError.message }, { status: apiError.statusCode })
	}
	console.error("Unexpected error:", error)
	return Response.json({ error: "Internal server error" }, { status: 500 })
}
