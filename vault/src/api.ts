import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server'
import type {Account} from '@shm/shared/client/.generated/documents/v3alpha/documents_pb'

/**
 * Vault service definition. Shared source of truth for both client and server types.
 *
 * # End-to-end encryption invariant
 *
 * The server never sees any key that can decrypt vault data. Per-user state
 * stored server-side is limited to:
 *   1. The encrypted vault blob (`encryptedData`).
 *   2. A per-credential wrapped data-encryption key (`wrappedDEK`), encrypted
 *      with a key that only the client holds.
 *   3. Per-credential authentication material — an argon2id hash for passwords,
 *      a SHA-256 hash for secret credentials, attestation data for passkeys.
 *
 * The `authKey` sent by the client is the authentication half of a
 * key-separation derivation. It is sufficient to prove identity but cannot
 * unwrap the DEK on its own. The decryption half never leaves the client.
 *
 * # Authentication rules
 *
 * - Unauthenticated: `preLogin`, `register*`, `login`, `loginPasskey*`,
 *   `getConfig`, `getAccount`.
 * - Session cookie required: `getSession`, `logout`, `changeEmail*`,
 *   `addPasskey*`, `addPassword`,
 *   `changePassword`, `addSecretCredential`.
 * - Session cookie OR bearer (`credentialId:authKey`, secret credential only):
 *   `getVault`, `saveVault`. Bearer wins when both are present. The bearer's
 *   `credentialId` is the credentials-table primary key, so lookup is a single
 *   indexed hit that yields `userId` — no scan and no need to include
 *   `userId` in the URL.
 */
export interface ServiceDefinition {
  // Session and identity.
  preLogin(req: PreLoginRequest): Promise<PreLoginResponse>
  login(req: LoginRequest): Promise<LoginResponse>
  logout(): Promise<LogoutResponse>
  getSession(): Promise<GetSessionResponse>
  getAccount(req: GetAccountRequest): Promise<GetAccountResponse>
  getConfig(): Promise<GetConfigResponse>

  // Email-based registration (magic link).
  registerStart(req: RegisterStartRequest): Promise<RegisterStartResponse>
  registerPoll(req: RegisterPollRequest): Promise<RegisterPollResponse>
  registerVerifyLink(req: RegisterVerifyLinkRequest): Promise<RegisterVerifyLinkResponse>

  // Vault data.
  getVault(req: GetVaultRequest): Promise<GetVaultResponse>
  saveVault(req: SaveVaultRequest): Promise<SaveVaultResponse>

  // Credential management. All operations are scoped to the authenticated user.
  addPassword(req: AddPasswordRequest): Promise<AddPasswordResponse>
  changePassword(req: ChangePasswordRequest): Promise<ChangePasswordResponse>
  addSecretCredential(req: AddSecretCredentialRequest): Promise<AddSecretCredentialResponse>
  addPasskeyStart(): Promise<AddPasskeyStartResponse>
  addPasskeyFinish(req: AddPasskeyFinishRequest): Promise<AddPasskeyFinishResponse>

  // Passkey authentication.
  loginPasskeyStart(req: LoginPasskeyStartRequest): Promise<LoginPasskeyStartResponse>
  loginPasskeyFinish(req: LoginPasskeyFinishRequest): Promise<LoginPasskeyFinishResponse>

  // Email change.
  changeEmailStart(req: ChangeEmailStartRequest): Promise<ChangeEmailStartResponse>
  changeEmailPoll(req: ChangeEmailPollRequest): Promise<ChangeEmailPollResponse>
  changeEmailVerifyLink(req: ChangeEmailVerifyLinkRequest): Promise<ChangeEmailVerifyLinkResponse>
}

// Pre-login.
export type PreLoginRequest = {
  email: string
}
export type PreLoginResponse = {
  exists: boolean
  credentials?: {
    password?: true
    passkey?: true
  }
  salt?: string
}

// Register start.
export type RegisterStartRequest = {
  email: string
}
export type RegisterStartResponse = {
  message: string
  challengeId: string
}

// Register poll — called by the original device to check whether the magic link was clicked.
export type RegisterPollRequest = {
  challengeId: string
}
export type RegisterPollResponse = {
  verified: boolean
  userId?: string
}

// Register verify link — called when the user clicks the magic link.
export type RegisterVerifyLinkRequest = {
  challengeId: string
  token: string
}
export type RegisterVerifyLinkResponse = {
  verified: boolean
  email: string
}

// Add password credential. Fails if the user already has a password.
export type AddPasswordRequest = {
  authKey: string
  salt: string
  wrappedDEK: string
}
export type AddPasswordResponse = {
  success: boolean
}

// Change password credential. Fails if the user does not already have a password.
export type ChangePasswordRequest = {
  authKey: string
  salt: string
  wrappedDEK: string
}
export type ChangePasswordResponse = {
  success: boolean
}

// Add secret credential.
export type AddSecretCredentialRequest = {
  authKey: string
  wrappedDEK: string
}
export type AddSecretCredentialResponse = {
  success: boolean
  credentialId: string
}

// Login (password).
export type LoginRequest = {
  email: string
  authKey: string
}
export type LoginResponse = {
  success: boolean
  userId: string
}

/**
 * A password credential. `wrappedDEK` is encrypted with a key derived via
 * argon2id + HKDF from the user's password. The server never sees the
 * password; it stores only an argon2id hash of the derived `authKey`.
 */
export type PasswordVaultCredential = {
  kind: 'password'
  salt: string
  wrappedDEK: string
}

/**
 * A passkey credential. `wrappedDEK` is encrypted with a key derived from the
 * passkey's PRF extension output. The server never sees PRF output.
 */
export type PasskeyVaultCredential = {
  kind: 'passkey'
  credentialId: string
  wrappedDEK: string
}

/**
 * A secret credential. The credential secret is a random 32-byte value
 * generated client-side. Unlike password credentials, there is no argon2id
 * step because the secret already has full entropy; argon2id would waste CPU
 * without adding security. The client derives two HKDF branches from the
 * secret — an `authKey` sent to the server (SHA-256 hashed at rest), and an
 * `encryptionKey` used locally to wrap the DEK. The server never sees the
 * secret itself.
 */
export type SecretVaultCredential = {
  kind: 'secret'
  credentialId: string
  wrappedDEK: string
}

export type VaultCredential = PasswordVaultCredential | PasskeyVaultCredential | SecretVaultCredential

export type EmailPrevalidation = {
  email: string
  signer: string
  host: string
  sig: string
}

// Get vault.
export type GetVaultRequest = {
  knownVersion?: number
}

export type GetVaultUnchangedResponse = {
  unchanged: true
}

export type GetVaultDataResponse = {
  encryptedData?: string
  version: number
  credentials: VaultCredential[]
  emailPrevalidation?: EmailPrevalidation
}

export type GetVaultResponse = GetVaultUnchangedResponse | GetVaultDataResponse

// Save vault.
export type SaveVaultRequest = {
  encryptedData: string
  version: number
}
export type SaveVaultResponse = {
  success: boolean
}

// Get session.
export type GetSessionResponse = {
  authenticated: boolean
  relyingPartyOrigin: string
  userId?: string
  email?: string
  credentials?: {
    password?: true
    passkey?: true
  }
}

// Get account.
export type GetAccountRequest = {
  id: string
}
export type GetAccountResponse = Account

// Get frontend config.
export type GetConfigResponse = {
  backendHttpBaseUrl: string
  notificationServerUrl: string
}

// Change email start — initiates email change verification.
export type ChangeEmailStartRequest = {
  newEmail: string
}
export type ChangeEmailStartResponse = {
  message: string
  challengeId: string
}

// Change email poll — check if verification link was clicked.
export type ChangeEmailPollRequest = {
  challengeId: string
}
export type ChangeEmailPollResponse = {
  verified: boolean
  newEmail?: string
}

// Change email verify link — called when the user clicks the magic link.
export type ChangeEmailVerifyLinkRequest = {
  challengeId: string
  token: string
}
export type ChangeEmailVerifyLinkResponse = {
  verified: boolean
  newEmail: string
}

// Logout.
export type LogoutResponse = {
  success: boolean
}

// Add passkey — step 1 (WebAuthn creation challenge).
export type AddPasskeyStartResponse = PublicKeyCredentialCreationOptionsJSON

/**
 * Add passkey — step 2 (finalize registration).
 *
 * The client must derive PRF output before calling this endpoint, either from
 * the WebAuthn `create()` ceremony itself or from an immediate browser-only
 * `get()` retry against the newly created credential. The server only persists
 * passkeys that already include a wrapped DEK.
 */
export type AddPasskeyFinishRequest = {
  response: RegistrationResponseJSON
  wrappedDEK: string
}
export type AddPasskeyFinishResponse = {
  success: boolean
  credentialId: string
  backupEligible: boolean
  backupState: boolean
  prfEnabled: boolean
}

// Login with passkey — step 1.
export type LoginPasskeyStartRequest = {
  email?: string
}
export type LoginPasskeyStartResponse = PublicKeyCredentialRequestOptionsJSON & {
  userId?: string
}

// Login with passkey — step 2.
export type LoginPasskeyFinishRequest = {
  response: AuthenticationResponseJSON
}
export type LoginPasskeyFinishResponse = {
  success: boolean
  userId: string
}

/**
 * Server-side request context containing browser session and vault auth data.
 * Mutable: handlers can set `sessionCookie` to control cookie behavior.
 * - `sessionCookie: undefined` — don't touch the session (default).
 * - `sessionCookie: string` — set the session cookie.
 * - `sessionCookie: null` — clear the session cookie.
 */
export interface ServerContext {
  readonly sessionId: string | null
  // Optional secret-credential bearer value extracted from Authorization.
  readonly bearerAuth?: string | null
  sessionCookie?: string | null

  // The raw value of the challenge cookie from the incoming request.
  readonly challengeCookie: string | null
  // Set to a string to send a new challenge cookie, null to clear it.
  outboundChallengeCookie?: string | null
}

/**
 * Client service type: same as ServiceDefinition.
 * Handles transport concerns (fetch, cookies) internally.
 */
export type ClientInterface = ServiceDefinition

/**
 * Server service type: all methods receive mutable context (last param).
 * Methods return plain response; cookie ops are done via ctx mutation.
 */
export type ServerInterface = {
  [K in keyof ServiceDefinition]: ServiceDefinition[K] extends () => Promise<infer R>
    ? (ctx: ServerContext) => Promise<R>
    : ServiceDefinition[K] extends (req: infer Req) => Promise<infer R>
      ? (req: Req, ctx: ServerContext) => Promise<R>
      : never
}
