import { describe, expect, test } from "bun:test"
import * as dagCBOR from "@ipld/dag-cbor"
import * as blobs from "@shm/shared/blobs"
import * as vault from "./vault"

function makeProfile(kp: blobs.KeyPair, name: string): blobs.Profile {
	const encoded = blobs.createProfile(kp, { name }, Date.now())
	return encoded.decoded
}

function makeAccount(name: string): vault.Account {
	const kp = blobs.generateKeyPair()
	return {
		seed: kp.privateKey,
		profile: makeProfile(kp, name),
		createdAt: Date.now(),
	}
}

describe("vault-data", () => {
	test("empty vault round-trip", async () => {
		const v = vault.createEmpty()
		const compressed = await vault.serialize(v)
		const restored = await vault.deserialize(compressed)

		expect(restored.version).toBe(1)
		expect(restored.accounts).toEqual([])
	})

	test("vault with one account round-trip", async () => {
		const v: vault.State = {
			version: 1,
			accounts: [makeAccount("Alice")],
			delegations: [],
		}

		const compressed = await vault.serialize(v)
		const restored = await vault.deserialize(compressed)

		expect(restored.version).toBe(1)
		expect(restored.accounts).toHaveLength(1)
		expect(restored.accounts[0]!.createdAt).toBe(v.accounts[0]!.createdAt)
		expect(new Uint8Array(restored.accounts[0]!.seed)).toEqual(new Uint8Array(v.accounts[0]!.seed))
		expect(restored.accounts[0]!.profile.name).toBe("Alice")
	})

	test("vault with multiple accounts round-trip", async () => {
		const v: vault.State = {
			version: 1,
			accounts: [makeAccount("Alice"), makeAccount("Bob"), makeAccount("Carol")],
			delegations: [],
		}

		const compressed = await vault.serialize(v)
		const restored = await vault.deserialize(compressed)

		expect(restored.accounts).toHaveLength(3)
		for (let i = 0; i < v.accounts.length; i++) {
			expect(restored.accounts[i]!.profile.name).toBe(v.accounts[i]!.profile.name)
			expect(new Uint8Array(restored.accounts[i]!.seed)).toEqual(new Uint8Array(v.accounts[i]!.seed))
			expect(restored.accounts[i]!.createdAt).toBe(v.accounts[i]!.createdAt)
		}
	})

	test("profile blob Uint8Array fields survive round-trip", async () => {
		const account = makeAccount("Test")
		const v: vault.State = { version: 1, accounts: [account], delegations: [] }

		const compressed = await vault.serialize(v)
		const restored = await vault.deserialize(compressed)

		const original = account.profile
		const round = restored.accounts[0]!.profile

		expect(new Uint8Array(round.signer)).toEqual(new Uint8Array(original.signer))
		expect(new Uint8Array(round.sig)).toEqual(new Uint8Array(original.sig))
		expect(round.type).toBe("Profile")
		expect(round.ts).toBe(original.ts)
	})

	test("compression reduces size for larger data", async () => {
		const accounts = Array.from({ length: 20 }, (_, i) => makeAccount(`User${i}`))
		const v: vault.State = { version: 1, accounts, delegations: [] }

		const cbor = dagCBOR.encode(v)
		const compressed = await vault.serialize(v)

		expect(compressed.length).toBeLessThan(cbor.length)
	})
})
