import { describe, expect, test } from "bun:test"
import * as sqlite from "./sqlite.ts"

describe("sqlite", () => {
	test("getOrCreateHmacSecret", () => {
		const db = sqlite.open(":memory:")

		// First call should generate a secret
		const secret1 = sqlite.getOrCreateHmacSecret(db)
		expect(secret1).toBeInstanceOf(Uint8Array)
		expect(secret1.length).toBe(32)

		// Second call should return the same secret
		const secret2 = sqlite.getOrCreateHmacSecret(db)
		expect(secret2).toEqual(secret1)

		// Verify it's stored in the DB
		const row = db.query("SELECT value FROM server_config WHERE key = 'hmac_secret'").get() as { value: Uint8Array }
		expect(row.value).toEqual(secret1)
	})
})
