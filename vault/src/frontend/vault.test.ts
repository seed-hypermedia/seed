import { describe, expect, test } from "bun:test"
import * as dagCBOR from "@ipld/dag-cbor"
import * as blobs from "./blobs"
import * as vaultData from "./vault"

function makeProfile(kp: blobs.KeyPair, name: string): blobs.Profile {
	const encoded = blobs.createProfile(kp, { name }, Date.now())
	return encoded.decoded
}

function makeAccount(name: string): vaultData.Account {
	const kp = blobs.generateKeyPair()
	return {
		seed: kp.privateKey,
		profile: makeProfile(kp, name),
		createdAt: Date.now(),
	}
}

describe("vault-data", () => {
	test("empty vault round-trip", async () => {
		const vault = vaultData.emptyVault()
		const compressed = await vaultData.serializeVault(vault)
		const restored = await vaultData.deserializeVault(compressed)

		expect(restored.version).toBe(1)
		expect(restored.accounts).toEqual([])
	})

	test("vault with one account round-trip", async () => {
		const vault: vaultData.VaultData = {
			version: 1,
			accounts: [makeAccount("Alice")],
			delegations: [],
		}

		const compressed = await vaultData.serializeVault(vault)
		const restored = await vaultData.deserializeVault(compressed)

		expect(restored.version).toBe(1)
		expect(restored.accounts).toHaveLength(1)
		expect(restored.accounts[0]!.createdAt).toBe(vault.accounts[0]!.createdAt)
		expect(new Uint8Array(restored.accounts[0]!.seed)).toEqual(new Uint8Array(vault.accounts[0]!.seed))
		expect(restored.accounts[0]!.profile.name).toBe("Alice")
	})

	test("vault with multiple accounts round-trip", async () => {
		const vault: vaultData.VaultData = {
			version: 1,
			accounts: [makeAccount("Alice"), makeAccount("Bob"), makeAccount("Carol")],
			delegations: [],
		}

		const compressed = await vaultData.serializeVault(vault)
		const restored = await vaultData.deserializeVault(compressed)

		expect(restored.accounts).toHaveLength(3)
		for (let i = 0; i < vault.accounts.length; i++) {
			expect(restored.accounts[i]!.profile.name).toBe(vault.accounts[i]!.profile.name)
			expect(new Uint8Array(restored.accounts[i]!.seed)).toEqual(new Uint8Array(vault.accounts[i]!.seed))
			expect(restored.accounts[i]!.createdAt).toBe(vault.accounts[i]!.createdAt)
		}
	})

	test("profile blob Uint8Array fields survive round-trip", async () => {
		const account = makeAccount("Test")
		const vault: vaultData.VaultData = { version: 1, accounts: [account], delegations: [] }

		const compressed = await vaultData.serializeVault(vault)
		const restored = await vaultData.deserializeVault(compressed)

		const original = account.profile
		const round = restored.accounts[0]!.profile

		expect(new Uint8Array(round.signer)).toEqual(new Uint8Array(original.signer))
		expect(new Uint8Array(round.sig)).toEqual(new Uint8Array(original.sig))
		expect(round.type).toBe("Profile")
		expect(round.ts).toBe(original.ts)
	})

	test("compression reduces size for larger data", async () => {
		const accounts = Array.from({ length: 20 }, (_, i) => makeAccount(`User${i}`))
		const vault: vaultData.VaultData = { version: 1, accounts, delegations: [] }

		const cbor = dagCBOR.encode(vault)
		const compressed = await vaultData.serializeVault(vault)

		expect(compressed.length).toBeLessThan(cbor.length)
	})
})
