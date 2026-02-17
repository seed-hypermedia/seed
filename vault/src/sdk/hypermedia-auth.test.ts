import { afterEach, describe, expect, test } from "bun:test"
import * as delegation from "@/frontend/delegation"
import * as SDK from "./hypermedia-auth"

const hasWebCryptoEd25519 = await (async () => {
	try {
		await crypto.subtle.generateKey("Ed25519" as unknown as AlgorithmIdentifier, false, ["sign", "verify"])
		return true
	} catch {
		return false
	}
})()

const cryptoTest = hasWebCryptoEd25519 ? test : test.skip

type IDBStoreMap = Map<string, Map<string, unknown>>

function createIndexedDBMock() {
	const databases = new Map<string, IDBStoreMap>()

	const makeRequest = <T>(executor: (resolve: (value: T) => void, reject: (error: Error) => void) => void) => {
		const req: {
			result?: T
			error?: Error
			onsuccess: null | (() => void)
			onerror: null | (() => void)
		} = {
			onsuccess: null,
			onerror: null,
		}
		queueMicrotask(() => {
			executor(
				(value) => {
					req.result = value
					req.onsuccess?.()
				},
				(error) => {
					req.error = error
					req.onerror?.()
				},
			)
		})
		return req
	}

	const indexedDBMock = {
		open(dbName: string) {
			let stores = databases.get(dbName)
			const req: {
				result?: unknown
				error?: Error
				onupgradeneeded: null | (() => void)
				onsuccess: null | (() => void)
				onerror: null | (() => void)
			} = {
				onupgradeneeded: null,
				onsuccess: null,
				onerror: null,
			}

			queueMicrotask(() => {
				const isNew = !stores
				if (!stores) {
					stores = new Map()
					databases.set(dbName, stores)
				}
				const db = {
					objectStoreNames: {
						contains(name: string) {
							return stores!.has(name)
						},
					},
					createObjectStore(name: string) {
						if (!stores!.has(name)) {
							stores!.set(name, new Map())
						}
					},
					transaction(name: string) {
						const store = stores!.get(name)
						if (!store) {
							throw new Error(`Object store does not exist: ${name}`)
						}
						return {
							objectStore() {
								return {
									get(key: string) {
										return makeRequest((resolve) => resolve(store.get(key)))
									},
									put(value: unknown, key: string) {
										return makeRequest<void>((resolve) => {
											store.set(key, value)
											resolve()
										})
									},
									delete(key: string) {
										return makeRequest<void>((resolve) => {
											store.delete(key)
											resolve()
										})
									},
								}
							},
						}
					},
				}
				req.result = db
				if (isNew) {
					req.onupgradeneeded?.()
				}
				req.onsuccess?.()
			})

			return req
		},
	}

	return indexedDBMock
}

describe("hypermedia auth protocol", () => {
	const originalLocation = window.location
	const originalIndexedDB = (globalThis as { indexedDB?: unknown }).indexedDB

	function setUrl(url: string) {
		Object.defineProperty(window, "location", {
			value: new URL(url),
			writable: true,
			configurable: true,
		})
	}

	afterEach(() => {
		;(globalThis as { indexedDB?: unknown }).indexedDB = originalIndexedDB
	})

	afterEach(() => {
		Object.defineProperty(window, "location", {
			value: originalLocation,
			writable: true,
			configurable: true,
		})
	})

	cryptoTest("startAuth produces a signed delegation request URL and stores session", async () => {
		;(globalThis as { indexedDB?: unknown }).indexedDB = createIndexedDBMock()
		setUrl("http://localhost:8081/callback")
		const vaultUrl = "http://localhost:3000/vault/delegate"
		const authUrl = await SDK.startAuth({ vaultUrl })
		const parsed = new URL(authUrl)

		expect(parsed.searchParams.get("client_id")).toBe("http://localhost:8081")
		expect(parsed.searchParams.get("redirect_uri")).toBe("http://localhost:8081/callback")
		expect(parsed.searchParams.get("session_key")).toBeString()
		expect(parsed.searchParams.get("state")).toBeString()
		expect(parsed.searchParams.get("ts")).toBeString()
		expect(parsed.searchParams.get("proof")).toBeString()

		const session = await SDK.getSession(vaultUrl)
		expect(session).not.toBeNull()
		const sessionKey = parsed.searchParams.get("session_key")
		if (!sessionKey) {
			throw new Error("missing session_key")
		}
		expect(session!.principal).toBe(sessionKey)
	})

	test("handleCallback returns null when callback params are absent", async () => {
		setUrl("http://localhost:8081/")
		const result = await SDK.handleCallback({ vaultUrl: "http://localhost:3000/vault/delegate" })
		expect(result).toBeNull()
	})

	cryptoTest("handleCallback rejects callbacks with mismatched state", async () => {
		;(globalThis as { indexedDB?: unknown }).indexedDB = createIndexedDBMock()
		setUrl("http://localhost:8081/callback")
		const vaultUrl = "http://localhost:3000/vault/delegate"
		await SDK.startAuth({ vaultUrl })
		setUrl("http://localhost:8081/callback?error=access_denied&state=WRONGSTATE")
		await expect(SDK.handleCallback({ vaultUrl })).rejects.toThrow("Invalid callback state")
	})

	cryptoTest("demo redirect URL should be accepted by vault delegation parser", async () => {
		;(globalThis as { indexedDB?: unknown }).indexedDB = createIndexedDBMock()
		setUrl("http://localhost:8081/callback")
		const vaultUrl = "http://localhost:3000/vault/delegate"
		const authUrl = await SDK.startAuth({ vaultUrl })
		const parsedAuthUrl = new URL(authUrl)

		const request = delegation.parseDelegationRequest(parsedAuthUrl)
		expect(request).not.toBeNull()
		await expect(delegation.verifyDelegationRequestProof(request!, parsedAuthUrl.origin)).resolves.toBeUndefined()
	})

	test("handleCallback requires state when callback has error", async () => {
		setUrl("http://localhost:8081/callback?error=access_denied")
		await expect(SDK.handleCallback({ vaultUrl: "http://localhost:3000/vault/delegate" })).rejects.toThrow(
			"Missing callback state",
		)
	})
})

describe("sdk key operations", () => {
	cryptoTest("generateSessionKey and principalDecode round-trip", async () => {
		const result = await SDK.generateSessionKey()
		expect(result.publicKeyRaw.length).toBe(32)
		const decodedPubKey = SDK.principalDecode(result.principal)
		expect(decodedPubKey).toEqual(result.publicKeyRaw)
	})

	cryptoTest("signWithSession signs data with stored key", async () => {
		const { keyPair, publicKeyRaw, principal } = await SDK.generateSessionKey()
		const session: SDK.StoredSession = {
			keyPair,
			publicKeyRaw,
			principal,
			vaultUrl: "http://localhost:3000/vault/delegate",
			createdAt: Date.now(),
		}
		const data = new TextEncoder().encode("test message")
		const signature = await SDK.signWithSession(session, data)
		const valid = await crypto.subtle.verify(
			"Ed25519" as unknown as AlgorithmIdentifier,
			keyPair.publicKey,
			signature as ArrayBufferView<ArrayBuffer>,
			data as ArrayBufferView<ArrayBuffer>,
		)
		expect(valid).toBe(true)
	})
})
