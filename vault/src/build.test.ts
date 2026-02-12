/**
 * Verifies the production build works end-to-end:
 * bundles successfully and the output can import external deps like mjml.
 */

import { afterAll, describe, expect, test } from "bun:test"
import { existsSync, rmSync, symlinkSync } from "node:fs"
import { request } from "node:http"
import { resolve } from "node:path"

const ROOT = resolve(import.meta.dir, "..")
const DIST = resolve(ROOT, "dist")
const TEST_DB = "/tmp/vault-build-test.sqlite"
const PORT = 13579

/** HTTP helper that bypasses happy-dom's CORS-enforcing fetch. */
function http(method: string, path: string, body?: string): Promise<{ status: number; body: string }> {
	return new Promise((resolve, reject) => {
		const req = request(
			{
				hostname: "127.0.0.1",
				port: PORT,
				path,
				method,
				headers: body ? { "Content-Type": "application/json" } : undefined,
			},
			(res) => {
				let data = ""
				res.on("data", (chunk) => {
					data += chunk
				})
				res.on("end", () => resolve({ status: res.statusCode ?? 0, body: data }))
			},
		)
		req.on("error", reject)
		if (body) req.write(body)
		req.end()
	})
}

afterAll(() => {
	rmSync(TEST_DB, { force: true })
	rmSync(`${TEST_DB}-shm`, { force: true })
	rmSync(`${TEST_DB}-wal`, { force: true })
	rmSync(`${DIST}/node_modules`, { force: true })
})

describe("production build", () => {
	test("bun run build succeeds", async () => {
		const proc = Bun.spawnSync(["bun", "run", "build"], {
			cwd: ROOT,
			env: { ...process.env, NODE_ENV: "production" },
		})
		expect(proc.exitCode).toBe(0)
		expect(existsSync(`${DIST}/main.js`)).toBe(true)
	})

	test(
		"bundled server starts and handles a request",
		async () => {
			// Symlink node_modules so external imports (mjml) resolve at runtime.
			const nmLink = `${DIST}/node_modules`
			if (!existsSync(nmLink)) {
				symlinkSync(`${ROOT}/node_modules`, nmLink)
			}

			// Run from dist/ (same as Docker WORKDIR /app) with production mode.
			const server = Bun.spawn(
				[
					"bun",
					"main.js",
					"--rp-id",
					"localhost",
					"--rp-origin",
					`http://localhost:${PORT}`,
					"--server-port",
					String(PORT),
					"--db-path",
					TEST_DB,
				],
				{
					cwd: DIST,
					stdout: "pipe",
					stderr: "pipe",
					env: {
						...process.env,
						NODE_ENV: "production",
						// Don't use real SMTP in tests.
						SEED_VAULT_SMTP_HOST: "",
					},
				},
			)

			try {
				// Wait for server to be ready.
				let ready = false
				for (let i = 0; i < 30; i++) {
					try {
						const res = await http("GET", "/vault/api/session")
						if (res.status === 200) {
							ready = true
							break
						}
					} catch {
						// Not ready yet.
					}
					await new Promise((r) => setTimeout(r, 200))
				}
				expect(ready).toBe(true)

				// Trigger registration which exercises MJML email rendering.
				const res = await http("POST", "/vault/api/register/start", JSON.stringify({ email: "buildtest@example.com" }))
				expect(res.status).toBe(200)
				const data = JSON.parse(res.body) as { challengeId: string }
				expect(data.challengeId).toBeDefined()
			} finally {
				server.kill()
				await server.exited
			}
		},
		{ timeout: 30_000 },
	)
})
