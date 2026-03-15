import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server'
import type {Account} from '@shm/shared/client/.generated/documents/v3alpha/documents_pb'

/**
 * Pure service method definition without transport-specific concerns.
 * This serves as the source of truth for both client and server types.
 */
export interface ServiceDefinition {
  // Auth.
  preLogin(req: PreLoginRequest): Promise<PreLoginResponse>
  registerStart(req: RegisterStartRequest): Promise<RegisterStartResponse>
  registerPoll(req: RegisterPollRequest): Promise<RegisterPollResponse>
  registerVerifyLink(req: RegisterVerifyLinkRequest): Promise<RegisterVerifyLinkResponse>
  addPassword(req: AddPasswordRequest): Promise<AddPasswordResponse>
  changePassword(req: ChangePasswordRequest): Promise<ChangePasswordResponse>
  login(req: LoginRequest): Promise<LoginResponse>
  logout(): Promise<LogoutResponse>
  getSession(): Promise<GetSessionResponse>
  getAccount(req: GetAccountRequest): Promise<GetAccountResponse>
  getConfig(): Promise<GetConfigResponse>

  // Vault updates.
  getVault(): Promise<GetVaultResponse>
  saveVaultData(req: SaveVaultDataRequest): Promise<SaveVaultDataResponse>

  // Email change.
  changeEmailStart(req: ChangeEmailStartRequest): Promise<ChangeEmailStartResponse>
  changeEmailPoll(req: ChangeEmailPollRequest): Promise<ChangeEmailPollResponse>
  changeEmailVerifyLink(req: ChangeEmailVerifyLinkRequest): Promise<ChangeEmailVerifyLinkResponse>

  // WebAuthn.
  webAuthnRegisterStart(): Promise<WebAuthnRegisterStartResponse>
  webAuthnRegisterComplete(req: WebAuthnRegisterCompleteRequest): Promise<WebAuthnRegisterCompleteResponse>
  webAuthnLoginStart(req: WebAuthnLoginStartRequest): Promise<WebAuthnLoginStartResponse>
  webAuthnLoginComplete(req: WebAuthnLoginCompleteRequest): Promise<WebAuthnLoginCompleteResponse>
  webAuthnVaultStore(req: WebAuthnVaultStoreRequest): Promise<WebAuthnVaultStoreResponse>
}

// Pre-login.
export type PreLoginRequest = {
  email: string
}
export type PreLoginResponse = {
  exists: boolean
  hasPassword?: boolean
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

// Register poll - called by the original device to check if magic link was clicked.
export type RegisterPollRequest = {
  challengeId: string
}
export type RegisterPollResponse = {
  verified: boolean
  userId?: string
}

// Register verify link - called when user clicks the magic link.
export type RegisterVerifyLinkRequest = {
  challengeId: string
  token: string
}
export type RegisterVerifyLinkResponse = {
  verified: boolean
  email: string
}

// Add password.
export type AddPasswordRequest = {
  encryptedDEK: string
  authKey: string
  salt: string
}
export type AddPasswordResponse = {
  success: boolean
}

// Login.
export type LoginRequest = {
  email: string
  authKey: string
}
export type LoginResponse = {
  success: boolean
  userId: string
}

// Get vault.
export type PasswordVaultCredential = {
  kind: 'password'
  salt: string
  wrappedDEK: string
}

export type PasskeyVaultCredential = {
  kind: 'passkey'
  credentialId: string
  wrappedDEK: string
}

export type VaultCredential = PasswordVaultCredential | PasskeyVaultCredential

export type GetVaultResponse = {
  encryptedData?: string
  version?: number
  credentials: VaultCredential[]
}

// Save vault data.
export type SaveVaultDataRequest = {
  encryptedData: string
  version: number
}
export type SaveVaultDataResponse = {
  success: boolean
}

// Get session.
export type GetSessionResponse = {
  authenticated: boolean
  relyingPartyOrigin: string
  userId?: string
  email?: string
  hasPassword?: boolean
  hasPasskeys?: boolean
}

// Get account.
export type GetAccountRequest = {
  id: string
}
export type GetAccountResponse = Account

// Get frontend config.
export type GetConfigResponse = {
  backendHttpBaseUrl: string
}

// Change email start - initiates email change verification.
export type ChangeEmailStartRequest = {
  newEmail: string
}
export type ChangeEmailStartResponse = {
  message: string
  challengeId: string
}

// Change email poll - check if verification link was clicked.
export type ChangeEmailPollRequest = {
  challengeId: string
}
export type ChangeEmailPollResponse = {
  verified: boolean
  newEmail?: string
}

// Change email verify link - called when user clicks magic link.
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

// WebAuthn register start response.
export type WebAuthnRegisterStartResponse = PublicKeyCredentialCreationOptionsJSON

// WebAuthn register complete.
export type WebAuthnRegisterCompleteRequest = {
  response: RegistrationResponseJSON
}
export type WebAuthnRegisterCompleteResponse = {
  success: boolean
  credentialId: string
  backupEligible: boolean
  backupState: boolean
  prfEnabled: boolean
}

// WebAuthn login start.
export type WebAuthnLoginStartRequest = {
  email?: string
}
export type WebAuthnLoginStartResponse = PublicKeyCredentialRequestOptionsJSON & {
  userId?: string
}

// WebAuthn login complete.
export type WebAuthnLoginCompleteRequest = {
  response: AuthenticationResponseJSON
}
export type WebAuthnLoginCompleteResponse = {
  success: boolean
  userId: string
}

// WebAuthn vault store.
export type WebAuthnVaultStoreRequest = {
  credentialId: string
  encryptedDEK: string
}
export type WebAuthnVaultStoreResponse = {
  success: boolean
}

// Change password.
export type ChangePasswordRequest = {
  encryptedDEK: string
  authKey: string
  salt: string
}
export type ChangePasswordResponse = {
  success: boolean
}

/**
 * Server-side request context containing session info from cookies.
 * Mutable: handlers can set `sessionCookie` to control cookie behavior.
 * - `sessionCookie: undefined` - don't touch the session (default).
 * - `sessionCookie: string` - set the session cookie.
 * - `sessionCookie: null` - clear the session cookie.
 */
export interface ServerContext {
  readonly sessionId: string | null
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
