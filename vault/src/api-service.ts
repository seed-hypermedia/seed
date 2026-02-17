import type { Database } from "bun:sqlite"
import * as webauthn from "@simplewebauthn/server"
import * as challenge from "@/challenge"
import type * as config from "@/config"
import type * as email from "@/email"
import * as base64 from "@/frontend/base64"
import * as sess from "@/session"
import type * as api from "./api"

const isProd = process.env.NODE_ENV === "production"

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
	purpose: "registration" | "email_change"
	token_hash: string
	email: string
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

/**
 * API server implementation.
 */
export class Service implements api.ServerInterface {
	private db: Database
	private sessions: sess.Store
	private rp: config.RelyingParty
	private hmacSecret: Uint8Array
	private emailSender: email.EmailSender
	constructor(db: Database, rp: config.RelyingParty, hmacSecret: Uint8Array, emailSender: email.EmailSender) {
		this.db = db
		this.sessions = new sess.Store(db)
		this.rp = rp
		this.hmacSecret = hmacSecret
		this.emailSender = emailSender
	}

	/**
	 * Remove all expired challenges from the database.
	 * Called at the start of challenge-related operations.
	 */
	cleanupExpiredChallenges(): void {
		this.db.run(`DELETE FROM email_challenges WHERE expire_time < ?`, [Date.now()])
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
		const token = base64.encode(tokenBytes)
		const tokenHash = base64.encode(sha256Hash(tokenBytes))
		const challengeId = sess.randomId()

		// Clean up any existing registration challenges for this email.
		this.db.run(`DELETE FROM email_challenges WHERE email = ? AND purpose = 'registration'`, [normalizedEmail])

		// Store the challenge with the hash of the token (not the token itself).
		this.db.run(
			`INSERT INTO email_challenges (id, user_id, purpose, token_hash, email, verified, expire_time) VALUES (?, ?, ?, ?, ?, ?, ?)`,
			[challengeId, null, "registration", tokenHash, normalizedEmail, 0, Date.now() + MAGIC_LINK_EXPIRY_MS],
		)

		// URL includes challengeId for efficient lookup and token for verification.
		const verifyUrl = `${this.rp.origin}/vault/verify/${challengeId}/${token}`
		await this.emailSender.sendLoginLink(normalizedEmail, verifyUrl)

		return {
			message: "Verification link sent",
			challengeId,
		}
	}

	/**
	 * Poll endpoint for the original device to check if the magic link was clicked.
	 */
	async registerPoll(req: api.RegisterPollRequest, ctx: api.ServerContext): Promise<api.RegisterPollResponse> {
		if (!req.challengeId) {
			throw new APIError("Challenge ID required", 400)
		}

		this.cleanupExpiredChallenges()

		const challenge = this.db
			.query<Challenge, [string, string]>(
				`SELECT * FROM email_challenges WHERE id = ? AND purpose = 'registration' AND expire_time > ?`,
			)
			.get(req.challengeId, Date.now().toString())

		if (!challenge) {
			throw new APIError("Challenge expired or not found", 400)
		}

		if (challenge.verified) {
			this.db.run(`DELETE FROM email_challenges WHERE id = ?`, [challenge.id])

			let userId: string
			const normalizedEmail = challenge.email.toLowerCase()

			// Check if user exists.
			const existingUser = this.db
				.query<{ id: string }, [string]>(`SELECT id FROM users WHERE email = ?`)
				.get(normalizedEmail)

			if (existingUser) {
				userId = existingUser.id
			} else {
				// Create new user.
				userId = sess.randomId()
				this.db.run(`INSERT INTO users (id, email, create_time) VALUES (?, ?, ?)`, [
					userId,
					normalizedEmail,
					Date.now(),
				])
			}

			// Create session.
			const session = this.sessions.createSession(userId)
			ctx.sessionCookie = sess.createCookie(session)

			return { verified: true, userId }
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
				`SELECT * FROM email_challenges WHERE id = ? AND purpose = 'registration' AND expire_time > ?`,
			)
			.get(req.challengeId, Date.now().toString())

		if (!challenge) {
			throw new APIError("Invalid or expired link", 400)
		}

		// Verify the token by comparing its hash with the stored hash.
		const tokenBytes = base64.decode(req.token)
		const providedHash = sha256Hash(tokenBytes)
		const storedHash = base64.decode(challenge.token_hash)

		if (!timingSafeEqual(providedHash, storedHash)) {
			throw new APIError("Invalid or expired link", 400)
		}

		// Mark as verified so the polling device can proceed.
		this.db.run(`UPDATE email_challenges SET verified = 1 WHERE id = ?`, [challenge.id])

		return {
			verified: true,
			email: challenge.email,
		}
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
				base64.decode(req.encryptedDEK),
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
				base64.decode(req.encryptedDEK),
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
					base64.decode(req.encryptedDEK),
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
			throw new APIError("Invalid credentials", 401)
		}

		const passwordCredential = this.db
			.query<Credential, [string, string]>(`SELECT * FROM credentials WHERE user_id = ? AND type = ?`)
			.get(user.id, "password")

		if (!passwordCredential || !passwordCredential.metadata) {
			throw new APIError("Invalid credentials", 401)
		}

		const passwordMetadata = JSON.parse(passwordCredential.metadata) as PasswordMetadata
		const providedHash = base64.decode(req.authHash)
		const storedHash = base64.decode(passwordMetadata.authHash)

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
				encryptedDEK: base64.encode(new Uint8Array(passwordCredential.encrypted_dek)),
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
			response.encryptedData = base64.encode(new Uint8Array(user.encrypted_data))
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
			[base64.decode(req.encryptedData), session.user_id, req.version],
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
			return { authenticated: false, relyingPartyOrigin: this.rp.origin }
		}

		const session = this.sessions.getSession(ctx.sessionId)
		if (!session) {
			return { authenticated: false, relyingPartyOrigin: this.rp.origin }
		}

		const user = this.db
			.query<Pick<User, "id" | "email">, [string]>(`SELECT id, email FROM users WHERE id = ?`)
			.get(session.user_id)

		if (!user) {
			return { authenticated: false, relyingPartyOrigin: this.rp.origin }
		}

		const passwordCredential = this.db
			.query<{ id: string }, [string, string]>(`SELECT id FROM credentials WHERE user_id = ? AND type = ?`)
			.get(user.id, "password")

		const passkeyCredential = this.db
			.query<{ id: string }, [string, string]>(`SELECT id FROM credentials WHERE user_id = ? AND type = ?`)
			.get(user.id, "passkey")

		return {
			authenticated: true,
			relyingPartyOrigin: this.rp.origin,
			userId: user.id,
			email: user.email,
			hasPassword: passwordCredential !== null,
			hasPasskeys: passkeyCredential !== null,
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
		const token = base64.encode(tokenBytes)
		const tokenHash = base64.encode(sha256Hash(tokenBytes))
		const challengeId = sess.randomId()

		// Clean up any existing email change challenges for this user.
		this.db.run(`DELETE FROM email_challenges WHERE user_id = ? AND purpose = 'email_change'`, [session.user_id])

		// Store the challenge with hash of the token.
		this.db.run(
			`INSERT INTO email_challenges (id, user_id, purpose, token_hash, email, new_email, verified, expire_time) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				challengeId,
				session.user_id,
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
		await this.emailSender.sendLoginLink(normalizedNewEmail, verifyUrl)

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
				`SELECT * FROM email_challenges WHERE id = ? AND user_id = ? AND purpose = 'email_change' AND expire_time > ?`,
			)
			.get(req.challengeId, session.user_id, Date.now().toString())

		if (!challenge) {
			throw new APIError("Challenge expired or not found", 400)
		}

		if (challenge.verified && challenge.new_email) {
			// User clicked the magic link - update email and clean up.
			this.db.run(`UPDATE users SET email = ? WHERE id = ?`, [challenge.new_email, session.user_id])
			this.db.run(`DELETE FROM email_challenges WHERE id = ?`, [challenge.id])

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
				`SELECT * FROM email_challenges WHERE id = ? AND purpose = 'email_change' AND expire_time > ?`,
			)
			.get(req.challengeId, Date.now().toString())

		if (!challenge) {
			throw new APIError("Invalid or expired link", 400)
		}

		// Verify the token by comparing its hash with the stored hash.
		const tokenBytes = base64.decode(req.token)
		const providedHash = sha256Hash(tokenBytes)
		const storedHash = base64.decode(challenge.token_hash)

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
			this.db.run(`DELETE FROM email_challenges WHERE id = ?`, [challenge.id])
			throw new APIError("Email already in use", 409)
		}

		// Mark as verified so the polling device can proceed.
		// Mark as verified so the polling device can proceed.
		this.db.run(`UPDATE email_challenges SET verified = 1 WHERE id = ?`, [challenge.id])

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
			challenge: base64.encode(crypto.getRandomValues(new Uint8Array(32))),
		})

		const hmac = challenge.computeHmac(this.hmacSecret, "webauthn-register", options.challenge, ctx.sessionId)
		ctx.outboundChallengeCookie = challenge.createCookieHeader(hmac, isProd)

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

		if (!ctx.challengeCookie) {
			throw new APIError("No pending registration", 400)
		}

		// Extract the challenge from the response's clientDataJSON.
		const clientDataJSON = JSON.parse(
			new TextDecoder().decode(base64.decode(req.response.response.clientDataJSON)),
		) as { challenge: string }

		const valid = challenge.verifyHmac(
			this.hmacSecret,
			ctx.challengeCookie,
			"webauthn-register",
			clientDataJSON.challenge,
			ctx.sessionId,
		)

		if (!valid) {
			throw new APIError("Invalid or expired challenge", 400)
		}

		try {
			const verification = await webauthn.verifyRegistrationResponse({
				response: req.response,
				expectedChallenge: clientDataJSON.challenge,
				expectedOrigin: this.rp.origin,
				expectedRPID: this.rp.id,
			})

			// Clear the cookie after use
			ctx.outboundChallengeCookie = null

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
				typeof credential.id === "string" ? credential.id : base64.encode(credential.id as unknown as Uint8Array)

			const metadata: PasskeyMetadata = {
				credentialId: credentialIdStr,
				publicKey: base64.encode(credential.publicKey as unknown as Uint8Array),
				counter: credential.counter,
				transports: req.response.response.transports,
				backupEligible,
				backupState,
				// PRF support is determined client-side based on clientExtensionResults.
				// Client signals PRF usage by successfully storing vault with PRF-derived key.
				prfEnabled: true,
			}

			const now = Date.now()

			this.db.run(`INSERT INTO credentials (id, user_id, type, metadata, create_time) VALUES (?, ?, ?, ?, ?)`, [
				credentialIdStr,
				session.user_id,
				"passkey",
				JSON.stringify(metadata),
				now,
			])

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
		ctx: api.ServerContext,
	): Promise<api.WebAuthnLoginStartResponse> {
		// Conditional mediation: no email provided, generate anonymous challenge.
		if (!req.email) {
			const options = await webauthn.generateAuthenticationOptions({
				rpID: this.rp.id,
				userVerification: "preferred",
			})

			const hmac = challenge.computeHmac(this.hmacSecret, "webauthn-login", options.challenge)
			ctx.outboundChallengeCookie = challenge.createCookieHeader(hmac, isProd)

			return options as api.WebAuthnLoginStartResponse
		}

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

		const hmac = challenge.computeHmac(this.hmacSecret, "webauthn-login", options.challenge)
		ctx.outboundChallengeCookie = challenge.createCookieHeader(hmac, isProd)

		return {
			...options,
			userId: user.id,
		} as api.WebAuthnLoginStartResponse
	}

	async webAuthnLoginComplete(
		req: api.WebAuthnLoginCompleteRequest,
		ctx: api.ServerContext,
	): Promise<api.WebAuthnLoginCompleteResponse> {
		if (!req.response) {
			throw new APIError("Response required", 400)
		}

		// Look up passkey directly by primary key (WebAuthn credential ID).
		const passkey = this.db
			.query<Credential, [string, string]>(`SELECT * FROM credentials WHERE id = ? AND type = ?`)
			.get(req.response.id, "passkey")

		if (!passkey || !passkey.metadata) {
			throw new APIError("Credential not found", 401)
		}

		const userId = passkey.user_id
		const metadata = JSON.parse(passkey.metadata) as PasskeyMetadata

		// Extract the challenge from the response's clientDataJSON so we can
		// verify against the cookie.
		const clientDataJSON = JSON.parse(
			new TextDecoder().decode(base64.decode(req.response.response.clientDataJSON)),
		) as { challenge: string }

		if (!ctx.challengeCookie) {
			throw new APIError("No pending authentication", 400)
		}

		const valid = challenge.verifyHmac(this.hmacSecret, ctx.challengeCookie, "webauthn-login", clientDataJSON.challenge)

		if (!valid) {
			throw new APIError("Invalid or expired challenge", 400)
		}

		try {
			const verification = await webauthn.verifyAuthenticationResponse({
				response: req.response,
				expectedChallenge: clientDataJSON.challenge,
				expectedOrigin: this.rp.origin,
				expectedRPID: this.rp.id,
				credential: {
					id: metadata.credentialId,
					publicKey: base64.decode(metadata.publicKey) as Uint8Array<ArrayBuffer>,
					counter: metadata.counter,
					transports: metadata.transports as AuthenticatorTransport[],
				},
			})

			if (!verification.verified) {
				throw new APIError("Verification failed", 401)
			}

			metadata.counter = verification.authenticationInfo.newCounter
			this.db.run(`UPDATE credentials SET metadata = ? WHERE id = ?`, [JSON.stringify(metadata), passkey.id])

			ctx.outboundChallengeCookie = null

			const session = this.sessions.createSession(userId)
			ctx.sessionCookie = sess.createCookie(session)

			let vault: { encryptedDEK: string } | null = null
			if (passkey.encrypted_dek) {
				vault = {
					encryptedDEK: base64.encode(new Uint8Array(passkey.encrypted_dek)),
				}
			}

			return {
				success: true,
				userId,
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

		// Look up passkey directly by primary key (WebAuthn credential ID) and verify ownership.
		const credential = this.db
			.query<Credential, [string, string, string]>(
				`SELECT * FROM credentials WHERE id = ? AND user_id = ? AND type = ?`,
			)
			.get(req.credentialId, session.user_id, "passkey")

		if (!credential) {
			throw new APIError("Invalid credential", 400)
		}

		this.db.run(`UPDATE credentials SET encrypted_dek = ? WHERE id = ?`, [
			base64.decode(req.encryptedDEK),
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
