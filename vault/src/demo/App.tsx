import * as dagCBOR from "@ipld/dag-cbor"
import { useEffect, useMemo, useState } from "react"
import * as base64 from "../frontend/base64"
import * as blobs from "../frontend/blobs"
import type { AuthResult } from "../sdk/hypermedia-auth"
import * as hmauth from "../sdk/hypermedia-auth"

const DEFAULT_DELEGATE_URL = "http://localhost:3000/vault/delegate"

function bytesToHex(bytes: Uint8Array): string {
	return Array.from(bytes)
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("")
}

function CapabilityField({ capability }: { capability: string }) {
	const decoded = useMemo(() => {
		try {
			const bytes = base64.decode(capability)
			return JSON.stringify(
				dagCBOR.decode(bytes),
				(_key, value) => {
					if (value instanceof Uint8Array) {
						if (value.length === 34 && value[0] === 0xed && value[1] === 0x01) {
							return blobs.principalToString(value)
						}
						return base64.encode(value)
					}
					return value
				},
				2,
			)
		} catch (err) {
			return `Failed to decode: ${err instanceof Error ? err.message : String(err)}`
		}
	}, [capability])

	return (
		<div className="field">
			<div className="field-label">Capability (decoded DAG-CBOR)</div>
			<pre className="field-value" id="val-capability" style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
				{decoded}
			</pre>
		</div>
	)
}

export default function App() {
	const [vaultUrl, setVaultUrl] = useState(DEFAULT_DELEGATE_URL)
	const [error, setError] = useState<string | null>(null)
	const [authResult, setAuthResult] = useState<AuthResult | null>(null)
	const [signResult, setSignResult] = useState<{
		message: string
		signature: string
	} | null>(null)

	// Load stored vault URL
	useEffect(() => {
		const storedUrl = localStorage.getItem("vault_url")
		if (storedUrl) {
			setVaultUrl(storedUrl)
		}
	}, [])

	// Update localStorage when vaultUrl changes
	useEffect(() => {
		localStorage.setItem("vault_url", vaultUrl)
	}, [vaultUrl])

	// Initialize: check callback or existing session
	useEffect(() => {
		async function init() {
			const currentVaultUrl = localStorage.getItem("vault_url") || DEFAULT_DELEGATE_URL
			try {
				// 1. Check for callback (delegation response)
				const result = await hmauth.handleCallback({
					vaultUrl: currentVaultUrl,
				})
				if (result) {
					// Persist profile info
					localStorage.setItem(
						"auth_result",
						JSON.stringify({
							accountPrincipal: result.accountPrincipal,
							capability: result.capability,
							profile: result.profile,
						}),
					)
					setAuthResult(result)
					// Clean URL
					window.history.replaceState({}, "", window.location.pathname)
					return
				}
			} catch (err) {
				setError(err instanceof Error ? err.message : String(err))
				return
			}

			// 2. Check for existing session in IndexedDB
			try {
				const session = await hmauth.getSession(currentVaultUrl)
				const savedResult = localStorage.getItem("auth_result")

				if (session && savedResult) {
					try {
						const parsed = JSON.parse(savedResult)
						setAuthResult({ ...parsed, session })
					} catch {
						// Bad localStorage data, ignore
					}
				}
			} catch (err) {
				console.error("Failed to restore session:", err)
			}
		}

		init()
	}, [])

	const handleSignIn = async () => {
		try {
			const authUrl = await hmauth.startAuth({ vaultUrl })
			window.location.href = authUrl
		} catch (err) {
			setError(`Failed to start auth: ${err instanceof Error ? err.message : String(err)}`)
		}
	}

	const handleSignOut = async () => {
		try {
			await hmauth.clearSession(vaultUrl)
			localStorage.removeItem("auth_result")
			setAuthResult(null)
			setSignResult(null)
		} catch (err) {
			setError(`Failed to sign out: ${err instanceof Error ? err.message : String(err)}`)
		}
	}

	const handleSignMessage = async () => {
		if (!authResult) return

		const msg = `Hello from Acme App! Time: ${new Date().toISOString()}`
		const data = new TextEncoder().encode(msg)
		try {
			const sig = await hmauth.signWithSession(authResult.session, data)
			setSignResult({
				message: msg,
				signature: bytesToHex(sig),
			})
		} catch (err) {
			setError(`Signing failed: ${err instanceof Error ? err.message : String(err)}`)
		}
	}

	return (
		<div className="container">
			<div className="site-header">
				<h1>Acme Collaboration App</h1>
				<p>Demo third-party site using Hypermedia identity</p>
			</div>

			{error && (
				<button type="button" id="error-banner" className="error-banner" onClick={() => setError(null)}>
					{error}
				</button>
			)}

			{!authResult ? (
				// Signed-out state
				<div id="state-signed-out">
					<div className="card">
						<div className="card-title">Sign in to continue</div>
						<div className="config-row">
							<input
								type="text"
								id="input-vault-url"
								placeholder="Vault URL"
								value={vaultUrl}
								onChange={(e) => setVaultUrl(e.target.value)}
							/>
						</div>
						<button type="button" className="btn btn-primary" id="btn-signin" onClick={handleSignIn}>
							<svg
								width="16"
								height="16"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="2"
								strokeLinecap="round"
								strokeLinejoin="round"
								aria-hidden="true"
							>
								<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
								<polyline points="10 17 15 12 10 7" />
								<line x1="15" y1="12" x2="3" y2="12" />
							</svg>
							Sign in with Hypermedia
						</button>
					</div>
				</div>
			) : (
				// Signed-in state
				<div id="state-signed-in">
					{/* Profile card */}
					<div className="card">
						<div className="profile-header">
							<div className="avatar" id="profile-avatar">
								{authResult.profile.name ? authResult.profile.name.charAt(0).toUpperCase() : "?"}
							</div>
							<div>
								<div className="profile-name" id="profile-name">
									{authResult.profile.name || "Anonymous"}
								</div>
								{authResult.profile.description && (
									<div className="profile-description" id="profile-description">
										{authResult.profile.description}
									</div>
								)}
								<div className="profile-principal" id="profile-principal">
									{`${authResult.accountPrincipal.slice(0, 20)}…${authResult.accountPrincipal.slice(-8)}`}
								</div>
							</div>
						</div>
						<span className="badge badge-success">
							<svg
								width="12"
								height="12"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="3"
								strokeLinecap="round"
								strokeLinejoin="round"
								aria-hidden="true"
							>
								<polyline points="20 6 9 17 4 12" />
							</svg>
							Delegated session active
						</span>
						<div className="actions">
							<button type="button" className="btn btn-danger btn-sm" id="btn-signout" onClick={handleSignOut}>
								Sign out
							</button>
						</div>
					</div>

					{/* Session details */}
					<div className="card">
						<div className="card-title">Session Details</div>
						<div className="field">
							<div className="field-label">Session Key (this site's key)</div>
							<div className="field-value" id="val-session-key">
								{authResult.session.principal}
							</div>
						</div>
						<CapabilityField capability={authResult.capability} />
					</div>

					{/* Signing demo */}
					<div className="card">
						<div className="card-title">Try Signing</div>
						<p
							style={{
								fontSize: "0.85rem",
								color: "var(--muted)",
								marginBottom: "0.75rem",
							}}
						>
							Sign arbitrary data with the session key stored in this browser. The private key is{" "}
							<strong>unextractable</strong> — it never leaves WebCrypto.
						</p>
						<button type="button" className="btn btn-outline btn-sm" id="btn-sign" onClick={handleSignMessage}>
							Sign a test message
						</button>
						{signResult && (
							<div id="sign-result" style={{ marginTop: "0.75rem" }}>
								<div className="field">
									<div className="field-label">Message</div>
									<div className="field-value" id="val-message">
										{signResult.message}
									</div>
								</div>
								<div className="field">
									<div className="field-label">Ed25519 Signature (hex)</div>
									<div className="field-value" id="val-signature">
										{signResult.signature}
									</div>
								</div>
							</div>
						)}
					</div>
				</div>
			)}
		</div>
	)
}
