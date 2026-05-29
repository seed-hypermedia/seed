import type {Database} from 'bun:sqlite'
import * as connect from '@connectrpc/connect'
import {encode as cborEncode} from '@ipld/dag-cbor'
import * as base64 from '@seed-hypermedia/client/base64'
import type {GRPCClient} from '@shm/shared/grpc-client'
import * as webauthn from '@simplewebauthn/server'
import {argon2id} from 'hash-wasm'
import {base58btc} from 'multiformats/bases/base58'
import * as cookies from '@/cookies'
import type * as config from '@/config'
import type * as email from '@/email'
import * as sess from '@/session'
import type * as api from './api'

const isProd = process.env.NODE_ENV === 'production'

type MinimalGRPCClient = Pick<GRPCClient, 'daemon' | 'documents'>

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
  type: 'password' | 'passkey' | 'secret'
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
  salt: string
}

interface SecretMetadata {
  authHash: string
}

interface Challenge {
  email: string
  binding_hash: string
  code_hash: string
  new_email: string | null
  attempt_count: number
  create_time: number
  expire_time: number
}

interface VaultAccess {
  userId: string
  credentialId?: string
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    const aVal = a[i]
    const bVal = b[i]
    if (aVal === undefined || bVal === undefined) {
      throw new Error('Invalid array length')
    }
    diff |= aVal ^ bVal
  }
  return diff === 0
}

function sha256Hash(data: Uint8Array): Uint8Array {
  const hasher = new Bun.CryptoHasher('sha256')
  hasher.update(data)
  return new Uint8Array(hasher.digest())
}

async function hashPasswordAuthKey(authKey: Uint8Array, salt: string): Promise<string> {
  // These lighter Argon2id parameters are safe here because authKey is already a
  // high-entropy derived secret, not a human-memorable password.
  // We also reuse the same salt user sent us — should be enough.
  const hash = await argon2id({
    password: authKey,
    salt: base64.decode(salt),
    parallelism: 1,
    iterations: 1,
    memorySize: 16 * 1024,
    hashLength: 32,
    outputType: 'binary',
  })
  return base64.encode(hash)
}

function hashSecretAuthKey(authKey: Uint8Array): string {
  return base64.encode(sha256Hash(authKey))
}

function decodeBase64UrlOrThrow(value: string, fieldName: string): Uint8Array {
  try {
    return base64.decode(value)
  } catch {
    throw new APIError(`Invalid ${fieldName}`, 400)
  }
}

function normalizeEmail(value: string): string {
  return value.toLowerCase()
}

function createEmailCode(): string {
  const values = new Uint16Array(1)
  const unbiasedLimit = 60_000

  while (true) {
    crypto.getRandomValues(values)
    const value = values[0]
    if (value === undefined) {
      throw new Error('Failed to generate email verification code')
    }
    if (value < unbiasedLimit) {
      return String(value % 10_000).padStart(4, '0')
    }
  }
}

function createEmailBinding(): string {
  const bindingBytes = new Uint8Array(32)
  crypto.getRandomValues(bindingBytes)
  return base64.encode(bindingBytes)
}

function hashEmailBinding(binding: string): Uint8Array {
  return sha256Hash(textEncoder.encode(binding))
}

function hashEmailCode(binding: string, code: string, email: string, newEmail: string | null): Uint8Array {
  return sha256Hash(textEncoder.encode(`${binding}\0${code}\0${email}\0${newEmail ?? ''}`))
}

function assertEmailCode(value: string): void {
  if (!/^\d{4}$/.test(value)) {
    throw new APIError('Invalid verification code', 400)
  }
}

export class APIError extends Error {
  constructor(
    message: string,
    public statusCode: number,
  ) {
    super(message)
    this.name = 'APIError'
  }
}

const EMAIL_CODE_EXPIRY_MS = 15 * 60 * 1000
const EMAIL_CODE_RESEND_COOLDOWN_MS = 60 * 1000
const EMAIL_CODE_MAX_ATTEMPTS = 3
const EMAIL_CODE_BINDING_COOKIE_MAX_AGE_SECONDS = EMAIL_CODE_EXPIRY_MS / 1000
const VAULT_CONNECT_TTL_MS = 2 * 60 * 1000
const VAULT_CONNECT_ID_PATTERN = /^[A-Za-z0-9_-]{43}$/
const VAULT_CONNECT_MAX_PAYLOAD_LENGTH = 4096

const textEncoder = new TextEncoder()

/**
 * API server implementation.
 */
export class Service implements api.ServerInterface {
  private db: Database
  private sessions: sess.Store
  private backendHttpBaseUrl: string
  private notificationServerUrl: string
  private grpcClient: MinimalGRPCClient
  private rp: config.RelyingParty
  private hmacSecret: Uint8Array
  private emailSender: email.EmailSender
  constructor(
    db: Database,
    backendHttpBaseUrl: string,
    notificationServerUrl: string,
    grpcClient: MinimalGRPCClient,
    rp: config.RelyingParty,
    hmacSecret: Uint8Array,
    emailSender: email.EmailSender,
  ) {
    this.db = db
    this.sessions = new sess.Store(db)
    this.backendHttpBaseUrl = backendHttpBaseUrl
    this.notificationServerUrl = notificationServerUrl
    this.grpcClient = grpcClient
    this.rp = rp
    this.hmacSecret = hmacSecret
    this.emailSender = emailSender
  }

  /**
   * Remove all expired challenges from the database.
   * Called at the start of challenge-related operations.
   */
  cleanupExpiredChallenges(): void {
    this.db.run(`DELETE FROM email_challenges WHERE expire_time <= ?`, [Date.now()])
  }

  /**
   * Remove all expired one-time Vault Connect payloads from the database.
   */
  cleanupExpiredVaultConnects(): void {
    this.db.run(`DELETE FROM vault_connects WHERE expire_time <= ?`, [Date.now()])
  }

  /**
   * Resolve and validate a browser cookie-backed session.
   */
  private requireCookieSession(ctx: api.ServerContext): sess.Session {
    return this.requireSessionByID(ctx.sessionId)
  }

  /**
   * Resolve and validate vault access from either secret bearer auth or cookie.
   * Secret bearer auth takes precedence when provided.
   */
  private requireVaultAccess(ctx: api.ServerContext): VaultAccess {
    if (ctx.bearerAuth) {
      return this.requireSecretCredentialAccess(ctx.bearerAuth)
    }

    const session = this.requireSessionByID(ctx.sessionId)
    return {userId: session.user_id}
  }

  /**
   * Resolve and validate secret-credential bearer auth for vault routes.
   */
  private requireSecretCredentialAccess(bearerAuth: string): VaultAccess {
    const delimiterIndex = bearerAuth.indexOf(':')
    if (delimiterIndex === -1) {
      throw new APIError('Malformed bearer credentials: missing colon separator', 400)
    }

    const credentialId = bearerAuth.slice(0, delimiterIndex)
    const encodedAuthKey = bearerAuth.slice(delimiterIndex + 1)
    if (!credentialId) {
      throw new APIError('Malformed bearer credentials: credential ID is required', 400)
    }
    if (!encodedAuthKey) {
      throw new APIError('Malformed bearer credentials: auth key is required', 400)
    }

    const credential = this.db.query<Credential, [string]>(`SELECT * FROM credentials WHERE id = ?`).get(credentialId)
    if (!credential) {
      throw new APIError('Invalid secret credential', 401)
    }
    if (credential.type !== 'secret') {
      throw new APIError('Invalid secret credential', 401)
    }
    if (!credential.metadata) {
      throw new APIError('Invalid secret credential', 401)
    }

    const authKey = decodeBase64UrlOrThrow(encodedAuthKey, 'authKey')

    let metadata: SecretMetadata
    try {
      metadata = JSON.parse(credential.metadata) as SecretMetadata
    } catch {
      throw new APIError('Invalid secret credential', 401)
    }
    if (!metadata.authHash) {
      throw new APIError('Invalid secret credential', 401)
    }

    let storedHash: Uint8Array
    try {
      storedHash = base64.decode(metadata.authHash)
    } catch {
      throw new APIError('Invalid secret credential', 401)
    }

    const providedHash = sha256Hash(authKey)
    if (!timingSafeEqual(providedHash, storedHash)) {
      throw new APIError('Invalid secret credential', 401)
    }

    return {userId: credential.user_id, credentialId: credential.id}
  }

  private requireSessionByID(sessionId: string | null | undefined): sess.Session {
    if (!sessionId) {
      throw new APIError('Not authenticated', 401)
    }

    const currentSession = this.sessions.getSession(sessionId)
    if (!currentSession) {
      throw new APIError('Session expired', 401)
    }

    return currentSession
  }

  /**
   * Build a vault response for a specific user.
   */
  private buildVaultResponse(
    userId: string,
    user: Pick<User, 'encrypted_data' | 'version'>,
    opts: {
      emailPrevalidation?: api.EmailPrevalidation
    } = {},
  ): api.GetVaultDataResponse {
    const response: api.GetVaultDataResponse = {
      credentials: [],
      version: user.version,
      ...(opts.emailPrevalidation ? {emailPrevalidation: opts.emailPrevalidation} : {}),
    }

    const credentials = this.db.query<Credential, [string]>(`SELECT * FROM credentials WHERE user_id = ?`).all(userId)

    response.credentials = credentials.flatMap((credential): api.VaultCredential[] => {
      if (!credential.encrypted_dek || !credential.metadata) {
        return []
      }

      if (credential.type === 'password') {
        const metadata = JSON.parse(credential.metadata) as PasswordMetadata
        return [
          {
            kind: 'password',
            salt: metadata.salt,
            wrappedDEK: base64.encode(new Uint8Array(credential.encrypted_dek)),
          },
        ]
      }

      if (credential.type === 'passkey') {
        const metadata = JSON.parse(credential.metadata) as PasskeyMetadata
        return [
          {
            kind: 'passkey',
            credentialId: metadata.credentialId,
            wrappedDEK: base64.encode(new Uint8Array(credential.encrypted_dek)),
          },
        ]
      }

      if (credential.type === 'secret') {
        return [
          {
            kind: 'secret',
            credentialId: credential.id,
            wrappedDEK: base64.encode(new Uint8Array(credential.encrypted_dek)),
          },
        ]
      }

      return []
    })

    if (user.encrypted_data) {
      response.encryptedData = base64.encode(new Uint8Array(user.encrypted_data))
    }

    return response
  }

  /**
   * Persist vault ciphertext for the given user with optimistic version checks.
   */
  private saveVaultForUser(req: api.SaveVaultRequest, userId: string): api.SaveVaultResponse {
    if (!req.encryptedData) {
      throw new APIError('Missing required fields', 400)
    }

    const result = this.db.run(
      `UPDATE users SET encrypted_data = ?, version = version + 1 WHERE id = ? AND version = ?`,
      [base64.decode(req.encryptedData), userId, req.version],
    )

    if (result.changes === 0) {
      throw new APIError('Vault has been modified by another session. Please reload.', 409)
    }

    return {success: true}
  }

  async preLogin(req: api.PreLoginRequest, _ctx: api.ServerContext): Promise<api.PreLoginResponse> {
    if (!req.email || typeof req.email !== 'string') {
      throw new APIError('Email required', 400)
    }

    const user = this.db
      .query<Pick<User, 'id'>, [string]>(`SELECT id FROM users WHERE email = ?`)
      .get(req.email.toLowerCase())

    if (!user) {
      return {exists: false}
    }

    const passwordCredential = this.db
      .query<
        Pick<Credential, 'id' | 'metadata'>,
        [string, string]
      >(`SELECT id, metadata FROM credentials WHERE user_id = ? AND type = ?`)
      .get(user.id, 'password')

    const passwordMetadata = passwordCredential?.metadata
      ? (JSON.parse(passwordCredential.metadata) as PasswordMetadata)
      : undefined

    const passkeyCredential = this.db
      .query<{id: string}, [string, string]>(`SELECT id FROM credentials WHERE user_id = ? AND type = ?`)
      .get(user.id, 'passkey')

    return {
      exists: true,
      credentials: {
        ...(passwordCredential ? {password: true} : {}),
        ...(passkeyCredential ? {passkey: true} : {}),
      },
      salt: passwordMetadata?.salt,
    }
  }

  async getAccount(req: api.GetAccountRequest, _ctx: api.ServerContext): Promise<api.GetAccountResponse> {
    if (!req.id || typeof req.id !== 'string') {
      throw new APIError('Account ID required', 400)
    }

    try {
      return await this.grpcClient.documents.getAccount({id: req.id})
    } catch (error) {
      if (error instanceof connect.ConnectError) {
        if (error.code === connect.Code.NotFound) {
          throw new APIError('Account not found', 404)
        }
        if (error.code === connect.Code.InvalidArgument) {
          throw new APIError(error.rawMessage || 'Invalid account ID', 400)
        }
      }
      throw error
    }
  }

  async getConfig(_ctx: api.ServerContext): Promise<api.GetConfigResponse> {
    return {
      backendHttpBaseUrl: this.backendHttpBaseUrl,
      notificationServerUrl: this.notificationServerUrl,
    }
  }

  async registerStart(req: api.RegisterStartRequest, _ctx: api.ServerContext): Promise<api.RegisterStartResponse> {
    if (!req.email || typeof req.email !== 'string') {
      throw new APIError('Email required', 400)
    }

    this.cleanupExpiredChallenges()

    const normalizedEmail = normalizeEmail(req.email)

    const existingUser = this.db
      .query<{id: string}, [string]>(`SELECT id FROM users WHERE email = ?`)
      .get(normalizedEmail)

    if (existingUser) {
      const credential = this.db
        .query<{id: string}, [string]>(`SELECT id FROM credentials WHERE user_id = ?`)
        .get(existingUser.id)

      if (credential) {
        throw new APIError('User already exists', 409)
      }
    }

    const now = Date.now()
    const existingChallenge = this.db
      .query<
        Pick<Challenge, 'create_time'>,
        [string, number]
      >(`SELECT create_time FROM email_challenges WHERE email = ? AND expire_time > ?`)
      .get(normalizedEmail, now)

    if (existingChallenge) {
      const resendAllowedTime = existingChallenge.create_time + EMAIL_CODE_RESEND_COOLDOWN_MS
      if (now < resendAllowedTime) {
        throw new APIError('Please wait before requesting another verification code', 429)
      }
    }

    const binding = createEmailBinding()
    const code = createEmailCode()
    const expireTime = now + EMAIL_CODE_EXPIRY_MS
    const resendAllowedTime = now + EMAIL_CODE_RESEND_COOLDOWN_MS

    this.db.run(`DELETE FROM email_challenges WHERE email = ?`, [normalizedEmail])
    this.db.run(
      `INSERT INTO email_challenges (email, binding_hash, code_hash, new_email, attempt_count, create_time, expire_time) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        normalizedEmail,
        base64.encode(hashEmailBinding(binding)),
        base64.encode(hashEmailCode(binding, code, normalizedEmail, null)),
        null,
        0,
        now,
        expireTime,
      ],
    )

    try {
      await this.emailSender.sendVerificationEmail(normalizedEmail, code)
    } catch (error) {
      this.db.run(`DELETE FROM email_challenges WHERE email = ?`, [normalizedEmail])
      throw error
    }

    _ctx.outboundEmailChallengeCookie = cookies.createEmailCookieHeader(
      cookies.encodeEmailCookieValue({binding, email: normalizedEmail, newEmail: null}),
      EMAIL_CODE_BINDING_COOKIE_MAX_AGE_SECONDS,
      isProd,
    )

    return {
      message: 'Verification code sent',
      expireTime,
      resendAllowedTime,
    }
  }

  async registerVerify(req: api.RegisterVerifyRequest, ctx: api.ServerContext): Promise<api.RegisterVerifyResponse> {
    assertEmailCode(req.code)

    this.cleanupExpiredChallenges()

    const cookieValue = ctx.emailChallengeCookie ? cookies.decodeEmailCookieValue(ctx.emailChallengeCookie) : null
    if (!cookieValue || cookieValue.newEmail !== null) {
      throw new APIError('Missing email challenge cookie. Start verification from scratch.', 400)
    }

    const normalizedEmail = normalizeEmail(cookieValue.email)
    const challengeRow = this.db
      .query<Challenge, [string, number]>(`SELECT * FROM email_challenges WHERE email = ? AND expire_time > ?`)
      .get(normalizedEmail, Date.now())

    if (!challengeRow || challengeRow.new_email !== null) {
      throw new APIError(`No email verification challenge found for email '${cookieValue.email}'.`, 400)
    }

    if (!timingSafeEqual(base64.decode(challengeRow.binding_hash), hashEmailBinding(cookieValue.binding))) {
      throw new APIError(
        'Invalid email challenge cookie. Make sure to use the same browser you requested the code from.',
        400,
      )
    }

    const expectedCodeHash = base64.decode(challengeRow.code_hash)
    const providedCodeHash = hashEmailCode(cookieValue.binding, req.code, normalizedEmail, null)
    if (!timingSafeEqual(providedCodeHash, expectedCodeHash)) {
      const attempts = challengeRow.attempt_count + 1
      if (attempts >= EMAIL_CODE_MAX_ATTEMPTS) {
        this.db.run(`DELETE FROM email_challenges WHERE email = ?`, [normalizedEmail])
        ctx.outboundEmailChallengeCookie = null
      } else {
        this.db.run(`UPDATE email_challenges SET attempt_count = ? WHERE email = ?`, [attempts, normalizedEmail])
      }
      throw new APIError(`Invalid code. ${EMAIL_CODE_MAX_ATTEMPTS - attempts} attempts remaining.`, 400)
    }

    this.db.run(`DELETE FROM email_challenges WHERE email = ?`, [normalizedEmail])

    let userId: string
    const existingUser = this.db
      .query<{id: string}, [string]>(`SELECT id FROM users WHERE email = ?`)
      .get(normalizedEmail)
    if (existingUser) {
      const credential = this.db
        .query<{id: string}, [string]>(`SELECT id FROM credentials WHERE user_id = ?`)
        .get(existingUser.id)
      if (credential) {
        this.db.run(`DELETE FROM email_challenges WHERE email = ?`, [normalizedEmail])
        ctx.outboundEmailChallengeCookie = null
        throw new APIError('User already exists', 409)
      }
      userId = existingUser.id
    } else {
      userId = sess.randomId()
      this.db.run(`INSERT INTO users (id, email, create_time) VALUES (?, ?, ?)`, [userId, normalizedEmail, Date.now()])
    }

    const session = this.sessions.createSession(userId)
    ctx.sessionCookie = sess.createCookie(session)
    ctx.outboundEmailChallengeCookie = null

    return {
      verified: true,
      userId,
    }
  }

  /**
   * Add the authenticated user's password credential.
   */
  async addPassword(req: api.AddPasswordRequest, ctx: api.ServerContext): Promise<api.AddPasswordResponse> {
    const session = this.requireCookieSession(ctx)

    if (!req.wrappedDEK || !req.authKey || !req.salt) {
      throw new APIError('Missing required fields', 400)
    }

    const user = this.db.query<User, [string]>(`SELECT * FROM users WHERE id = ?`).get(session.user_id)
    if (!user) {
      throw new APIError('User not found', 404)
    }

    const existing = this.db
      .query<{id: string}, [string, string]>(`SELECT id FROM credentials WHERE user_id = ? AND type = ?`)
      .get(session.user_id, 'password')

    if (existing) {
      throw new APIError('Password already set', 409)
    }

    const metadata: PasswordMetadata = {
      authHash: await hashPasswordAuthKey(base64.decode(req.authKey), req.salt),
      salt: req.salt,
    }

    this.db.run(
      `INSERT INTO credentials (id, user_id, type, encrypted_dek, metadata, create_time) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        sess.randomId(),
        session.user_id,
        'password',
        base64.decode(req.wrappedDEK),
        JSON.stringify(metadata),
        Date.now(),
      ],
    )

    return {success: true}
  }

  /**
   * Change the authenticated user's password credential.
   */
  async changePassword(req: api.ChangePasswordRequest, ctx: api.ServerContext): Promise<api.ChangePasswordResponse> {
    const session = this.requireCookieSession(ctx)

    if (!req.wrappedDEK || !req.authKey || !req.salt) {
      throw new APIError('Missing required fields', 400)
    }

    const user = this.db.query<User, [string]>(`SELECT * FROM users WHERE id = ?`).get(session.user_id)
    if (!user) {
      throw new APIError('User not found', 404)
    }

    const existing = this.db
      .query<{id: string}, [string, string]>(`SELECT id FROM credentials WHERE user_id = ? AND type = ?`)
      .get(session.user_id, 'password')

    if (!existing) {
      throw new APIError('Password not set', 409)
    }

    const metadata: PasswordMetadata = {
      authHash: await hashPasswordAuthKey(base64.decode(req.authKey), req.salt),
      salt: req.salt,
    }

    this.db.run(`UPDATE credentials SET encrypted_dek = ?, metadata = ? WHERE id = ?`, [
      base64.decode(req.wrappedDEK),
      JSON.stringify(metadata),
      existing.id,
    ])

    return {success: true}
  }

  async addSecretCredential(
    req: api.AddSecretCredentialRequest,
    ctx: api.ServerContext,
  ): Promise<api.AddSecretCredentialResponse> {
    const session = this.requireCookieSession(ctx)

    if (!req.authKey || !req.wrappedDEK) {
      throw new APIError('Missing required fields', 400)
    }

    const user = this.db.query<User, [string]>(`SELECT * FROM users WHERE id = ?`).get(session.user_id)
    if (!user) {
      throw new APIError('User not found', 404)
    }

    const authKey = decodeBase64UrlOrThrow(req.authKey, 'authKey')
    const wrappedDEK = decodeBase64UrlOrThrow(req.wrappedDEK, 'wrappedDEK')
    const metadata: SecretMetadata = {
      authHash: hashSecretAuthKey(authKey),
    }

    const credentialId = sess.randomId()
    this.db.run(
      `INSERT INTO credentials (id, user_id, type, encrypted_dek, metadata, create_time) VALUES (?, ?, ?, ?, ?, ?)`,
      [credentialId, session.user_id, 'secret', wrappedDEK, JSON.stringify(metadata), Date.now()],
    )

    return {
      success: true,
      credentialId,
    }
  }

  async deleteSecretCredential(
    req: api.DeleteSecretCredentialRequest,
    ctx: api.ServerContext,
  ): Promise<api.DeleteSecretCredentialResponse> {
    if (!req.credentialId || typeof req.credentialId !== 'string') {
      throw new APIError('Secret credential ID required', 400)
    }
    if (!ctx.bearerAuth) {
      throw new APIError('Secret credential bearer auth required', 401)
    }

    const access = this.requireSecretCredentialAccess(ctx.bearerAuth)
    if (access.credentialId !== req.credentialId) {
      throw new APIError('Secret credential bearer auth must match the deleted credential', 403)
    }

    this.db.run(`DELETE FROM credentials WHERE id = ? AND user_id = ? AND type = ?`, [
      req.credentialId,
      access.userId,
      'secret',
    ])
    return {success: true}
  }

  async putVaultConnect(req: api.PutVaultConnectRequest, ctx: api.ServerContext): Promise<api.PutVaultConnectResponse> {
    this.requireCookieSession(ctx)

    if (!req.connectId || typeof req.connectId !== 'string' || !VAULT_CONNECT_ID_PATTERN.test(req.connectId)) {
      throw new APIError('Invalid vault connect ID', 400)
    }
    if (!req.payload || typeof req.payload !== 'string' || req.payload.length > VAULT_CONNECT_MAX_PAYLOAD_LENGTH) {
      throw new APIError('Invalid vault connect payload', 400)
    }
    try {
      base64.decode(req.payload)
    } catch {
      throw new APIError('Invalid vault connect payload', 400)
    }

    this.cleanupExpiredVaultConnects()

    const now = Date.now()
    const expireTime = now + VAULT_CONNECT_TTL_MS
    this.db.run(`INSERT OR REPLACE INTO vault_connects (id, payload, create_time, expire_time) VALUES (?, ?, ?, ?)`, [
      req.connectId,
      req.payload,
      now,
      expireTime,
    ])

    return {success: true, expireTime}
  }

  async getVaultConnect(
    req: api.GetVaultConnectRequest,
    _ctx: api.ServerContext,
  ): Promise<api.GetVaultConnectResponse> {
    if (!req.connectId || typeof req.connectId !== 'string' || !VAULT_CONNECT_ID_PATTERN.test(req.connectId)) {
      throw new APIError('Invalid vault connect ID', 400)
    }

    this.cleanupExpiredVaultConnects()

    const row = this.db
      .query<{payload: string}, [string, number]>(`SELECT payload FROM vault_connects WHERE id = ? AND expire_time > ?`)
      .get(req.connectId, Date.now())
    if (!row) {
      return {found: false}
    }

    this.db.run(`DELETE FROM vault_connects WHERE id = ?`, [req.connectId])
    return {found: true, payload: row.payload}
  }

  async login(req: api.LoginRequest, ctx: api.ServerContext): Promise<api.LoginResponse> {
    if (!req.email || !req.authKey) {
      throw new APIError('Email and authKey required', 400)
    }

    const normalizedEmail = req.email.toLowerCase()

    const user = this.db.query<User, [string]>(`SELECT * FROM users WHERE email = ?`).get(normalizedEmail)

    if (!user) {
      throw new APIError('Invalid credentials', 401)
    }

    const passwordCredential = this.db
      .query<Credential, [string, string]>(`SELECT * FROM credentials WHERE user_id = ? AND type = ?`)
      .get(user.id, 'password')

    if (!passwordCredential || !passwordCredential.metadata) {
      throw new APIError('Invalid credentials', 401)
    }

    const passwordMetadata = JSON.parse(passwordCredential.metadata) as PasswordMetadata
    const providedHash = await hashPasswordAuthKey(base64.decode(req.authKey), passwordMetadata.salt)
    const storedHash = base64.decode(passwordMetadata.authHash)

    if (!timingSafeEqual(base64.decode(providedHash), storedHash)) {
      throw new APIError('Invalid credentials', 401)
    }

    const session = this.sessions.createSession(user.id)
    ctx.sessionCookie = sess.createCookie(session)

    return {
      success: true,
      userId: user.id,
    }
  }

  async getVault(req: api.GetVaultRequest, ctx: api.ServerContext): Promise<api.GetVaultResponse> {
    const knownVersion = req.knownVersion
    if (knownVersion !== undefined && (!Number.isInteger(knownVersion) || knownVersion < 0)) {
      throw new APIError('Invalid knownVersion', 400)
    }

    const access = this.requireVaultAccess(ctx)
    const user = this.db
      .query<
        Pick<User, 'email' | 'encrypted_data' | 'version'>,
        [string]
      >(`SELECT email, encrypted_data, version FROM users WHERE id = ?`)
      .get(access.userId)

    if (!user) {
      throw new APIError('User not found', 404)
    }

    if (knownVersion !== undefined && user.version === knownVersion) {
      return {unchanged: true}
    }

    let emailPrevalidation: api.EmailPrevalidation | undefined

    // Sign an email prevalidation payload so the client can skip email
    // verification on the notification server, if it trusts this vault.
    try {
      const keys = await this.grpcClient.daemon.listKeys({})
      const sortedKeys = [...(keys.keys || [])].sort((a, b) => a.accountId.localeCompare(b.accountId))
      const firstKey = sortedKeys[0]
      if (firstKey && user.email) {
        const signerBytes = new Uint8Array(base58btc.decode(firstKey.accountId))
        const unsignedPayload = {
          email: user.email,
          signer: signerBytes,
          host: this.rp.origin,
        }
        const encodedPayload = new Uint8Array(cborEncode(unsignedPayload))
        const signed = await this.grpcClient.daemon.signData({
          signingKeyName: firstKey.accountId,
          data: encodedPayload,
        })
        emailPrevalidation = {
          email: user.email,
          signer: base64.encode(signerBytes),
          host: this.rp.origin,
          sig: base64.encode(new Uint8Array(signed.signature)),
        }
      }
    } catch (e) {
      // Non-fatal: vault data is still usable without email prevalidation.
      console.error('[vault:getVault] failed to sign email prevalidation:', e)
    }

    return this.buildVaultResponse(access.userId, user, {
      emailPrevalidation,
    })
  }

  async saveVault(req: api.SaveVaultRequest, ctx: api.ServerContext): Promise<api.SaveVaultResponse> {
    const access = this.requireVaultAccess(ctx)
    return this.saveVaultForUser(req, access.userId)
  }

  async logout(ctx: api.ServerContext): Promise<api.LogoutResponse> {
    if (ctx.sessionId) {
      this.sessions.deleteSession(ctx.sessionId)
    }
    ctx.sessionCookie = null

    return {success: true}
  }

  async getSession(ctx: api.ServerContext): Promise<api.GetSessionResponse> {
    if (!ctx.sessionId) {
      return {authenticated: false, relyingPartyOrigin: this.rp.origin}
    }

    const session = this.sessions.getSession(ctx.sessionId)
    if (!session) {
      return {authenticated: false, relyingPartyOrigin: this.rp.origin}
    }

    const user = this.db
      .query<Pick<User, 'id' | 'email'>, [string]>(`SELECT id, email FROM users WHERE id = ?`)
      .get(session.user_id)

    if (!user) {
      return {authenticated: false, relyingPartyOrigin: this.rp.origin}
    }

    const passwordCredential = this.db
      .query<{id: string}, [string, string]>(`SELECT id FROM credentials WHERE user_id = ? AND type = ?`)
      .get(user.id, 'password')

    const passkeyCredential = this.db
      .query<{id: string}, [string, string]>(`SELECT id FROM credentials WHERE user_id = ? AND type = ?`)
      .get(user.id, 'passkey')

    return {
      authenticated: true,
      relyingPartyOrigin: this.rp.origin,
      userId: user.id,
      email: user.email,
      credentials: {
        ...(passwordCredential ? {password: true} : {}),
        ...(passkeyCredential ? {passkey: true} : {}),
      },
    }
  }

  /**
   * Start email change process. Sends a verification code to the new email address.
   * Requires authentication.
   */
  async changeEmailStart(
    req: api.ChangeEmailStartRequest,
    ctx: api.ServerContext,
  ): Promise<api.ChangeEmailStartResponse> {
    if (!ctx.sessionId) {
      throw new APIError('Not authenticated', 401)
    }

    const session = this.sessions.getSession(ctx.sessionId)
    if (!session) {
      throw new APIError('Session expired', 401)
    }

    this.cleanupExpiredChallenges()

    if (!req.newEmail || typeof req.newEmail !== 'string') {
      throw new APIError('New email required', 400)
    }

    const normalizedNewEmail = normalizeEmail(req.newEmail)

    // Check if new email is already in use.
    const existingUser = this.db
      .query<{id: string}, [string]>(`SELECT id FROM users WHERE email = ?`)
      .get(normalizedNewEmail)

    if (existingUser) {
      throw new APIError('Email already in use', 409)
    }

    // Get current user email for reference in the challenge.
    const user = this.db.query<User, [string]>(`SELECT * FROM users WHERE id = ?`).get(session.user_id)

    if (!user) {
      throw new APIError('User not found', 404)
    }

    const now = Date.now()
    const existingChallenge = this.db
      .query<
        Pick<Challenge, 'create_time'>,
        [string, number]
      >(`SELECT create_time FROM email_challenges WHERE email = ? AND expire_time > ?`)
      .get(user.email, now)

    if (existingChallenge) {
      const resendAllowedTime = existingChallenge.create_time + EMAIL_CODE_RESEND_COOLDOWN_MS
      if (now < resendAllowedTime) {
        throw new APIError('Please wait before requesting another verification code', 429)
      }
    }

    const binding = createEmailBinding()
    const code = createEmailCode()
    const expireTime = now + EMAIL_CODE_EXPIRY_MS
    const resendAllowedTime = now + EMAIL_CODE_RESEND_COOLDOWN_MS

    this.db.run(`DELETE FROM email_challenges WHERE email = ?`, [user.email])
    this.db.run(
      `INSERT INTO email_challenges (email, binding_hash, code_hash, new_email, attempt_count, create_time, expire_time) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        user.email,
        base64.encode(hashEmailBinding(binding)),
        base64.encode(hashEmailCode(binding, code, user.email, normalizedNewEmail)),
        normalizedNewEmail,
        0,
        now,
        expireTime,
      ],
    )

    try {
      await this.emailSender.sendVerificationEmail(normalizedNewEmail, code)
    } catch (error) {
      this.db.run(`DELETE FROM email_challenges WHERE email = ?`, [user.email])
      throw error
    }

    ctx.outboundEmailChallengeCookie = cookies.createEmailCookieHeader(
      cookies.encodeEmailCookieValue({binding, email: user.email, newEmail: normalizedNewEmail}),
      EMAIL_CODE_BINDING_COOKIE_MAX_AGE_SECONDS,
      isProd,
    )

    return {
      message: 'Verification code sent to new email',
      expireTime,
      resendAllowedTime,
    }
  }

  async changeEmailVerify(
    req: api.ChangeEmailVerifyRequest,
    ctx: api.ServerContext,
  ): Promise<api.ChangeEmailVerifyResponse> {
    assertEmailCode(req.code)

    const session = this.requireCookieSession(ctx)
    const user = this.db.query<User, [string]>(`SELECT * FROM users WHERE id = ?`).get(session.user_id)
    if (!user) {
      throw new APIError('User not found', 404)
    }

    this.cleanupExpiredChallenges()

    const cookieValue = ctx.emailChallengeCookie ? cookies.decodeEmailCookieValue(ctx.emailChallengeCookie) : null
    if (!cookieValue || cookieValue.newEmail === null || normalizeEmail(cookieValue.email) !== user.email) {
      throw new APIError('Invalid or expired verification code', 400)
    }

    const normalizedNewEmail = normalizeEmail(cookieValue.newEmail)
    const challengeRow = this.db
      .query<Challenge, [string, number]>(`SELECT * FROM email_challenges WHERE email = ? AND expire_time > ?`)
      .get(user.email, Date.now())

    if (
      !challengeRow ||
      challengeRow.new_email !== normalizedNewEmail ||
      !timingSafeEqual(base64.decode(challengeRow.binding_hash), hashEmailBinding(cookieValue.binding))
    ) {
      throw new APIError('Invalid or expired verification code', 400)
    }

    const expectedCodeHash = base64.decode(challengeRow.code_hash)
    const providedCodeHash = hashEmailCode(cookieValue.binding, req.code, user.email, normalizedNewEmail)
    if (!timingSafeEqual(providedCodeHash, expectedCodeHash)) {
      const attempts = challengeRow.attempt_count + 1
      if (attempts >= EMAIL_CODE_MAX_ATTEMPTS) {
        this.db.run(`DELETE FROM email_challenges WHERE email = ?`, [user.email])
        ctx.outboundEmailChallengeCookie = null
      } else {
        this.db.run(`UPDATE email_challenges SET attempt_count = ? WHERE email = ?`, [attempts, user.email])
      }
      throw new APIError('Invalid or expired verification code', 400)
    }

    // Verify the new email is still available (race condition check).
    const existingUser = this.db
      .query<{id: string}, [string, string]>(`SELECT id FROM users WHERE email = ? AND id != ?`)
      .get(normalizedNewEmail, session.user_id)

    if (existingUser) {
      this.db.run(`DELETE FROM email_challenges WHERE email = ?`, [user.email])
      ctx.outboundEmailChallengeCookie = null
      throw new APIError('Email already in use', 409)
    }

    this.db.run(`UPDATE users SET email = ? WHERE id = ?`, [normalizedNewEmail, session.user_id])
    this.db.run(`DELETE FROM email_challenges WHERE email = ?`, [user.email])
    ctx.outboundEmailChallengeCookie = null

    return {
      verified: true,
      newEmail: normalizedNewEmail,
    }
  }

  // ==========================================================================
  // Passkey endpoints.
  // ==========================================================================

  async addPasskeyStart(ctx: api.ServerContext): Promise<api.AddPasskeyStartResponse> {
    const session = this.requireCookieSession(ctx)

    this.cleanupExpiredChallenges()

    const user = this.db.query<User, [string]>(`SELECT * FROM users WHERE id = ?`).get(session.user_id)
    if (!user) {
      throw new APIError('User not found', 404)
    }

    const existingPasskeys = this.db
      .query<Credential, [string, string]>(`SELECT * FROM credentials WHERE user_id = ? AND type = ?`)
      .all(session.user_id, 'passkey')

    const excludeCredentials = existingPasskeys.map((p) => {
      if (!p.metadata) throw new Error('Passkey metadata is missing')
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
      attestationType: 'none',
      excludeCredentials,
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'required',
      },
      challenge: base64.encode(crypto.getRandomValues(new Uint8Array(32))),
    })

    const hmac = cookies.webauthnChallengeComputeHmac(
      this.hmacSecret,
      'webauthn-register',
      options.challenge,
      ctx.sessionId ?? '',
    )
    ctx.outboundChallengeCookie = cookies.webauthnChallengeCreateCookie(hmac, isProd)

    return options as api.AddPasskeyStartResponse
  }

  /**
   * Finalize passkey registration once the browser has derived PRF output and
   * wrapped the DEK for this credential.
   */
  async addPasskeyFinish(
    req: api.AddPasskeyFinishRequest,
    ctx: api.ServerContext,
  ): Promise<api.AddPasskeyFinishResponse> {
    const session = this.requireCookieSession(ctx)
    if (!req.wrappedDEK) {
      throw new APIError('Wrapped DEK required', 400)
    }

    if (!ctx.challengeCookie) {
      throw new APIError('No pending registration', 400)
    }

    const clientDataJSON = JSON.parse(
      new TextDecoder().decode(base64.decode(req.response.response.clientDataJSON)),
    ) as {challenge: string}

    const valid = cookies.webauthnChallengeVerifyHmac(
      this.hmacSecret,
      ctx.challengeCookie,
      'webauthn-register',
      clientDataJSON.challenge,
      ctx.sessionId ?? '',
    )
    if (!valid) {
      throw new APIError('Invalid or expired challenge', 400)
    }

    try {
      const verification = await webauthn.verifyRegistrationResponse({
        response: req.response,
        expectedChallenge: clientDataJSON.challenge,
        expectedOrigin: this.rp.origin,
        expectedRPID: this.rp.id,
      })

      ctx.outboundChallengeCookie = null

      if (!verification.verified || !verification.registrationInfo) {
        throw new APIError('Verification failed', 400)
      }

      const {credential, credentialBackedUp, credentialDeviceType} = verification.registrationInfo

      const backupEligible = credentialDeviceType === 'multiDevice'
      const backupState = credentialBackedUp

      if (!backupState) {
        console.warn(`⚠️  Passkey for user ${session.user_id} is not backed up. Consider adding more passkeys.`)
      }

      const credentialIdStr =
        typeof credential.id === 'string' ? credential.id : base64.encode(credential.id as unknown as Uint8Array)

      const metadata: PasskeyMetadata = {
        credentialId: credentialIdStr,
        publicKey: base64.encode(credential.publicKey as unknown as Uint8Array),
        counter: credential.counter,
        transports: req.response.response.transports,
        backupEligible,
        backupState,
        // PRF support is determined client-side from clientExtensionResults.
        // Client signals PRF usage by successfully wrapping the DEK with a PRF-derived key.
        prfEnabled: true,
      }

      this.db.run(
        `INSERT INTO credentials (id, user_id, type, encrypted_dek, metadata, create_time) VALUES (?, ?, ?, ?, ?, ?)`,
        [
          credentialIdStr,
          session.user_id,
          'passkey',
          base64.decode(req.wrappedDEK),
          JSON.stringify(metadata),
          Date.now(),
        ],
      )

      return {
        success: true,
        credentialId: metadata.credentialId,
        backupEligible,
        backupState,
        prfEnabled: metadata.prfEnabled,
      }
    } catch (error) {
      console.error('Passkey registration error:', error)
      throw new APIError('Verification failed', 400)
    }
  }

  async loginPasskeyStart(
    req: api.LoginPasskeyStartRequest,
    ctx: api.ServerContext,
  ): Promise<api.LoginPasskeyStartResponse> {
    // Conditional mediation: no email provided, generate anonymous challenge.
    if (!req.email) {
      const options = await webauthn.generateAuthenticationOptions({
        rpID: this.rp.id,
        userVerification: 'required',
      })

      const hmac = cookies.webauthnChallengeComputeHmac(this.hmacSecret, 'webauthn-login', options.challenge)
      ctx.outboundChallengeCookie = cookies.webauthnChallengeCreateCookie(hmac, isProd)

      return options as api.LoginPasskeyStartResponse
    }

    const normalizedEmail = req.email.toLowerCase()

    const user = this.db.query<User, [string]>(`SELECT * FROM users WHERE email = ?`).get(normalizedEmail)
    if (!user) {
      const options = await webauthn.generateAuthenticationOptions({
        rpID: this.rp.id,
        allowCredentials: [],
        userVerification: 'required',
      })
      return options as api.LoginPasskeyStartResponse
    }

    const passkeys = this.db
      .query<
        Credential,
        [string, string]
      >(`SELECT * FROM credentials WHERE user_id = ? AND type = ? AND encrypted_dek IS NOT NULL`)
      .all(user.id, 'passkey')

    if (passkeys.length === 0) {
      throw new APIError('No passkeys registered', 400)
    }

    const allowCredentials = passkeys.map((p) => {
      if (!p.metadata) throw new Error('Passkey metadata is missing')
      const metadata = JSON.parse(p.metadata) as PasskeyMetadata
      return {
        id: metadata.credentialId,
      }
    })

    const options = await webauthn.generateAuthenticationOptions({
      rpID: this.rp.id,
      allowCredentials,
      userVerification: 'required',
    })

    const hmac = cookies.webauthnChallengeComputeHmac(this.hmacSecret, 'webauthn-login', options.challenge)
    ctx.outboundChallengeCookie = cookies.webauthnChallengeCreateCookie(hmac, isProd)

    return {
      ...options,
      userId: user.id,
    } as api.LoginPasskeyStartResponse
  }

  async loginPasskeyFinish(
    req: api.LoginPasskeyFinishRequest,
    ctx: api.ServerContext,
  ): Promise<api.LoginPasskeyFinishResponse> {
    if (!req.response) {
      throw new APIError('Response required', 400)
    }

    // Look up passkey directly by primary key (WebAuthn credential ID).
    const passkey = this.db
      .query<Credential, [string, string]>(`SELECT * FROM credentials WHERE id = ? AND type = ?`)
      .get(req.response.id, 'passkey')

    if (!passkey || !passkey.metadata) {
      throw new APIError('Credential not found', 401)
    }

    const userId = passkey.user_id
    const metadata = JSON.parse(passkey.metadata) as PasskeyMetadata

    const clientDataJSON = JSON.parse(
      new TextDecoder().decode(base64.decode(req.response.response.clientDataJSON)),
    ) as {challenge: string}

    if (!ctx.challengeCookie) {
      throw new APIError('No pending authentication', 400)
    }

    const valid = cookies.webauthnChallengeVerifyHmac(
      this.hmacSecret,
      ctx.challengeCookie,
      'webauthn-login',
      clientDataJSON.challenge,
    )
    if (!valid) {
      throw new APIError('Invalid or expired challenge', 400)
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
        throw new APIError('Verification failed', 401)
      }

      metadata.counter = verification.authenticationInfo.newCounter
      this.db.run(`UPDATE credentials SET metadata = ? WHERE id = ?`, [JSON.stringify(metadata), passkey.id])

      ctx.outboundChallengeCookie = null

      const session = this.sessions.createSession(userId)
      ctx.sessionCookie = sess.createCookie(session)

      return {
        success: true,
        userId,
      }
    } catch (error) {
      console.error('Passkey authentication error:', error)
      throw new APIError('Verification failed', 401)
    }
  }
}
