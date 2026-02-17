import { describe, expect, test } from "bun:test"
import { base58btc } from "multiformats/bases/base58"
import * as blobs from "./blobs"

describe("key pair", () => {
	test("generates valid Ed25519 key pair", () => {
		const kp = blobs.generateKeyPair()
		expect(kp.privateKey.length).toBe(32)
		expect(kp.publicKey.length).toBe(32)
		// Principal = 2 bytes multicodec prefix + 32 bytes public key.
		expect(kp.principal.length).toBe(34)
		expect(kp.principal[0]).toBe(0xed)
		expect(kp.principal[1]).toBe(0x01)
	})

	test("keyPairFromPrivateKey restores same principal", () => {
		const original = blobs.generateKeyPair()
		const restored = blobs.keyPairFromPrivateKey(original.privateKey)
		expect(blobs.principalEqual(original.principal, restored.principal)).toBe(true)
	})
})

describe("principal encoding", () => {
	test("string round-trip preserves identity", () => {
		const kp = blobs.generateKeyPair()
		const str = blobs.principalToString(kp.principal)
		// Base58btc multibase strings start with 'z'.
		expect(str.startsWith("z")).toBe(true)
		const decoded = blobs.principalFromString(str)
		expect(blobs.principalEqual(kp.principal, decoded)).toBe(true)
	})

	test("different keys produce different strings", () => {
		const a = blobs.generateKeyPair()
		const b = blobs.generateKeyPair()
		expect(blobs.principalToString(a.principal)).not.toBe(blobs.principalToString(b.principal))
	})

	test("principalEqual detects different keys", () => {
		const a = blobs.generateKeyPair()
		const b = blobs.generateKeyPair()
		expect(blobs.principalEqual(a.principal, b.principal)).toBe(false)
	})

	test("rejects principal with invalid multicodec prefix", () => {
		const invalid = new Uint8Array([0x00, 0x01, ...new Uint8Array(32)])
		const encoded = base58btc.encode(invalid)
		expect(() => blobs.principalFromString(encoded)).toThrow("Invalid principal multicodec")
	})

	test("rejects principal with invalid length", () => {
		const tooShort = new Uint8Array([0xed, 0x01, ...new Uint8Array(16)])
		const encoded = base58btc.encode(tooShort)
		expect(() => blobs.principalFromString(encoded)).toThrow("Invalid principal length")
	})
})

describe("profile blob", () => {
	test("create, sign, and verify round-trip", () => {
		const kp = blobs.generateKeyPair()
		const ts = Date.now() as blobs.Timestamp
		const eb = blobs.createProfile(kp, { name: "Alice" }, ts)

		expect(eb.decoded.type).toBe("Profile")
		expect(eb.decoded.name).toBe("Alice")
		expect(eb.decoded.ts).toBe(ts)
		expect(eb.data.length).toBeGreaterThan(0)
		expect(eb.cid).toBeDefined()
		expect(blobs.verify(eb.decoded)).toBe(true)
	})

	test("profile with all fields", () => {
		const account = blobs.generateKeyPair()
		const agent = blobs.generateKeyPair()
		const ts = Date.now() as blobs.Timestamp
		const eb = blobs.createProfile(
			agent,
			{
				name: "Alice",
				avatar: "ipfs://QmTest",
				description: "A test profile.",
				account: account.principal,
			},
			ts,
		)

		expect(eb.decoded.name).toBe("Alice")
		expect(eb.decoded.avatar).toBe("ipfs://QmTest")
		expect(eb.decoded.description).toBe("A test profile.")
		expect(eb.decoded.account).toEqual(account.principal)
		expect(blobs.verify(eb.decoded)).toBe(true)
	})

	test("account equal to signer is omitted", () => {
		const kp = blobs.generateKeyPair()
		const ts = Date.now() as blobs.Timestamp
		const eb = blobs.createProfile(kp, { name: "Self", account: kp.principal }, ts)

		expect(eb.decoded.account).toBeUndefined()
		expect(blobs.verify(eb.decoded)).toBe(true)
	})

	test("alias profile has no name or description", () => {
		const kp = blobs.generateKeyPair()
		const alias = blobs.generateKeyPair()
		const ts = Date.now() as blobs.Timestamp
		const eb = blobs.createProfileAlias(kp, alias.principal, ts)

		expect(eb.decoded.type).toBe("Profile")
		expect(eb.decoded.alias).toEqual(alias.principal)
		expect(eb.decoded.name).toBeUndefined()
		expect(eb.decoded.description).toBeUndefined()
		expect(blobs.verify(eb.decoded)).toBe(true)
	})

	test("deterministic encoding produces same CID", () => {
		const kp = blobs.keyPairFromPrivateKey(new Uint8Array(32).fill(42))
		const ts = 1700000000000 as blobs.Timestamp
		const eb1 = blobs.createProfile(kp, { name: "Test" }, ts)
		const eb2 = blobs.createProfile(kp, { name: "Test" }, ts)

		expect(eb1.cid.toString()).toBe(eb2.cid.toString())
		expect(eb1.data).toEqual(eb2.data)
	})
})

describe("capability blob", () => {
	test("create, sign, and verify", () => {
		const issuer = blobs.generateKeyPair()
		const delegate = blobs.generateKeyPair()
		const ts = Date.now() as blobs.Timestamp
		const eb = blobs.createCapability(issuer, delegate.principal, "WRITER", ts)

		expect(eb.decoded.type).toBe("Capability")
		expect(eb.decoded.delegate).toEqual(delegate.principal)
		expect(eb.decoded.role).toBe("WRITER")
		expect(blobs.verify(eb.decoded)).toBe(true)
	})

	test("capability with label and path", () => {
		const issuer = blobs.generateKeyPair()
		const delegate = blobs.generateKeyPair()
		const ts = Date.now() as blobs.Timestamp
		const eb = blobs.createCapability(issuer, delegate.principal, "AGENT", ts, {
			path: "/docs",
			label: "My Device",
		})

		expect(eb.decoded.path).toBe("/docs")
		expect(eb.decoded.label).toBe("My Device")
		expect(blobs.verify(eb.decoded)).toBe(true)
	})
})

describe("verification", () => {
	test("tampered name fails verification", () => {
		const kp = blobs.generateKeyPair()
		const ts = Date.now() as blobs.Timestamp
		const eb = blobs.createProfile(kp, { name: "Alice" }, ts)

		const tampered: blobs.Profile = { ...eb.decoded, name: "Bob" }
		expect(blobs.verify(tampered)).toBe(false)
	})

	test("tampered timestamp fails verification", () => {
		const kp = blobs.generateKeyPair()
		const ts = Date.now() as blobs.Timestamp
		const eb = blobs.createProfile(kp, { name: "Alice" }, ts)

		const tampered: blobs.Profile = { ...eb.decoded, ts: (ts + 1) as blobs.Timestamp }
		expect(blobs.verify(tampered)).toBe(false)
	})

	test("wrong signer fails verification", () => {
		const kp = blobs.generateKeyPair()
		const other = blobs.generateKeyPair()
		const ts = Date.now() as blobs.Timestamp
		const eb = blobs.createProfile(kp, { name: "Alice" }, ts)

		const tampered: blobs.Profile = { ...eb.decoded, signer: other.principal }
		expect(blobs.verify(tampered)).toBe(false)
	})
})
