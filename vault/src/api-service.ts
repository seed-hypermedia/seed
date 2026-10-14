import type {Database} from 'bun:sqlite'
import * as connect from '@connectrpc/connect'
import {encode as cborEncode} from '@ipld/dag-cbor'
import * as base64 from '@seed-hypermedia/client/base64'
import * as blobs from '@seed-hypermedia/client/blobs'
import {ed25519} from '@noble/curves/ed25519.js'
import {Role} from '@shm/shared/client/.generated/documents/v3alpha/access_control_pb'
import type {GRPCClient} from '@shm/shared/grpc-client'
import * as webauthn from '@simplewebauthn/server'
import {argon2id} from 'hash-wasm'
import {base58btc} from 'multiformats/bases/base58'
import * as cookies from '@/cookies'
import type * as config from '@/config'
import type * as email from '@/email'
import * as sess from '@/session'
import * as api from './api'

const isProd = process.env.NODE_ENV === 'production'

type MinimalGRPCClient = Pick<GRPCClient, 'daemon' | 'documents' | 'accessControl'>

/** The daemon key the enterprise bootstrap registered for the organization's space. */
const OWNER_KEY_NAME_PREFIX = 'enterprise-owner'

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
  purpose?: 'recovery'
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

interface Invitation {
  code: string
  email: string | null
  create_time: number
  used_time: number | null
  used_by_account: string | null
  role: api.InvitationRole
}

/** Optional server features, off by default. */
export type ServiceOptions = {
  /** Require a valid, unused invitation code to create an account. */
  inviteOnly?: boolean
  /** Bearer secret for the admin API. Empty disables the admin API (404). */
  adminSecret?: string
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

function createInvitationCode(): string {
  const codeBytes = new Uint8Array(32)
  crypto.getRandomValues(codeBytes)
  return base64.encode(codeBytes)
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
// Must cover the desktop daemon's poll window (connectionTokenTTL in
// backend/storage/vault/vault.go) so a posted payload outlives brief gaps
// in the daemon's polling.
const VAULT_CONNECT_TTL_MS = 15 * 60 * 1000
const VAULT_CONNECT_ID_PATTERN = /^[A-Za-z0-9_-]{43}$/
const VAULT_CONNECT_MAX_PAYLOAD_LENGTH = 4096
const INVITATION_CODE_PATTERN = /^[A-Za-z0-9_-]{32,128}$/
const INVITATIONS_MAX_BATCH = 100
const VAULT_ACCOUNTS_MAX = 500

const textEncoder = new TextEncoder()

/**
 * API server implementation.
 */
export class Service implements api.ServerInterface {
  private db: Database
  private sessions: sess.Store
  private backendHttpBaseUrl: string
  private notificationServerUrl: string
  private webBaseUrl: string
  private grpcClient: MinimalGRPCClient
  private rp: config.RelyingParty
  private hmacSecret: Uint8Array
  private emailSender: email.EmailSender
  private inviteOnly: boolean
  private adminSecret: string
  constructor(
    db: Database,
    backendHttpBaseUrl: string,
    notificationServerUrl: string,
    webBaseUrl: string,
    grpcClient: MinimalGRPCClient,
    rp: config.RelyingParty,
    hmacSecret: Uint8Array,
    emailSender: email.EmailSender,
    opts: ServiceOptions = {},
  ) {
    this.db = db
    this.sessions = new sess.Store(db)
    this.backendHttpBaseUrl = backendHttpBaseUrl
    this.notificationServerUrl = notificationServerUrl
    this.webBaseUrl = webBaseUrl
    this.grpcClient = grpcClient
    this.rp = rp
    this.hmacSecret = hmacSecret
    this.emailSender = emailSender
    this.inviteOnly = opts.inviteOnly ?? false
    this.adminSecret = opts.adminSecret ?? ''
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

  /**
   * Validate an invitation code for registering `email` without consuming it.
   * Returns the code when the server runs in invite-only mode, null otherwise.
   */
  private requireInvitation(invite: string | undefined, email: string): string | null {
    if (!this.inviteOnly) {
      return null
    }

    if (!invite || typeof invite !== 'string') {
      throw new APIError('This vault is invite-only. An invitation code is required to create an account.', 403)
    }

    const code = invite.trim()
    if (!INVITATION_CODE_PATTERN.test(code)) {
      throw new APIError('Invalid invitation code.', 403)
    }

    const invitation = this.db.query<Invitation, [string]>(`SELECT * FROM invitations WHERE code = ?`).get(code)
    if (!invitation) {
      throw new APIError('Invalid invitation code.', 403)
    }
    if (invitation.used_time !== null) {
      throw new APIError('This invitation code has already been used.', 403)
    }
    // Invitations are scoped to one email. A code without an email (minted
    // before the binding became mandatory) cannot register anyone.
    if (invitation.email === null) {
      throw new APIError('Invalid invitation code.', 403)
    }
    if (invitation.email !== email) {
      throw new APIError('This invitation code is for a different email address.', 403)
    }

    return code
  }

  /**
   * Public lookup of an unused invitation, so the app can show who it is for
   * even when the link lost its query string. Unknown, used and unbound codes
   * all answer 404 to keep the response free of state details.
   */
  async getInvitation(req: api.GetInvitationRequest, _ctx: api.ServerContext): Promise<api.GetInvitationResponse> {
    const code = typeof req.code === 'string' ? req.code.trim() : ''
    if (!INVITATION_CODE_PATTERN.test(code)) {
      throw new APIError('Invitation not found', 404)
    }

    const invitation = this.db.query<Invitation, [string]>(`SELECT * FROM invitations WHERE code = ?`).get(code)
    if (!invitation || invitation.used_time !== null || invitation.email === null) {
      throw new APIError('Invitation not found', 404)
    }

    return {email: invitation.email, valid: true}
  }

  /**
   * Mark an invitation as used by `userId`. Must run inside the transaction
   * that creates the account: the conditional update is what makes a code
   * single-use under concurrent registrations.
   */
  private consumeInvitation(code: string, email: string, userId: string): void {
    const result = this.db.run(
      `UPDATE invitations SET used_time = ?, used_by_account = ?
       WHERE code = ? AND used_time IS NULL AND email = ?`,
      [Date.now(), userId, code, email],
    )
    if (result.changes === 0) {
      throw new APIError('This invitation code has already been used.', 403)
    }
  }

  private requireAdmin(ctx: api.ServerContext): void {
    if (!this.adminSecret) {
      throw new APIError('Not found', 404)
    }

    const provided = textEncoder.encode(ctx.bearerAuth ?? '')
    const expected = textEncoder.encode(this.adminSecret)
    if (!ctx.bearerAuth || !timingSafeEqual(provided, expected)) {
      throw new APIError('Invalid admin secret', 401)
    }
  }

  /** Admin: look up which vault user holds a public account ID. */
  async adminGetAccount(req: api.AdminGetAccountRequest, ctx: api.ServerContext): Promise<api.AdminGetAccountResponse> {
    this.requireAdmin(ctx)

    if (!req.accountUid || typeof req.accountUid !== 'string') {
      throw new APIError('Account ID required', 400)
    }

    const row = this.db
      .query<{account_uid: string; create_time: number; email: string | null}, [string]>(
        `SELECT ua.account_uid, ua.create_time, u.email
         FROM user_accounts ua JOIN users u ON u.id = ua.user_id
         WHERE ua.account_uid = ?`,
      )
      .get(req.accountUid)
    if (!row) {
      throw new APIError('Account not found', 404)
    }

    return {
      accountUid: row.account_uid,
      ...(row.email ? {email: row.email} : {}),
      createTime: row.create_time,
    }
  }

  async syncVaultAccounts(
    req: api.SyncVaultAccountsRequest,
    ctx: api.ServerContext,
  ): Promise<api.SyncVaultAccountsResponse> {
    const access = this.requireVaultAccess(ctx)

    if (!Array.isArray(req.accounts) || req.accounts.length > VAULT_ACCOUNTS_MAX) {
      throw new APIError('Invalid accounts', 400)
    }
    for (const account of req.accounts) {
      if (!account || typeof account.uid !== 'string') {
        throw new APIError('Invalid account ID', 400)
      }
      if (!Number.isSafeInteger(account.createTime) || account.createTime < 0) {
        throw new APIError('Invalid account create time', 400)
      }
      if (!account.signature || typeof account.signature !== 'string') {
        throw new APIError('Missing account signature', 400)
      }
      this.verifyAccountClaim(account, access.userId)
    }

    this.db.transaction(() => {
      const keep = req.accounts.map((account) => account.uid)
      const placeholders = keep.map(() => '?').join(', ')
      this.db.run(
        keep.length
          ? `DELETE FROM user_accounts WHERE user_id = ? AND account_uid NOT IN (${placeholders})`
          : `DELETE FROM user_accounts WHERE user_id = ?`,
        [access.userId, ...keep],
      )
      for (const account of req.accounts) {
        const owner = this.db
          .query<{user_id: string}, [string]>(`SELECT user_id FROM user_accounts WHERE account_uid = ?`)
          .get(account.uid)
        if (owner && owner.user_id !== access.userId) {
          throw new APIError('Account is already registered to another vault user', 409)
        }
        this.db.run(
          `INSERT INTO user_accounts (account_uid, user_id, create_time) VALUES (?, ?, ?)
           ON CONFLICT(account_uid) DO UPDATE SET create_time = excluded.create_time`,
          [account.uid, access.userId, account.createTime],
        )
      }
    })()

    await this.grantInvitedRoles(
      access.userId,
      req.accounts.map((account) => account.uid),
    )

    return {success: true}
  }

  /** Check that the account key signed the canonical claim for this vault user. */
  private verifyAccountClaim(claim: api.VaultAccountClaim, userId: string): void {
    let principal: Uint8Array
    try {
      principal = blobs.principalFromString(claim.uid)
    } catch {
      throw new APIError('Invalid account ID', 400)
    }

    const signature = decodeBase64UrlOrThrow(claim.signature, 'account signature')
    const message = textEncoder.encode(api.vaultAccountClaimMessage(this.rp.origin, userId, claim.uid))
    const publicKey = principal.slice(blobs.ED25519_VARINT_PREFIX.length)

    let valid = false
    try {
      valid = signature.length === blobs.ED25519_SIGNATURE_SIZE && ed25519.verify(signature, message, publicKey)
    } catch {
      valid = false
    }
    if (!valid) {
      throw new APIError('Invalid account signature', 403)
    }
  }

  /**
   * The link an invited person opens. In invite-only mode it is the site's
   * sign-in page (`<site>/hm/sign-in?invite=<code>&email=<email>`): the site
   * starts the delegation and sends the person here, the account is created
   * inside that flow, and the same delegation signs them in to the site, so
   * they land on the site as a member instead of in the vault. Outside
   * invite-only mode (and for legacy unbound codes) it is the vault itself.
   */
  private invitationLink(code: string, email: string | null): string {
    const params = new URLSearchParams({invite: code})
    if (email !== null) {
      params.set('email', email)
    }
    if (this.inviteOnly && email !== null) {
      const site = (this.webBaseUrl || this.rp.origin).replace(/\/$/, '')
      return `${site}/hm/sign-in?${params.toString()}`
    }
    return `${this.rp.origin}/vault?${params.toString()}`
  }

  private toAdminInvitation(row: Invitation): api.AdminInvitation {
    return {
      code: row.code,
      email: row.email,
      link: this.invitationLink(row.code, row.email),
      role: row.role,
      createTime: row.create_time,
      usedTime: row.used_time,
      used: row.used_time !== null,
      grants: this.db
        .query<{account_uid: string; grant_time: number}, [string]>(
          `SELECT account_uid, grant_time FROM invitation_grants WHERE code = ? ORDER BY grant_time`,
        )
        .all(row.code)
        .map((g) => ({accountUid: g.account_uid, grantTime: g.grant_time})),
      accounts: row.used_by_account
        ? this.db
            .query<{account_uid: string; create_time: number}, [string]>(
              `SELECT account_uid, create_time FROM user_accounts WHERE user_id = ? ORDER BY create_time`,
            )
            .all(row.used_by_account)
            .map((a) => ({accountUid: a.account_uid, createTime: a.create_time}))
        : [],
    }
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
      .query<Pick<Credential, 'id' | 'metadata'>, [string, string]>(
        `SELECT id, metadata FROM credentials WHERE user_id = ? AND type = ?`,
      )
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
      webBaseUrl: this.webBaseUrl,
      inviteOnly: this.inviteOnly,
      relyingPartyName: this.rp.name,
    }
  }

  /**
   * Admin: mint invitation codes. In invite-only mode every invitation is
   * scoped to one email, so `email` is required and `count` must be 1.
   */
  async adminCreateInvitations(
    req: api.AdminCreateInvitationsRequest,
    ctx: api.ServerContext,
  ): Promise<api.AdminCreateInvitationsResponse> {
    this.requireAdmin(ctx)

    const count = req.count ?? 1
    if (!Number.isInteger(count) || count < 1 || count > INVITATIONS_MAX_BATCH) {
      throw new APIError(`count must be an integer between 1 and ${INVITATIONS_MAX_BATCH}`, 400)
    }

    let boundEmail: string | null = null
    if (req.email !== undefined && req.email !== null && req.email !== '') {
      if (typeof req.email !== 'string' || !req.email.includes('@')) {
        throw new APIError('Invalid email', 400)
      }
      boundEmail = normalizeEmail(req.email.trim())
    }
    if (boundEmail === null && this.inviteOnly) {
      throw new APIError('email is required: invitations are scoped to one email address', 400)
    }
    if (boundEmail !== null && count !== 1) {
      throw new APIError('count must be 1 when email is set: one invitation per email address', 400)
    }

    const role = req.role ?? 'reader'
    if (!api.INVITATION_ROLES.includes(role)) {
      throw new APIError(`role must be one of ${api.INVITATION_ROLES.join(', ')}`, 400)
    }

    const now = Date.now()
    const rows = this.db.transaction(() => {
      const created: Invitation[] = []
      for (let i = 0; i < count; i++) {
        const row: Invitation = {
          code: createInvitationCode(),
          email: boundEmail,
          create_time: now,
          used_time: null,
          used_by_account: null,
          role,
        }
        this.db.run(`INSERT INTO invitations (code, email, create_time, role) VALUES (?, ?, ?, ?)`, [
          row.code,
          row.email,
          row.create_time,
          row.role,
        ])
        created.push(row)
      }
      return created
    })()

    const invitations = rows.map((row) => this.toAdminInvitation(row))

    // Email the link to the invitee. A failed send does not undo the
    // invitation: the operator gets the link back and can pass it on.
    let emailed = false
    let emailError: string | undefined
    const first = invitations[0]
    if (boundEmail !== null && first && req.send !== false) {
      try {
        await this.emailSender.sendInvitationEmail(boundEmail, first.link, {siteName: this.rp.name, role})
        emailed = true
      } catch (error) {
        emailError = error instanceof Error ? error.message : String(error)
        console.error(`[vault:adminCreateInvitations] could not email the invitation to ${boundEmail}:`, emailError)
      }
    }

    return emailError === undefined ? {invitations, emailed} : {invitations, emailed, emailError}
  }

  /**
   * Writer invitations end in a WRITER capability on the site's space for each
   * account the invited user reports. Runs after every account sync and is
   * idempotent: one grant per account, recorded in invitation_grants. Errors
   * are logged, not raised; the next sync retries.
   */
  private async grantInvitedRoles(userId: string, accountUids: string[]): Promise<void> {
    const invitation = this.db
      .query<Pick<Invitation, 'code' | 'email'>, [string]>(
        `SELECT code, email FROM invitations WHERE used_by_account = ? AND role = 'writer' ORDER BY used_time LIMIT 1`,
      )
      .get(userId)
    if (!invitation) return

    const pending = accountUids.filter(
      (uid) =>
        !this.db
          .query<{account_uid: string}, [string]>(`SELECT account_uid FROM invitation_grants WHERE account_uid = ?`)
          .get(uid),
    )
    if (pending.length === 0) return

    let owner: {name: string; accountId: string}
    try {
      owner = await this.ownerKey()
    } catch (error) {
      console.error('[vault:grantInvitedRoles] no owner key to sign with:', error)
      return
    }

    for (const uid of pending) {
      try {
        const capability = await this.grpcClient.accessControl.createCapability({
          signingKeyName: owner.name,
          account: owner.accountId,
          delegate: uid,
          path: '',
          role: Role.WRITER,
          label: invitation.email ? `Invited writer: ${invitation.email}` : 'Invited writer',
        })
        this.db.run(
          `INSERT INTO invitation_grants (account_uid, code, capability_id, grant_time) VALUES (?, ?, ?, ?)
           ON CONFLICT(account_uid) DO NOTHING`,
          [uid, invitation.code, capability.id ?? null, Date.now()],
        )
        console.log(
          `[vault:grantInvitedRoles] granted WRITER on ${owner.accountId} to ${uid} (${
            invitation.email ?? invitation.code
          })`,
        )
      } catch (error) {
        console.error(`[vault:grantInvitedRoles] could not grant WRITER to ${uid}:`, error)
      }
    }
  }

  /** The daemon key that owns the organization's space: the bootstrap's `enterprise-owner*` key, or the only key. */
  private async ownerKey(): Promise<{name: string; accountId: string}> {
    const {keys} = await this.grpcClient.daemon.listKeys({})
    const all = keys || []
    const key =
      all.find((candidate) => candidate.name.startsWith(OWNER_KEY_NAME_PREFIX)) ??
      (all.length === 1 ? all[0] : undefined)
    if (!key) {
      throw new Error(
        all.length === 0
          ? 'the daemon holds no keys'
          : `the daemon holds ${all.length} keys and none is named ${OWNER_KEY_NAME_PREFIX}*`,
      )
    }
    return {name: key.name, accountId: key.accountId}
  }

  /** Admin: list invitations with their used/unused state. */
  async adminListInvitations(ctx: api.ServerContext): Promise<api.AdminListInvitationsResponse> {
    this.requireAdmin(ctx)

    const rows = this.db.query<Invitation, []>(`SELECT * FROM invitations ORDER BY create_time DESC, code ASC`).all()

    return {invitations: rows.map((row) => this.toAdminInvitation(row))}
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

    // Fail before sending any email when the invitation is missing or invalid.
    this.requireInvitation(req.invite, normalizedEmail)

    const now = Date.now()
    const existingChallenge = this.db
      .query<Pick<Challenge, 'create_time'>, [string, number]>(
        `SELECT create_time FROM email_challenges WHERE email = ? AND expire_time > ?`,
      )
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
    const invite = this.requireInvitation(req.invite, normalizedEmail)

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
      throw new APIError('Incorrect code. Request a new one to try again', 400)
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
    }

    // Account creation and invitation redemption commit together.
    this.db.transaction(() => {
      if (!existingUser) {
        this.db.run(`INSERT INTO users (id, email, create_time) VALUES (?, ?, ?)`, [
          userId,
          normalizedEmail,
          Date.now(),
        ])
      }
      if (invite) {
        this.consumeInvitation(invite, normalizedEmail, userId)
      }
    })()

    const session = this.sessions.createSession(userId)
    ctx.sessionCookie = sess.createCookie(session)
    ctx.outboundEmailChallengeCookie = null

    return {
      verified: true,
      userId,
    }
  }

  /**
   * Create the account straight from an email-bound invitation. The one-time
   * code in the link was emailed to that address, so a second verification
   * code would prove nothing new; the invitation is consumed in the same
   * transaction as the user row, and the session starts right away.
   */
  async registerInvited(req: api.RegisterInvitedRequest, ctx: api.ServerContext): Promise<api.RegisterVerifyResponse> {
    if (!req.email || typeof req.email !== 'string') {
      throw new APIError('Email required', 400)
    }
    if (!req.invite || typeof req.invite !== 'string') {
      throw new APIError('Invitation code required', 400)
    }
    if (!this.inviteOnly) {
      throw new APIError('Invitations are only used on invite-only vaults', 400)
    }
    const normalizedEmail = normalizeEmail(req.email)
    const invite = this.requireInvitation(req.invite, normalizedEmail)
    if (!invite) {
      throw new APIError('Invalid invitation code.', 403)
    }

    let userId: string
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
      userId = existingUser.id
    } else {
      userId = sess.randomId()
    }

    this.db.transaction(() => {
      if (!existingUser) {
        this.db.run(`INSERT INTO users (id, email, create_time) VALUES (?, ?, ?)`, [
          userId,
          normalizedEmail,
          Date.now(),
        ])
      }
      this.consumeInvitation(invite, normalizedEmail, userId)
    })()
    // Any half-finished code flow for this address is moot now.
    this.db.run(`DELETE FROM email_challenges WHERE email = ?`, [normalizedEmail])

    const session = this.sessions.createSession(userId)
    ctx.sessionCookie = sess.createCookie(session)
    ctx.outboundEmailChallengeCookie = null

    return {verified: true, userId}
  }

  /**
   * Add the authenticated user's password credential.
   */
  async addPassword(req: api.AddPasswordRequest, ctx: api.ServerContext): Promise<api.AddPasswordResponse> {
    // Accept a browser cookie session or a daemon secret-credential bearer.
    const access = this.requireVaultAccess(ctx)

    if (!req.wrappedDEK || !req.authKey || !req.salt) {
      throw new APIError('Missing required fields', 400)
    }

    const user = this.db.query<User, [string]>(`SELECT * FROM users WHERE id = ?`).get(access.userId)
    if (!user) {
      throw new APIError('User not found', 404)
    }

    const existing = this.db
      .query<{id: string}, [string, string]>(`SELECT id FROM credentials WHERE user_id = ? AND type = ?`)
      .get(access.userId, 'password')

    if (existing) {
      throw new APIError('Password already set', 409)
    }

    const metadata: PasswordMetadata = {
      authHash: await hashPasswordAuthKey(base64.decode(req.authKey), req.salt),
      salt: req.salt,
    }

    this.db.run(
      `INSERT INTO credentials (id, user_id, type, encrypted_dek, metadata, create_time) VALUES (?, ?, ?, ?, ?, ?)`,
      [sess.randomId(), access.userId, 'password', base64.decode(req.wrappedDEK), JSON.stringify(metadata), Date.now()],
    )

    return {success: true}
  }

  /**
   * Change the authenticated user's password credential.
   */
  async changePassword(req: api.ChangePasswordRequest, ctx: api.ServerContext): Promise<api.ChangePasswordResponse> {
    // Accept a browser cookie session or a daemon secret-credential bearer.
    const access = this.requireVaultAccess(ctx)

    if (!req.wrappedDEK || !req.authKey || !req.salt) {
      throw new APIError('Missing required fields', 400)
    }

    const user = this.db.query<User, [string]>(`SELECT * FROM users WHERE id = ?`).get(access.userId)
    if (!user) {
      throw new APIError('User not found', 404)
    }

    const existing = this.db
      .query<{id: string}, [string, string]>(`SELECT id FROM credentials WHERE user_id = ? AND type = ?`)
      .get(access.userId, 'password')

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
    if (req.purpose !== undefined && req.purpose !== 'recovery') {
      throw new APIError('Invalid credential purpose', 400)
    }

    const user = this.db.query<User, [string]>(`SELECT * FROM users WHERE id = ?`).get(session.user_id)
    if (!user) {
      throw new APIError('User not found', 404)
    }

    const authKey = decodeBase64UrlOrThrow(req.authKey, 'authKey')
    const wrappedDEK = decodeBase64UrlOrThrow(req.wrappedDEK, 'wrappedDEK')
    const metadata: SecretMetadata = {
      authHash: hashSecretAuthKey(authKey),
      ...(req.purpose ? {purpose: req.purpose} : {}),
    }

    const credentialId = sess.randomId()
    // One transaction, so a failed insert can't leave the user without their old recovery words.
    this.db.transaction(() => {
      if (req.purpose === 'recovery') {
        // New recovery words supersede the old ones, which must stop working.
        this.db.run(
          `DELETE FROM credentials WHERE user_id = ? AND type = 'secret' AND json_extract(metadata, '$.purpose') = 'recovery'`,
          [session.user_id],
        )
      }
      this.db.run(
        `INSERT INTO credentials (id, user_id, type, encrypted_dek, metadata, create_time) VALUES (?, ?, ?, ?, ?, ?)`,
        [credentialId, session.user_id, 'secret', wrappedDEK, JSON.stringify(metadata), Date.now()],
      )
    })()

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

  async loginRecovery(req: api.LoginRecoveryRequest, ctx: api.ServerContext): Promise<api.LoginRecoveryResponse> {
    if (!req.email || !req.authKey) {
      throw new APIError('Email and authKey required', 400)
    }

    const user = this.db.query<User, [string]>(`SELECT * FROM users WHERE email = ?`).get(req.email.toLowerCase())
    if (!user) {
      throw new APIError('Invalid credentials', 401)
    }

    const providedHash = sha256Hash(decodeBase64UrlOrThrow(req.authKey, 'authKey'))
    const candidates = this.db
      .query<Credential, [string]>(
        `SELECT * FROM credentials WHERE user_id = ? AND type = 'secret' AND json_extract(metadata, '$.purpose') = 'recovery'`,
      )
      .all(user.id)

    const credential = candidates.find((candidate) => {
      if (!candidate.metadata) return false
      const metadata = JSON.parse(candidate.metadata) as SecretMetadata
      return timingSafeEqual(providedHash, base64.decode(metadata.authHash))
    })
    if (!credential) {
      throw new APIError('Invalid credentials', 401)
    }

    const session = this.sessions.createSession(user.id)
    ctx.sessionCookie = sess.createCookie(session)

    return {
      success: true,
      userId: user.id,
      credentialId: credential.id,
    }
  }

  async getVault(req: api.GetVaultRequest, ctx: api.ServerContext): Promise<api.GetVaultResponse> {
    const knownVersion = req.knownVersion
    if (knownVersion !== undefined && (!Number.isInteger(knownVersion) || knownVersion < 0)) {
      throw new APIError('Invalid knownVersion', 400)
    }

    const access = this.requireVaultAccess(ctx)
    const user = this.db
      .query<Pick<User, 'email' | 'encrypted_data' | 'version'>, [string]>(
        `SELECT email, encrypted_data, version FROM users WHERE id = ?`,
      )
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

    const recoveryCredential = this.db
      .query<{id: string}, [string]>(
        `SELECT id FROM credentials WHERE user_id = ? AND type = 'secret' AND json_extract(metadata, '$.purpose') = 'recovery'`,
      )
      .get(user.id)

    return {
      authenticated: true,
      relyingPartyOrigin: this.rp.origin,
      userId: user.id,
      email: user.email,
      credentials: {
        ...(passwordCredential ? {password: true} : {}),
        ...(passkeyCredential ? {passkey: true} : {}),
        ...(recoveryCredential ? {recoveryWords: true} : {}),
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
    // Accept either a browser cookie session or a daemon secret-credential
    // bearer. For the bearer flow there is no cookie, so the binding is returned
    // to the caller (which must send it back on verify).
    const access = this.requireVaultAccess(ctx)
    const isDaemon = !!ctx.bearerAuth

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
    const user = this.db.query<User, [string]>(`SELECT * FROM users WHERE id = ?`).get(access.userId)

    if (!user) {
      throw new APIError('User not found', 404)
    }

    const now = Date.now()
    const existingChallenge = this.db
      .query<Pick<Challenge, 'create_time'>, [string, number]>(
        `SELECT create_time FROM email_challenges WHERE email = ? AND expire_time > ?`,
      )
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

    if (isDaemon) {
      // No browser cookie available; hand the binding back to the daemon, which
      // must present it on verify (same anti-phishing guarantee as the cookie).
      return {
        message: 'Verification code sent to new email',
        expireTime,
        resendAllowedTime,
        binding,
      }
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

    // Daemon bearer flow carries the binding in the request instead of a cookie.
    if (ctx.bearerAuth) {
      return this.changeEmailVerifyDaemon(req, ctx)
    }

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

  /**
   * Daemon/bearer variant of email-change verify. The binding (returned by
   * changeEmailStart) is supplied in the request instead of an httpOnly cookie.
   * Mirrors the browser verify checks: same binding-hash + code-hash validation,
   * attempt limiting, and availability re-check.
   */
  private async changeEmailVerifyDaemon(
    req: api.ChangeEmailVerifyRequest,
    ctx: api.ServerContext,
  ): Promise<api.ChangeEmailVerifyResponse> {
    const access = this.requireSecretCredentialAccess(ctx.bearerAuth!)
    if (!req.binding || typeof req.binding !== 'string') {
      throw new APIError('Verification binding required', 400)
    }
    const binding = req.binding

    const user = this.db.query<User, [string]>(`SELECT * FROM users WHERE id = ?`).get(access.userId)
    if (!user) {
      throw new APIError('User not found', 404)
    }

    this.cleanupExpiredChallenges()

    const challengeRow = this.db
      .query<Challenge, [string, number]>(`SELECT * FROM email_challenges WHERE email = ? AND expire_time > ?`)
      .get(user.email, Date.now())

    if (
      !challengeRow ||
      challengeRow.new_email === null ||
      !timingSafeEqual(base64.decode(challengeRow.binding_hash), hashEmailBinding(binding))
    ) {
      throw new APIError('Invalid or expired verification code', 400)
    }

    const normalizedNewEmail = normalizeEmail(challengeRow.new_email)
    const expectedCodeHash = base64.decode(challengeRow.code_hash)
    const providedCodeHash = hashEmailCode(binding, req.code, user.email, normalizedNewEmail)
    if (!timingSafeEqual(providedCodeHash, expectedCodeHash)) {
      const attempts = challengeRow.attempt_count + 1
      if (attempts >= EMAIL_CODE_MAX_ATTEMPTS) {
        this.db.run(`DELETE FROM email_challenges WHERE email = ?`, [user.email])
      } else {
        this.db.run(`UPDATE email_challenges SET attempt_count = ? WHERE email = ?`, [attempts, user.email])
      }
      throw new APIError('Invalid or expired verification code', 400)
    }

    const existingUser = this.db
      .query<{id: string}, [string, string]>(`SELECT id FROM users WHERE email = ? AND id != ?`)
      .get(normalizedNewEmail, access.userId)

    if (existingUser) {
      this.db.run(`DELETE FROM email_challenges WHERE email = ?`, [user.email])
      throw new APIError('Email already in use', 409)
    }

    this.db.run(`UPDATE users SET email = ? WHERE id = ?`, [normalizedNewEmail, access.userId])
    this.db.run(`DELETE FROM email_challenges WHERE email = ?`, [user.email])

    return {
      verified: true,
      newEmail: normalizedNewEmail,
    }
  }

  /** Returns the current vault user email. Accepts bearer or cookie auth. */
  async getVaultEmail(ctx: api.ServerContext): Promise<api.GetVaultEmailResponse> {
    const access = this.requireVaultAccess(ctx)
    const user = this.db.query<User, [string]>(`SELECT * FROM users WHERE id = ?`).get(access.userId)
    if (!user) {
      throw new APIError('User not found', 404)
    }
    return {email: user.email}
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
      .query<Credential, [string, string]>(
        `SELECT * FROM credentials WHERE user_id = ? AND type = ? AND encrypted_dek IS NOT NULL`,
      )
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
