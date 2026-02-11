import { readdirSync } from "node:fs"
import { join } from "node:path"
import { type BunRequest, serve } from "bun"
import { cli } from "cleye"
import type * as api from "@/api"
import * as apisvc from "@/api-service"
import * as config from "@/config"
import index from "@/frontend/index.html"
import * as session from "@/session"
import * as sqlite from "@/sqlite"

/** Scan directory for built assets and create a lookup map for O(1) serving. */
function collectStaticAssets(dir: string, urlPrefix: string): Map<string, ReturnType<typeof Bun.file>> {
	const assets = new Map<string, ReturnType<typeof Bun.file>>()
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (entry.isDirectory()) {
			for (const [k, v] of collectStaticAssets(join(dir, entry.name), `${urlPrefix}${entry.name}/`)) {
				assets.set(k, v)
			}
		} else if (entry.name !== "main.js" && !entry.name.endsWith(".map")) {
			assets.set(`${urlPrefix}${entry.name}`, Bun.file(join(dir, entry.name)))
		}
	}
	return assets
}

async function main() {
	const argv = cli({
		name: "seed-vault",
		flags: config.flags,
		strictFlags: true,
	})

	const cfg = config.create(argv.flags)

	const db = sqlite.open(cfg.dbPath)

	const isProd = process.env.NODE_ENV === "production"

	const svc = new apisvc.Service(db, cfg.relyingParty)

	// Pre-build asset lookup map at startup for O(1) serving.
	const assets = isProd ? collectStaticAssets(".", "/vault/") : new Map()

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
			"/vault": index,

			...createAPIRoutes(svc),
		},

		fetch(req) {
			const url = new URL(req.url)
			if (url.pathname === "/") {
				return Response.redirect(`${url.origin}/vault/`, 302)
			}
			if (url.pathname.startsWith("/vault/")) {
				const asset = assets.get(url.pathname)
				if (asset) {
					return new Response(asset, {
						headers: { "Content-Type": asset.type },
					})
				}
				// SPA fallback for client-side routes.
				return new Response(Bun.file("frontend/index.html"), {
					headers: { "Content-Type": "text/html;charset=utf-8" },
				})
			}
			return new Response("Not Found", { status: 404 })
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
}

if (import.meta.main) {
	main()
}

export function createAPIRoutes(svc: apisvc.Service): Bun.Serve.Routes<undefined, string> {
	return {
		"/vault/api/pre-login": {
			POST: async (req) => {
				const body = await req.json()
				const ctx = getRequestContext(req)
				const result = await svc.preLogin(body, ctx)
				return handleResponse(result, ctx)
			},
		},
		"/vault/api/register/start": {
			POST: async (req) => {
				const body = await req.json()
				const ctx = getRequestContext(req)
				const result = await svc.registerStart(body, ctx)
				return handleResponse(result, ctx)
			},
		},
		"/vault/api/register/poll": {
			POST: async (req) => {
				const body = await req.json()
				const ctx = getRequestContext(req)
				const result = await svc.registerPoll(body, ctx)
				return handleResponse(result, ctx)
			},
		},
		"/vault/api/register/verify-link": {
			POST: async (req) => {
				const body = await req.json()
				const ctx = getRequestContext(req)
				const result = await svc.registerVerifyLink(body, ctx)
				return handleResponse(result, ctx)
			},
		},
		"/vault/api/register/complete": {
			POST: async (req) => {
				const body = await req.json()
				const ctx = getRequestContext(req)
				const result = await svc.registerComplete(body, ctx)
				return handleResponse(result, ctx)
			},
		},
		"/vault/api/register/complete-passkey": {
			POST: async (req) => {
				const body = await req.json()
				const ctx = getRequestContext(req)
				const result = await svc.registerCompletePasskey(body, ctx)
				return handleResponse(result, ctx)
			},
		},
		"/vault/api/add-password": {
			POST: async (req) => {
				const body = await req.json()
				const ctx = getRequestContext(req)
				const result = await svc.addPassword(body, ctx)
				return handleResponse(result, ctx)
			},
		},
		"/vault/api/change-password": {
			POST: async (req) => {
				const body = await req.json()
				const ctx = getRequestContext(req)
				const result = await svc.changePassword(body, ctx)
				return handleResponse(result, ctx)
			},
		},
		"/vault/api/login": {
			POST: async (req) => {
				const body = await req.json()
				const ctx = getRequestContext(req)
				const result = await svc.login(body, ctx)
				return handleResponse(result, ctx)
			},
		},
		"/vault/api/vault": {
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
		"/vault/api/logout": {
			POST: async (req) => {
				const ctx = getRequestContext(req)
				const result = await svc.logout(ctx)
				return handleResponse(result, ctx)
			},
		},
		"/vault/api/session": {
			GET: async (req) => {
				const ctx = getRequestContext(req)
				const result = await svc.getSession(ctx)
				return handleResponse(result, ctx)
			},
		},

		// Email Change API.
		"/vault/api/change-email/start": {
			POST: async (req) => {
				const body = await req.json()
				const ctx = getRequestContext(req)
				const result = await svc.changeEmailStart(body, ctx)
				return handleResponse(result, ctx)
			},
		},
		"/vault/api/change-email/poll": {
			POST: async (req) => {
				const body = await req.json()
				const ctx = getRequestContext(req)
				const result = await svc.changeEmailPoll(body, ctx)
				return handleResponse(result, ctx)
			},
		},
		"/vault/api/change-email/verify-link": {
			POST: async (req) => {
				const body = await req.json()
				const ctx = getRequestContext(req)
				const result = await svc.changeEmailVerifyLink(body, ctx)
				return handleResponse(result, ctx)
			},
		},

		// WebAuthn API.
		"/vault/api/webauthn/register/start": {
			POST: async (req) => {
				const ctx = getRequestContext(req)
				const result = await svc.webAuthnRegisterStart(ctx)
				return handleResponse(result, ctx)
			},
		},
		"/vault/api/webauthn/register/complete": {
			POST: async (req) => {
				const body = await req.json()
				const ctx = getRequestContext(req)
				const result = await svc.webAuthnRegisterComplete(body, ctx)
				return handleResponse(result, ctx)
			},
		},
		"/vault/api/webauthn/login/start": {
			POST: async (req) => {
				const body = await req.json()
				const ctx = getRequestContext(req)
				const result = await svc.webAuthnLoginStart(body, ctx)
				return handleResponse(result, ctx)
			},
		},
		"/vault/api/webauthn/login/complete": {
			POST: async (req) => {
				const body = await req.json()
				const ctx = getRequestContext(req)
				const result = await svc.webAuthnLoginComplete(body, ctx)
				return handleResponse(result, ctx)
			},
		},
		"/vault/api/webauthn/vault": {
			POST: async (req) => {
				const body = await req.json()
				const ctx = getRequestContext(req)
				const result = await svc.webAuthnVaultStore(body, ctx)
				return handleResponse(result, ctx)
			},
		},
	}
}

function jsonResponse(data: unknown, status = 200): Response {
	return Response.json(data, { status })
}

function jsonResponseWithCookie(data: unknown, cookie: string, status = 200): Response {
	return Response.json(data, {
		status,
		headers: {
			"Content-Type": "application/json",
			"Set-Cookie": cookie,
		},
	})
}

// Helper to handle response and set/clear cookies based on context.
function handleResponse(data: unknown, ctx: api.ServerContext, status = 200): Response {
	if (ctx.sessionCookie !== undefined) {
		if (ctx.sessionCookie === null) {
			return jsonResponseWithCookie(data, session.clearCookie(), status)
		}
		return jsonResponseWithCookie(data, ctx.sessionCookie, status)
	}
	return jsonResponse(data, status)
}

function getRequestContext(req: BunRequest): api.ServerContext {
	const sessionId = req.cookies.get(session.SESSION_COOKIE_NAME) || null
	return { sessionId }
}

async function handleError(error: unknown): Promise<Response> {
	if ((error as apisvc.APIError).statusCode) {
		const apiError = error as apisvc.APIError
		return Response.json({ error: apiError.message }, { status: apiError.statusCode })
	}
	console.error("Unexpected error:", error)
	return Response.json({ error: "Internal server error" }, { status: 500 })
}
