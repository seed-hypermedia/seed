import type { Database } from "bun:sqlite"
import * as webauthn from "@simplewebauthn/server"
import type * as config from "@/config"
import type * as email from "@/email"
import * as sess from "@/session"
import type * as api from "./api"

// ============================================================================
// Database Types (mirrors db module for local use)
// ============================================================================

interface User {
	id: string
	email: string
	encrypted_data: Uint8Array | null
	data_nonce: Uint8Array | null
	create_time: number
	version: number
}

interface Credential {
	id: string
	user_id: string
	type: "password" | "passkey"
	encrypted_dek: Uint8Array | null
	dek_nonce: Uint8Array | null
	metadata: string | null
	create_time: number
}

interface PasskeyMetadata {
	credentialId: string
	publicKey: string
	counter: number
	transports?: string[]
	backupEligible: boolean
	backupState: boolean
	/** Whether this credential supports PRF extension for key derivation. */
	prfEnabled: boolean
}

interface PasswordMetadata {
	authHash: string
}

interface Challenge {
	id: string
	user_id: string | null
	type: "webauthn" | "email"
	purpose: "registration" | "email_change" | null
	verifier: string
	email: string | null
	new_email: string | null
	verified: number
	expire_time: number
}

// ============================================================================
// Crypto utilities
// ============================================================================

// Hardcoded Argon2 parameters (Bitwarden defaults).
const DEFAULT_ARGON2_PARAMS = {
	memoryCost: 65536,
	timeCost: 3,
	parallelism: 4,
}

function base64urlEncode(bytes: Uint8Array): string {
	return bytes.toBase64({ alphabet: "base64url" })
}

function base64urlDecode(str: string): Uint8Array {
	return Uint8Array.fromBase64(str, { alphabet: "base64url" })
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) return false
	let diff = 0
	for (let i = 0; i < a.length; i++) {
		const aVal = a[i]
		const bVal = b[i]
		if (aVal === undefined || bVal === undefined) {
			throw new Error("Invalid array length")
		}
		diff |= aVal ^ bVal
	}
	return diff === 0
}

function sha256Hash(data: Uint8Array): Uint8Array {
	const hasher = new Bun.CryptoHasher("sha256")
	hasher.update(data)
	return new Uint8Array(hasher.digest())
}

// ============================================================================
// Custom Error for API errors
// ============================================================================

export class APIError extends Error {
	constructor(
		message: string,
		public statusCode: number,
	) {
		super(message)
		this.name = "APIError"
	}
}

// ============================================================================
// Server Implementation
// ============================================================================

const MAGIC_LINK_EXPIRY_MS = 2 * 60 * 1000 // 2 minutes (short-lived for security).
const CHALLENGE_EXPIRY_MS = 5 * 60 * 1000 // 5 minutes.

/**
 * API server implementation.
 */
export class Service implements api.ServerInterface {
	private db: Database
	private sessions: sess.Store
	private rp: config.RelyingParty
	private email: email.EmailSender

	constructor(db: Database, rp: config.RelyingParty, emailSender: email.EmailSender) {
		this.db = db
		this.sessions = new sess.Store(db)
		this.rp = rp
		this.email = emailSender
	}

	/**
	 * Remove all expired challenges from the database.
	 * Called at the start of challenge-related operations.
	 */
	private cleanupExpiredChallenges(): void {
		this.db.run(`DELETE FROM auth_challenges WHERE expire_time < ?`, [Date.now()])
	}

	// ==========================================================================
	// Auth Endpoints
	// ==========================================================================

	async preLogin(req: api.PreLoginRequest, _ctx: api.ServerContext): Promise<api.PreLoginResponse> {
		if (!req.email || typeof req.email !== "string") {
			throw new APIError("Email required", 400)
		}

		const user = this.db
			.query<Pick<User, "id">, [string]>(`SELECT id FROM users WHERE email = ?`)
			.get(req.email.toLowerCase())

		if (!user) {
			return { exists: false }
		}

		const passwordCredential = this.db
			.query<{ id: string }, [string, string]>(`SELECT id FROM credentials WHERE user_id = ? AND type = ?`)
			.get(user.id, "password")

		return {
			exists: true,
			hasPassword: passwordCredential !== null,
		}
	}

	async registerStart(req: api.RegisterStartRequest, _ctx: api.ServerContext): Promise<api.RegisterStartResponse> {
		if (!req.email || typeof req.email !== "string") {
			throw new APIError("Email required", 400)
		}

		this.cleanupExpiredChallenges()

		const normalizedEmail = req.email.toLowerCase()

		const existingUser = this.db
			.query<{ id: string }, [string]>(`SELECT id FROM users WHERE email = ?`)
			.get(normalizedEmail)

		if (existingUser) {
			const credential = this.db
				.query<{ id: string }, [string]>(`SELECT id FROM credentials WHERE user_id = ?`)
				.get(existingUser.id)

			if (credential) {
				throw new APIError("User already exists", 409)
			}
		}

		// Generate high-entropy token (256-bit) for the magic link.
		const tokenBytes = new Uint8Array(32)
		crypto.getRandomValues(tokenBytes)
		const token = base64urlEncode(tokenBytes)
		const tokenHash = base64urlEncode(sha256Hash(tokenBytes))
		const challengeId = sess.randomId()

		// Clean up any existing registration challenges for this email.
		this.db.run(`DELETE FROM auth_challenges WHERE email = ? AND type = 'email' AND purpose = 'registration'`, [
			normalizedEmail,
		])

		// Store the challenge with the hash of the token (not the token itself).
		this.db.run(
			`INSERT INTO auth_challenges (id, user_id, type, purpose, verifier, email, verified, expire_time) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			[challengeId, null, "email", "registration", tokenHash, normalizedEmail, 0, Date.now() + MAGIC_LINK_EXPIRY_MS],
		)

		// URL includes challengeId for efficient lookup and token for verification.
		const verifyUrl = `${this.rp.origin}/vault/verify/${challengeId}/${token}`
		await this.email.sendLoginLink(normalizedEmail, verifyUrl)

		return {
			message: "Verification link sent",
			challengeId,
		}
	}

	/**
	 * Poll endpoint for the original device to check if the magic link was clicked.
	 */
	async registerPoll(req: api.RegisterPollRequest, _ctx: api.ServerContext): Promise<api.RegisterPollResponse> {
		if (!req.challengeId) {
			throw new APIError("Challenge ID required", 400)
		}

		this.cleanupExpiredChallenges()

		const challenge = this.db
			.query<Challenge, [string, string]>(
				`SELECT * FROM auth_challenges WHERE id = ? AND type = 'email' AND purpose = 'registration' AND expire_time > ?`,
			)
			.get(req.challengeId, Date.now().toString())

		if (!challenge) {
			throw new APIError("Challenge expired or not found", 400)
		}

		if (challenge.verified) {
			this.db.run(`DELETE FROM auth_challenges WHERE id = ?`, [challenge.id])
			return { verified: true }
		}

		return { verified: false }
	}

	/**
	 * Called when user clicks the magic link. Marks the challenge as verified.
	 */
	async registerVerifyLink(
		req: api.RegisterVerifyLinkRequest,
		_ctx: api.ServerContext,
	): Promise<api.RegisterVerifyLinkResponse> {
		if (!req.challengeId || !req.token) {
			throw new APIError("Challenge ID and token required", 400)
		}

		// Lookup by primary key for efficiency.
		const challenge = this.db
			.query<Challenge, [string, string]>(
				`SELECT * FROM auth_challenges WHERE id = ? AND type = 'email' AND purpose = 'registration' AND expire_time > ?`,
			)
			.get(req.challengeId, Date.now().toString())

		if (!challenge) {
			throw new APIError("Invalid or expired link", 400)
		}

		// Verify the token by comparing its hash with the stored verifier.
		const tokenBytes = base64urlDecode(req.token)
		const providedHash = sha256Hash(tokenBytes)
		const storedHash = base64urlDecode(challenge.verifier)

		if (!timingSafeEqual(providedHash, storedHash)) {
			throw new APIError("Invalid or expired link", 400)
		}

		if (!challenge.email) {
			throw new APIError("Invalid challenge", 400)
		}

		// Mark as verified so the polling device can proceed.
		this.db.run(`UPDATE auth_challenges SET verified = 1 WHERE id = ?`, [challenge.id])

		return {
			verified: true,
			email: challenge.email,
		}
	}

	async registerComplete(
		req: api.RegisterCompleteRequest,
		ctx: api.ServerContext,
	): Promise<api.RegisterCompleteResponse> {
		if (!req.email || !req.encryptedDEK || !req.authHash) {
			throw new APIError("Missing required fields", 400)
		}

		const normalizedEmail = req.email.toLowerCase()

		const existingUser = this.db
			.query<{ id: string }, [string]>(`SELECT id FROM users WHERE email = ?`)
			.get(normalizedEmail)

		let userId: string
		let isExistingUser = false

		if (existingUser) {
			const credential = this.db
				.query<{ id: string }, [string]>(`SELECT id FROM credentials WHERE user_id = ?`)
				.get(existingUser.id)

			if (credential) {
				throw new APIError("User already exists", 409)
			}
			userId = existingUser.id
			isExistingUser = true
		} else {
			userId = sess.randomId()
		}

		const now = Date.now()
		const credentialId = sess.randomId()

		const passwordMetadata: PasswordMetadata = {
			authHash: req.authHash,
		}

		if (!isExistingUser) {
			this.db.run(`INSERT INTO users (id, email, create_time) VALUES (?, ?, ?)`, [userId, normalizedEmail, now])
		}

		this.db.run(
			`INSERT INTO credentials (id, user_id, type, encrypted_dek, metadata, create_time) VALUES (?, ?, ?, ?, ?, ?)`,
			[credentialId, userId, "password", base64urlDecode(req.encryptedDEK), JSON.stringify(passwordMetadata), now],
		)

		const session = this.sessions.createSession(userId)
		ctx.sessionCookie = sess.createCookie(session)

		return { success: true, userId }
	}

	async registerCompletePasskey(
		req: api.RegisterCompletePasskeyRequest,
		ctx: api.ServerContext,
	): Promise<api.RegisterCompletePasskeyResponse> {
		if (!req.email) {
			throw new APIError("Missing required fields", 400)
		}

		const normalizedEmail = req.email.toLowerCase()

		const existingUser = this.db
			.query<{ id: string }, [string]>(`SELECT id FROM users WHERE email = ?`)
			.get(normalizedEmail)

		let userId: string

		if (existingUser) {
			const credential = this.db
				.query<{ id: string }, [string]>(`SELECT id FROM credentials WHERE user_id = ?`)
				.get(existingUser.id)

			if (credential) {
				throw new APIError("User already exists", 409)
			}
			userId = existingUser.id
		} else {
			const now = Date.now()
			userId = sess.randomId()
			this.db.run(`INSERT INTO users (id, email, create_time) VALUES (?, ?, ?)`, [userId, normalizedEmail, now])
		}

		const session = this.sessions.createSession(userId)
		ctx.sessionCookie = sess.createCookie(session)

		return { success: true, userId }
	}

	async addPassword(req: api.AddPasswordRequest, ctx: api.ServerContext): Promise<api.AddPasswordResponse> {
		if (!ctx.sessionId) {
			throw new APIError("Not authenticated", 401)
		}

		const session = this.sessions.getSession(ctx.sessionId)
		if (!session) {
			throw new APIError("Session expired", 401)
		}

		if (!req.encryptedDEK || !req.authHash) {
			throw new APIError("Missing required fields", 400)
		}

		const user = this.db.query<User, [string]>(`SELECT * FROM users WHERE id = ?`).get(session.user_id)

		if (!user) {
			throw new APIError("User not found", 404)
		}

		const existingPasswordCredential = this.db
			.query<{ id: string }, [string, string]>(`SELECT id FROM credentials WHERE user_id = ? AND type = ?`)
			.get(session.user_id, "password")

		if (existingPasswordCredential) {
			throw new APIError("Password already set", 409)
		}

		const now = Date.now()
		const credentialId = sess.randomId()

		const passwordMetadata: PasswordMetadata = {
			authHash: req.authHash,
		}

		this.db.run(
			`INSERT INTO credentials (id, user_id, type, encrypted_dek, metadata, create_time) VALUES (?, ?, ?, ?, ?, ?)`,
			[
				credentialId,
				session.user_id,
				"password",
				base64urlDecode(req.encryptedDEK),
				JSON.stringify(passwordMetadata),
				now,
			],
		)

		return { success: true }
	}

	async changePassword(req: api.ChangePasswordRequest, ctx: api.ServerContext): Promise<api.ChangePasswordResponse> {
		if (!ctx.sessionId) {
			throw new APIError("Not authenticated", 401)
		}

		const session = this.sessions.getSession(ctx.sessionId)
		if (!session) {
			throw new APIError("Session expired", 401)
		}

		if (!req.encryptedDEK || !req.authHash) {
			throw new APIError("Missing required fields", 400)
		}

		const user = this.db.query<User, [string]>(`SELECT * FROM users WHERE id = ?`).get(session.user_id)

		if (!user) {
			throw new APIError("User not found", 404)
		}

		const existingPasswordCredential = this.db
			.query<{ id: string }, [string, string]>(`SELECT id FROM credentials WHERE user_id = ? AND type = ?`)
			.get(session.user_id, "password")

		const passwordMetadata: PasswordMetadata = {
			authHash: req.authHash,
		}

		if (existingPasswordCredential) {
			// Update existing credential.
			this.db.run(`UPDATE credentials SET encrypted_dek = ?, metadata = ? WHERE id = ?`, [
				base64urlDecode(req.encryptedDEK),
				JSON.stringify(passwordMetadata),
				existingPasswordCredential.id,
			])
		} else {
			// Create new credential.
			const now = Date.now()
			const credentialId = sess.randomId()

			this.db.run(
				`INSERT INTO credentials (id, user_id, type, encrypted_dek, metadata, create_time) VALUES (?, ?, ?, ?, ?, ?)`,
				[
					credentialId,
					session.user_id,
					"password",
					base64urlDecode(req.encryptedDEK),
					JSON.stringify(passwordMetadata),
					now,
				],
			)
		}

		return { success: true }
	}

	async login(req: api.LoginRequest, ctx: api.ServerContext): Promise<api.LoginResponse> {
		if (!req.email || !req.authHash) {
			throw new APIError("Email and authHash required", 400)
		}

		const normalizedEmail = req.email.toLowerCase()

		const user = this.db.query<User, [string]>(`SELECT * FROM users WHERE email = ?`).get(normalizedEmail)

		if (!user) {
			await new Promise((r) => setTimeout(r, 100))
			throw new APIError("Invalid credentials", 401)
		}

		const passwordCredential = this.db
			.query<Credential, [string, string]>(`SELECT * FROM credentials WHERE user_id = ? AND type = ?`)
			.get(user.id, "password")

		if (!passwordCredential || !passwordCredential.metadata) {
			throw new APIError("Invalid credentials", 401)
		}

		const passwordMetadata = JSON.parse(passwordCredential.metadata) as PasswordMetadata
		const providedHash = base64urlDecode(req.authHash)
		const storedHash = base64urlDecode(passwordMetadata.authHash)

		if (!timingSafeEqual(providedHash, storedHash)) {
			throw new APIError("Invalid credentials", 401)
		}

		const session = this.sessions.createSession(user.id)
		ctx.sessionCookie = sess.createCookie(session)

		if (!passwordCredential.encrypted_dek) {
			throw new APIError("Invalid credential data", 500)
		}

		return {
			success: true,
			userId: user.id,
			vault: {
				encryptedDEK: base64urlEncode(new Uint8Array(passwordCredential.encrypted_dek)),
			},
		}
	}

	async getVault(ctx: api.ServerContext): Promise<api.GetVaultResponse> {
		if (!ctx.sessionId) {
			throw new APIError("Not authenticated", 401)
		}

		const session = this.sessions.getSession(ctx.sessionId)
		if (!session) {
			throw new APIError("Session expired", 401)
		}

		const user = this.db
			.query<Pick<User, "encrypted_data" | "version">, [string]>(
				`SELECT encrypted_data, version FROM users WHERE id = ?`,
			)
			.get(session.user_id)

		if (!user) {
			throw new APIError("User not found", 404)
		}

		const response: api.GetVaultResponse = {
			version: user.version,
		}

		if (user.encrypted_data) {
			response.encryptedData = base64urlEncode(new Uint8Array(user.encrypted_data))
		}

		return response
	}

	async saveVaultData(req: api.SaveVaultDataRequest, ctx: api.ServerContext): Promise<api.SaveVaultDataResponse> {
		if (!ctx.sessionId) {
			throw new APIError("Not authenticated", 401)
		}

		const session = this.sessions.getSession(ctx.sessionId)
		if (!session) {
			throw new APIError("Session expired", 401)
		}

		if (!req.encryptedData) {
			throw new APIError("Missing required fields", 400)
		}

		const result = this.db.run(
			`UPDATE users SET encrypted_data = ?, version = version + 1 WHERE id = ? AND version = ?`,
			[base64urlDecode(req.encryptedData), session.user_id, req.version],
		)

		if (result.changes === 0) {
			throw new APIError("Vault has been modified by another session. Please reload.", 409)
		}

		return { success: true }
	}

	async logout(ctx: api.ServerContext): Promise<api.LogoutResponse> {
		if (ctx.sessionId) {
			this.sessions.deleteSession(ctx.sessionId)
		}
		ctx.sessionCookie = null

		return { success: true }
	}

	async getSession(ctx: api.ServerContext): Promise<api.GetSessionResponse> {
		if (!ctx.sessionId) {
			return { authenticated: false }
		}

		const session = this.sessions.getSession(ctx.sessionId)
		if (!session) {
			return { authenticated: false }
		}

		const user = this.db
			.query<Pick<User, "id" | "email">, [string]>(`SELECT id, email FROM users WHERE id = ?`)
			.get(session.user_id)

		if (!user) {
			return { authenticated: false }
		}

		const passwordCredential = this.db
			.query<{ id: string }, [string, string]>(`SELECT id FROM credentials WHERE user_id = ? AND type = ?`)
			.get(user.id, "password")

		return {
			authenticated: true,
			userId: user.id,
			email: user.email,
			hasPassword: passwordCredential !== null,
		}
	}

	// ==========================================================================
	// Email Change Endpoints
	// ==========================================================================

	/**
	 * Start email change process. Sends a magic link to the new email address.
	 * Requires authentication.
	 */
	async changeEmailStart(
		req: api.ChangeEmailStartRequest,
		ctx: api.ServerContext,
	): Promise<api.ChangeEmailStartResponse> {
		if (!ctx.sessionId) {
			throw new APIError("Not authenticated", 401)
		}

		const session = this.sessions.getSession(ctx.sessionId)
		if (!session) {
			throw new APIError("Session expired", 401)
		}

		this.cleanupExpiredChallenges()

		if (!req.newEmail || typeof req.newEmail !== "string") {
			throw new APIError("New email required", 400)
		}

		const normalizedNewEmail = req.newEmail.toLowerCase()

		// Check if new email is already in use.
		const existingUser = this.db
			.query<{ id: string }, [string]>(`SELECT id FROM users WHERE email = ?`)
			.get(normalizedNewEmail)

		if (existingUser) {
			throw new APIError("Email already in use", 409)
		}

		// Get current user email for reference in the challenge.
		const user = this.db.query<User, [string]>(`SELECT * FROM users WHERE id = ?`).get(session.user_id)

		if (!user) {
			throw new APIError("User not found", 404)
		}

		// Generate high-entropy token for the magic link.
		const tokenBytes = new Uint8Array(32)
		crypto.getRandomValues(tokenBytes)
		const token = base64urlEncode(tokenBytes)
		const tokenHash = base64urlEncode(sha256Hash(tokenBytes))
		const challengeId = sess.randomId()

		// Clean up any existing email change challenges for this user.
		this.db.run(`DELETE FROM auth_challenges WHERE user_id = ? AND type = 'email' AND purpose = 'email_change'`, [
			session.user_id,
		])

		// Store the challenge with hash of the token.
		this.db.run(
			`INSERT INTO auth_challenges (id, user_id, type, purpose, verifier, email, new_email, verified, expire_time) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				challengeId,
				session.user_id,
				"email",
				"email_change",
				tokenHash,
				user.email,
				normalizedNewEmail,
				0,
				Date.now() + MAGIC_LINK_EXPIRY_MS,
			],
		)

		// URL includes challengeId for efficient lookup and token for verification.
		const verifyUrl = `${this.rp.origin}/vault/email/change-verify/${challengeId}/${token}`
		await this.email.sendLoginLink(normalizedNewEmail, verifyUrl)

		return {
			message: "Verification link sent to new email",
			challengeId,
		}
	}

	/**
	 * Poll endpoint to check if email change magic link was clicked.
	 */
	async changeEmailPoll(req: api.ChangeEmailPollRequest, ctx: api.ServerContext): Promise<api.ChangeEmailPollResponse> {
		if (!ctx.sessionId) {
			throw new APIError("Not authenticated", 401)
		}

		const session = this.sessions.getSession(ctx.sessionId)
		if (!session) {
			throw new APIError("Session expired", 401)
		}

		this.cleanupExpiredChallenges()

		if (!req.challengeId) {
			throw new APIError("Challenge ID required", 400)
		}

		const challenge = this.db
			.query<Challenge, [string, string, string]>(
				`SELECT * FROM auth_challenges WHERE id = ? AND user_id = ? AND type = 'email' AND purpose = 'email_change' AND expire_time > ?`,
			)
			.get(req.challengeId, session.user_id, Date.now().toString())

		if (!challenge) {
			throw new APIError("Challenge expired or not found", 400)
		}

		if (challenge.verified && challenge.new_email) {
			// User clicked the magic link - update email and clean up.
			this.db.run(`UPDATE users SET email = ? WHERE id = ?`, [challenge.new_email, session.user_id])
			this.db.run(`DELETE FROM auth_challenges WHERE id = ?`, [challenge.id])

			return {
				verified: true,
				newEmail: challenge.new_email,
			}
		}

		return { verified: false }
	}

	/**
	 * Called when user clicks the email change magic link. Marks the challenge as verified.
	 */
	async changeEmailVerifyLink(
		req: api.ChangeEmailVerifyLinkRequest,
		_ctx: api.ServerContext,
	): Promise<api.ChangeEmailVerifyLinkResponse> {
		if (!req.challengeId || !req.token) {
			throw new APIError("Challenge ID and token required", 400)
		}

		// Lookup by primary key for efficiency.
		const challenge = this.db
			.query<Challenge, [string, string]>(
				`SELECT * FROM auth_challenges WHERE id = ? AND type = 'email' AND purpose = 'email_change' AND expire_time > ?`,
			)
			.get(req.challengeId, Date.now().toString())

		if (!challenge) {
			throw new APIError("Invalid or expired link", 400)
		}

		// Verify the token by comparing its hash with the stored verifier.
		const tokenBytes = base64urlDecode(req.token)
		const providedHash = sha256Hash(tokenBytes)
		const storedHash = base64urlDecode(challenge.verifier)

		if (!timingSafeEqual(providedHash, storedHash)) {
			throw new APIError("Invalid or expired link", 400)
		}

		if (!challenge.new_email) {
			throw new APIError("Invalid challenge", 400)
		}

		// Verify the new email is still available (race condition check).
		const existingUser = this.db
			.query<{ id: string }, [string, string]>(`SELECT id FROM users WHERE email = ? AND id != ?`)
			.get(challenge.new_email, challenge.user_id ?? "")

		if (existingUser) {
			this.db.run(`DELETE FROM auth_challenges WHERE id = ?`, [challenge.id])
			throw new APIError("Email already in use", 409)
		}

		// Mark as verified so the polling device can proceed.
		this.db.run(`UPDATE auth_challenges SET verified = 1 WHERE id = ?`, [challenge.id])

		return {
			verified: true,
			newEmail: challenge.new_email,
		}
	}

	// ==========================================================================
	// WebAuthn Endpoints
	// ==========================================================================

	async webAuthnRegisterStart(ctx: api.ServerContext): Promise<api.WebAuthnRegisterStartResponse> {
		if (!ctx.sessionId) {
			throw new APIError("Not authenticated", 401)
		}

		const session = this.sessions.getSession(ctx.sessionId)
		if (!session) {
			throw new APIError("Session expired", 401)
		}

		this.cleanupExpiredChallenges()

		const user = this.db.query<User, [string]>(`SELECT * FROM users WHERE id = ?`).get(session.user_id)

		if (!user) {
			throw new APIError("User not found", 404)
		}

		const existingPasskeys = this.db
			.query<Credential, [string, string]>(`SELECT * FROM credentials WHERE user_id = ? AND type = ?`)
			.all(session.user_id, "passkey")

		const excludeCredentials = existingPasskeys.map((p) => {
			if (!p.metadata) throw new Error("Passkey metadata is missing")
			const metadata = JSON.parse(p.metadata) as PasskeyMetadata
			return {
				id: metadata.credentialId,
				transports: metadata.transports as AuthenticatorTransport[],
			}
		})

		const options = await webauthn.generateRegistrationOptions({
			rpName: this.rp.name,
			rpID: this.rp.id,
			userID: new TextEncoder().encode(user.id) as Uint8Array<ArrayBuffer>,
			userName: user.email,
			attestationType: "none",
			excludeCredentials,
			authenticatorSelection: {
				residentKey: "preferred",
				userVerification: "preferred",
			},
			challenge: base64urlEncode(crypto.getRandomValues(new Uint8Array(32))),
		})

		const challengeId = sess.randomId()

		this.db.run(`DELETE FROM auth_challenges WHERE user_id = ? AND type = 'webauthn'`, [user.id])

		// Store challenge as string (already base64url from library).
		this.db.run(`INSERT INTO auth_challenges (id, user_id, type, verifier, expire_time) VALUES (?, ?, ?, ?, ?)`, [
			challengeId,
			user.id,
			"webauthn",
			options.challenge,
			Date.now() + CHALLENGE_EXPIRY_MS,
		])

		return options as api.WebAuthnRegisterStartResponse
	}

	async webAuthnRegisterComplete(
		req: api.WebAuthnRegisterCompleteRequest,
		ctx: api.ServerContext,
	): Promise<api.WebAuthnRegisterCompleteResponse> {
		if (!ctx.sessionId) {
			throw new APIError("Not authenticated", 401)
		}

		const session = this.sessions.getSession(ctx.sessionId)
		if (!session) {
			throw new APIError("Session expired", 401)
		}

		const challengeRecord = this.db
			.query<Challenge, [string, string]>(
				`SELECT * FROM auth_challenges WHERE user_id = ? AND type = 'webauthn' AND expire_time > ?`,
			)
			.get(session.user_id, Date.now().toString())

		if (!challengeRecord) {
			throw new APIError("No pending registration", 400)
		}

		try {
			const verification = await webauthn.verifyRegistrationResponse({
				response: req.response,
				expectedChallenge: challengeRecord.verifier,
				expectedOrigin: this.rp.origin,
				expectedRPID: this.rp.id,
			})

			if (!verification.verified || !verification.registrationInfo) {
				throw new APIError("Verification failed", 400)
			}

			const { credential, credentialBackedUp, credentialDeviceType } = verification.registrationInfo

			const backupEligible = credentialDeviceType === "multiDevice"
			const backupState = credentialBackedUp

			if (!backupState) {
				console.warn(`⚠️  Passkey for user ${session.user_id} is not backed up. Consider adding more passkeys.`)
			}

			const credentialIdStr =
				typeof credential.id === "string" ? credential.id : base64urlEncode(credential.id as unknown as Uint8Array)

			const metadata: PasskeyMetadata = {
				credentialId: credentialIdStr,
				publicKey: base64urlEncode(credential.publicKey as unknown as Uint8Array),
				counter: credential.counter,
				transports: req.response.response.transports,
				backupEligible,
				backupState,
				// PRF support is determined client-side based on clientExtensionResults.
				// Client signals PRF usage by successfully storing vault with PRF-derived key.
				prfEnabled: true,
			}

			const credentialDbId = sess.randomId()
			const now = Date.now()

			this.db.run(`INSERT INTO credentials (id, user_id, type, metadata, create_time) VALUES (?, ?, ?, ?, ?)`, [
				credentialDbId,
				session.user_id,
				"passkey",
				JSON.stringify(metadata),
				now,
			])

			this.db.run(`DELETE FROM auth_challenges WHERE id = ?`, [challengeRecord.id])

			return {
				success: true,
				credentialId: metadata.credentialId,
				backupEligible,
				backupState,
				prfEnabled: metadata.prfEnabled,
			}
		} catch (error) {
			console.error("WebAuthn registration error:", error)
			throw new APIError("Verification failed", 400)
		}
	}

	async webAuthnLoginStart(
		req: api.WebAuthnLoginStartRequest,
		_ctx: api.ServerContext,
	): Promise<api.WebAuthnLoginStartResponse> {
		if (!req.email) {
			throw new APIError("Email required", 400)
		}

		this.cleanupExpiredChallenges()

		const normalizedEmail = req.email.toLowerCase()

		const user = this.db.query<User, [string]>(`SELECT * FROM users WHERE email = ?`).get(normalizedEmail)

		if (!user) {
			const options = await webauthn.generateAuthenticationOptions({
				rpID: this.rp.id,
				allowCredentials: [],
				userVerification: "preferred",
			})
			return options as api.WebAuthnLoginStartResponse
		}

		const passkeys = this.db
			.query<Credential, [string, string]>(`SELECT * FROM credentials WHERE user_id = ? AND type = ?`)
			.all(user.id, "passkey")

		if (passkeys.length === 0) {
			throw new APIError("No passkeys registered", 400)
		}

		const allowCredentials = passkeys.map((p) => {
			if (!p.metadata) throw new Error("Passkey metadata is missing")
			const metadata = JSON.parse(p.metadata) as PasskeyMetadata
			const transports =
				metadata.transports && metadata.transports.length > 0
					? (metadata.transports as AuthenticatorTransport[])
					: (["internal", "hybrid"] as AuthenticatorTransport[])
			return {
				id: metadata.credentialId,
				transports,
			}
		})

		const options = await webauthn.generateAuthenticationOptions({
			rpID: this.rp.id,
			allowCredentials,
			userVerification: "preferred",
		})

		const challengeId = sess.randomId()

		this.db.run(`DELETE FROM auth_challenges WHERE user_id = ? AND type = 'webauthn'`, [user.id])

		// Store challenge as string (already base64url from library).
		this.db.run(
			`INSERT INTO auth_challenges (id, user_id, type, verifier, email, expire_time) VALUES (?, ?, ?, ?, ?, ?)`,
			[challengeId, user.id, "webauthn", options.challenge, normalizedEmail, Date.now() + CHALLENGE_EXPIRY_MS],
		)

		return {
			...options,
			userId: user.id,
		} as api.WebAuthnLoginStartResponse
	}

	async webAuthnLoginComplete(
		req: api.WebAuthnLoginCompleteRequest,
		ctx: api.ServerContext,
	): Promise<api.WebAuthnLoginCompleteResponse> {
		if (!req.email || !req.response) {
			throw new APIError("Email and response required", 400)
		}

		const normalizedEmail = req.email.toLowerCase()

		const user = this.db.query<User, [string]>(`SELECT * FROM users WHERE email = ?`).get(normalizedEmail)

		if (!user) {
			throw new APIError("Invalid credentials", 401)
		}

		const challengeRecord = this.db
			.query<Challenge, [string, string]>(
				`SELECT * FROM auth_challenges WHERE user_id = ? AND type = 'webauthn' AND expire_time > ?`,
			)
			.get(user.id, Date.now().toString())

		if (!challengeRecord) {
			throw new APIError("No pending authentication", 400)
		}

		const passkeys = this.db
			.query<Credential, [string, string]>(`SELECT * FROM credentials WHERE user_id = ? AND type = ?`)
			.all(user.id, "passkey")

		const webAuthnCredentialId = req.response.id
		const passkey = passkeys.find((p) => {
			if (!p.metadata) return false
			const metadata = JSON.parse(p.metadata) as PasskeyMetadata
			return metadata.credentialId === webAuthnCredentialId
		})

		if (!passkey) {
			throw new APIError("Credential not found", 401)
		}

		if (!passkey.metadata) {
			throw new APIError("Invalid passkey metadata", 401)
		}

		const metadata = JSON.parse(passkey.metadata) as PasskeyMetadata

		try {
			const verification = await webauthn.verifyAuthenticationResponse({
				response: req.response,
				expectedChallenge: challengeRecord.verifier,
				expectedOrigin: this.rp.origin,
				expectedRPID: this.rp.id,
				credential: {
					id: metadata.credentialId,
					publicKey: base64urlDecode(metadata.publicKey) as Uint8Array<ArrayBuffer>,
					counter: metadata.counter,
					transports: metadata.transports as AuthenticatorTransport[],
				},
			})

			if (!verification.verified) {
				throw new APIError("Verification failed", 401)
			}

			metadata.counter = verification.authenticationInfo.newCounter
			this.db.run(`UPDATE credentials SET metadata = ? WHERE id = ?`, [JSON.stringify(metadata), passkey.id])

			this.db.run(`DELETE FROM auth_challenges WHERE id = ?`, [challengeRecord.id])

			const session = this.sessions.createSession(user.id)
			ctx.sessionCookie = sess.createCookie(session)

			// Return vault data from passkey credential columns.
			let vault: { encryptedDEK: string } | null = null
			if (passkey.encrypted_dek) {
				vault = {
					encryptedDEK: base64urlEncode(new Uint8Array(passkey.encrypted_dek)),
				}
			}

			return {
				success: true,
				userId: user.id,
				vault,
			}
		} catch (error) {
			console.error("WebAuthn authentication error:", error)
			throw new APIError("Verification failed", 401)
		}
	}

	async webAuthnVaultStore(
		req: api.WebAuthnVaultStoreRequest,
		ctx: api.ServerContext,
	): Promise<api.WebAuthnVaultStoreResponse> {
		if (!ctx.sessionId) {
			throw new APIError("Not authenticated", 401)
		}

		const session = this.sessions.getSession(ctx.sessionId)
		if (!session) {
			throw new APIError("Session expired", 401)
		}

		if (!req.credentialId || !req.encryptedDEK) {
			throw new APIError("Missing required fields", 400)
		}

		// Find the credential by matching the WebAuthn credential ID in metadata.
		const credentials = this.db
			.query<Credential, [string, string]>(`SELECT * FROM credentials WHERE user_id = ? AND type = ?`)
			.all(session.user_id, "passkey")

		const credential = credentials.find((c) => {
			if (!c.metadata) return false
			const metadata = JSON.parse(c.metadata) as PasskeyMetadata
			return metadata.credentialId === req.credentialId
		})

		if (!credential) {
			throw new APIError("Invalid credential", 400)
		}

		this.db.run(`UPDATE credentials SET encrypted_dek = ? WHERE id = ?`, [
			base64urlDecode(req.encryptedDEK),
			credential.id,
		])

		return { success: true }
	}

	// ==========================================================================
	// Identity Endpoints
}

/**
 * Exported for use in client code that needs to know the default Argon2 params.
 */
export { DEFAULT_ARGON2_PARAMS }
