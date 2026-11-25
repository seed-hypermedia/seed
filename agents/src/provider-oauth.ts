/**
 * Server-side OAuth login flows for subscription-authenticated model providers.
 *
 * Currently one flow exists: OpenAI "Sign in with ChatGPT" (the Codex CLI OAuth
 * client). The client's registered redirect URI is fixed at
 * `http://localhost:1455/auth/callback` — localhost of the machine running the
 * user's *browser*, which is not the agents server for remote deployments. The
 * server therefore never binds a loopback listener: it builds the PKCE
 * authorization URL, hands it to the client, and waits for the authorization
 * code to come back through the signed `SubmitProviderOAuthCode` action. The
 * desktop app catches the browser redirect on the user's own 1455 and submits
 * the redirect URL; users without that helper paste the URL manually.
 *
 * This module owns the pending-login state machine between the signed API
 * actions (`StartProviderOAuth` / `SubmitProviderOAuthCode` /
 * `GetProviderOAuthStatus` / `CancelProviderOAuth`) and the login flow. It is
 * storage-agnostic: the caller persists the resulting credentials and returns
 * the secret name clients should reference.
 */
import type * as piAi from '@earendil-works/pi-ai'

type OAuthCredentials = piAi.OAuthCredentials

export type OAuthLoginFn = (options: {
  onAuth: (info: {url: string; instructions?: string}) => void
  onPrompt: (prompt: {message: string}) => Promise<string>
  onManualCodeInput: () => Promise<string>
}) => Promise<OAuthCredentials>

/** Provider types that support subscription (OAuth) authentication. */
export const OAUTH_PROVIDER_TYPES = ['openai'] as const

// OpenAI "Sign in with ChatGPT" uses the official Codex CLI OAuth client; the
// ChatGPT-subscription entitlement is tied to this client id, and its only
// registered redirect URI is localhost:1455 (the user's machine, not ours).
const OPENAI_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const OPENAI_AUTHORIZE_URL = 'https://auth.openai.com/oauth/authorize'
const OPENAI_TOKEN_URL = 'https://auth.openai.com/oauth/token'
const OPENAI_REDIRECT_URI = 'http://localhost:1455/auth/callback'
const OPENAI_SCOPE = 'openid profile email offline_access'
const OPENAI_JWT_CLAIM_PATH = 'https://api.openai.com/auth'

function base64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url')
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return bytes
}

/** Accepts a full redirect URL, a query string, `code#state`, or a bare code. */
export function parseAuthorizationInput(input: string): {code?: string; state?: string} {
  const value = input.trim()
  if (!value) return {}
  try {
    const url = new URL(value)
    return {
      code: url.searchParams.get('code') ?? undefined,
      state: url.searchParams.get('state') ?? undefined,
    }
  } catch {
    // not a URL
  }
  if (value.includes('#')) {
    const [code, state] = value.split('#', 2)
    return {code, state}
  }
  if (value.includes('code=')) {
    const params = new URLSearchParams(value)
    return {
      code: params.get('code') ?? undefined,
      state: params.get('state') ?? undefined,
    }
  }
  return {code: value}
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    return JSON.parse(Buffer.from(parts[1] ?? '', 'base64url').toString('utf8'))
  } catch {
    return null
  }
}

function chatgptAccountId(accessToken: string): string | null {
  const payload = decodeJwtPayload(accessToken)
  const auth = payload?.[OPENAI_JWT_CLAIM_PATH] as {chatgpt_account_id?: unknown} | undefined
  const accountId = auth?.chatgpt_account_id
  return typeof accountId === 'string' && accountId.length > 0 ? accountId : null
}

/**
 * OpenAI Codex PKCE login without a loopback listener: announce the
 * authorization URL, wait for the redirect URL / code to arrive through
 * `SubmitProviderOAuthCode`, then exchange it for tokens. The credential shape
 * matches pi-ai's `OAuthCredentials`, so Pi's openai-codex provider and its
 * token refresh consume the result unchanged.
 */
export const loginOpenAICodexHeadless: OAuthLoginFn = async (options) => {
  const verifier = base64url(randomBytes(32))
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))))
  const state = Buffer.from(randomBytes(16)).toString('hex')

  const url = new URL(OPENAI_AUTHORIZE_URL)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', OPENAI_CLIENT_ID)
  url.searchParams.set('redirect_uri', OPENAI_REDIRECT_URI)
  url.searchParams.set('scope', OPENAI_SCOPE)
  url.searchParams.set('code_challenge', challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('state', state)
  url.searchParams.set('id_token_add_organizations', 'true')
  url.searchParams.set('codex_cli_simplified_flow', 'true')
  url.searchParams.set('originator', 'pi')
  options.onAuth({url: url.toString(), instructions: 'Complete the sign-in in your browser to finish.'})

  const input = await options.onManualCodeInput()
  const parsed = parseAuthorizationInput(input)
  if (parsed.state && parsed.state !== state) throw new Error('State mismatch')
  if (!parsed.code) throw new Error('Missing authorization code')

  const response = await fetch(OPENAI_TOKEN_URL, {
    method: 'POST',
    headers: {'Content-Type': 'application/x-www-form-urlencoded'},
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: OPENAI_CLIENT_ID,
      code: parsed.code,
      code_verifier: verifier,
      redirect_uri: OPENAI_REDIRECT_URI,
    }),
  })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    console.error('[agents/oauth] openai code->token failed:', response.status, text)
    throw new Error('Token exchange failed')
  }
  const json = (await response.json()) as {access_token?: string; refresh_token?: string; expires_in?: number}
  if (!json.access_token || !json.refresh_token || typeof json.expires_in !== 'number') {
    throw new Error('Token response missing fields')
  }
  const accountId = chatgptAccountId(json.access_token)
  if (!accountId) throw new Error('Failed to extract accountId from token')
  return {
    access: json.access_token,
    refresh: json.refresh_token,
    expires: Date.now() + json.expires_in * 1000,
    accountId,
  }
}

/**
 * pi-ai `OAuthAuth` for the stored ChatGPT sign-in. `Models.getAuth()` calls `refresh` under the
 * credential store's lock when the access token expired, and `toAuth` to turn whatever credential
 * ends up stored into the bearer token the Codex backend expects. Interactive login never runs
 * through here: the signed `StartProviderOAuth` flow above owns it.
 */
export const openaiCodexSubscriptionAuth: piAi.OAuthAuth = {
  name: 'OpenAI (ChatGPT subscription)',
  isSubscription: true,
  login: async () => {
    throw new Error('Sign in through the model provider settings')
  },
  refresh: async (credential, signal) => {
    const response = await fetch(OPENAI_TOKEN_URL, {
      method: 'POST',
      headers: {'Content-Type': 'application/x-www-form-urlencoded'},
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: credential.refresh,
        client_id: OPENAI_CLIENT_ID,
      }),
      signal,
    })
    if (!response.ok) throw new Error(`OpenAI token refresh failed: HTTP ${response.status}`)
    const json = (await response.json()) as {access_token?: string; refresh_token?: string; expires_in?: number}
    if (!json.access_token || !json.refresh_token || typeof json.expires_in !== 'number') {
      throw new Error('OpenAI token refresh response is missing fields')
    }
    return {
      ...credential,
      access: json.access_token,
      refresh: json.refresh_token,
      expires: Date.now() + json.expires_in * 1000,
      accountId: chatgptAccountId(json.access_token) ?? credential.accountId,
    }
  },
  toAuth: async (credential) => ({apiKey: credential.access}),
}

const LOGIN_TIMEOUT_MS = 10 * 60 * 1000
/** Finished logins stay queryable for this long so a polling client sees the outcome. */
const FINISHED_TTL_MS = 10 * 60 * 1000

export type ProviderOAuthSnapshot = {
  loginId: string
  accountId: string
  providerType: string
  status: 'pending' | 'completed' | 'failed'
  authUrl: string
  secretName?: string
  error?: string
  expiresAt: number
}

type PendingLogin = ProviderOAuthSnapshot & {
  finishedAt?: number
  timeout?: ReturnType<typeof setTimeout>
  /** Resolvers handed to the login flow, settled by SubmitProviderOAuthCode. */
  codeWaiters: Array<{resolve: (code: string) => void; reject: (error: Error) => void}>
  /** Codes submitted before the flow asked for one. */
  queuedCodes: string[]
  /** Rejects all current and future code waiters (cancel/timeout). */
  abortError?: Error
}

export class ProviderOAuthManager {
  #logins = new Map<string, PendingLogin>()
  #loginFns: Record<string, OAuthLoginFn>

  constructor(loginFns?: Partial<Record<string, OAuthLoginFn>>) {
    this.#loginFns = {
      openai: loginOpenAICodexHeadless,
      ...loginFns,
    }
  }

  /**
   * Starts a login flow for the account. Resolves once the authorization URL is
   * known (the browser can then be opened). Any previous pending login for the
   * same account is canceled — one login per account is all the UI can drive.
   */
  async start(
    accountId: string,
    providerType: string,
    onComplete: (credentials: OAuthCredentials) => Promise<string>,
  ): Promise<ProviderOAuthSnapshot> {
    const loginFn = this.#loginFns[providerType]
    if (!loginFn) throw new Error(`Provider type does not support subscription sign-in: ${providerType}`)
    for (const login of this.#logins.values()) {
      if (login.accountId === accountId && login.status === 'pending') this.#abort(login, 'Replaced by a new sign-in')
    }
    this.#sweep()

    const login: PendingLogin = {
      loginId: crypto.randomUUID(),
      accountId,
      providerType,
      status: 'pending',
      authUrl: '',
      expiresAt: Date.now() + LOGIN_TIMEOUT_MS,
      codeWaiters: [],
      queuedCodes: [],
    }
    this.#logins.set(login.loginId, login)
    login.timeout = setTimeout(() => this.#abort(login, 'Sign-in timed out'), LOGIN_TIMEOUT_MS)
    // Bun/Node timers keep the process alive by default; a pending login should not.
    login.timeout.unref?.()

    const authUrlReady = new Promise<string>((resolve, reject) => {
      let settled = false
      const finish = (fn: () => void) => {
        if (settled) return
        settled = true
        fn()
      }
      loginFn({
        onAuth: (info) => {
          login.authUrl = info.url
          finish(() => resolve(info.url))
        },
        onPrompt: () => this.#nextCode(login),
        onManualCodeInput: () => this.#nextCode(login),
      })
        .then(async (credentials) => {
          // A cancel/timeout can land while the browser callback is in flight;
          // a canceled login must not silently store credentials.
          if (login.status !== 'pending') return
          const secretName = await onComplete(credentials)
          this.#finish(login, {status: 'completed', secretName})
        })
        .catch((error) => {
          const message = error instanceof Error ? error.message : String(error)
          this.#finish(login, {status: 'failed', error: message})
          finish(() => reject(new Error(message)))
        })
    })

    await authUrlReady
    return this.#snapshot(login)
  }

  /** Feeds a pasted authorization code (or redirect URL) into a pending login. */
  submitCode(accountId: string, loginId: string, code: string): void {
    const login = this.#get(accountId, loginId)
    if (login.status !== 'pending') throw new Error('Sign-in is no longer pending')
    const waiter = login.codeWaiters.shift()
    if (waiter) waiter.resolve(code)
    else login.queuedCodes.push(code)
  }

  status(accountId: string, loginId: string): ProviderOAuthSnapshot {
    return this.#snapshot(this.#get(accountId, loginId))
  }

  cancel(accountId: string, loginId: string): ProviderOAuthSnapshot {
    const login = this.#get(accountId, loginId)
    if (login.status === 'pending') this.#abort(login, 'Sign-in canceled')
    return this.#snapshot(login)
  }

  #get(accountId: string, loginId: string): PendingLogin {
    const login = this.#logins.get(loginId)
    if (!login || login.accountId !== accountId) throw new Error('Sign-in not found')
    return login
  }

  #nextCode(login: PendingLogin): Promise<string> {
    if (login.abortError) return Promise.reject(login.abortError)
    const queued = login.queuedCodes.shift()
    if (queued !== undefined) return Promise.resolve(queued)
    return new Promise((resolve, reject) => {
      login.codeWaiters.push({resolve, reject})
    })
  }

  /** Rejects the login's code waiters so the underlying flow unwinds and fails. */
  #abort(login: PendingLogin, reason: string): void {
    if (login.status !== 'pending') return
    login.abortError = new Error(reason)
    const waiters = login.codeWaiters.splice(0)
    for (const waiter of waiters) waiter.reject(login.abortError)
    // If the flow has not asked for a code yet, mark the login failed now so
    // clients see the outcome immediately. The eventual flow rejection is
    // absorbed by #finish's status guard.
    this.#finish(login, {status: 'failed', error: reason})
  }

  #finish(login: PendingLogin, outcome: {status: 'completed'; secretName: string} | {status: 'failed'; error: string}) {
    if (login.status !== 'pending') return
    if (login.timeout) clearTimeout(login.timeout)
    login.finishedAt = Date.now()
    if (outcome.status === 'completed') {
      login.status = 'completed'
      login.secretName = outcome.secretName
    } else {
      login.status = 'failed'
      login.error = outcome.error
    }
  }

  #sweep(): void {
    const now = Date.now()
    for (const [id, login] of this.#logins) {
      if (login.finishedAt && now - login.finishedAt > FINISHED_TTL_MS) this.#logins.delete(id)
    }
  }

  #snapshot(login: PendingLogin): ProviderOAuthSnapshot {
    const {loginId, accountId, providerType, status, authUrl, secretName, error, expiresAt} = login
    return {loginId, accountId, providerType, status, authUrl, secretName, error, expiresAt}
  }
}

/**
 * pi-ai `CredentialStore` holding one account's OAuth credential for a single Pi provider in
 * memory and writing every change back through a persist callback (the encrypted secret store).
 * `Models.getAuth()` refreshes expired access tokens inside `modify`, so refreshed/rotated tokens
 * survive server restarts. Writes are serialized in-process — the instance is shared per
 * account+secret so concurrent sessions cannot race a refresh against each other.
 */
export class PersistedOAuthStore implements piAi.CredentialStore {
  readonly #providerId: string
  #credential: piAi.OAuthCredential | undefined
  readonly #persist: (credential: piAi.OAuthCredential) => Promise<void>
  #queue: Promise<unknown> = Promise.resolve()

  constructor(
    providerId: string,
    initial: OAuthCredentials,
    persist: (credential: piAi.OAuthCredential) => Promise<void>,
  ) {
    this.#providerId = providerId
    this.#credential = {...initial, type: 'oauth'}
    this.#persist = persist
  }

  /** Reads the stored credential, possibly expired. */
  async read(providerId: string): Promise<piAi.Credential | undefined> {
    return providerId === this.#providerId ? this.#credential : undefined
  }

  /** Lists the one stored credential without exposing its secret. */
  async list(): Promise<readonly piAi.CredentialInfo[]> {
    return this.#credential ? [{providerId: this.#providerId, type: 'oauth'}] : []
  }

  /** Serialized read-modify-write; a credential `fn` returns is persisted before the next writer runs. */
  modify(
    providerId: string,
    fn: (current: piAi.Credential | undefined) => Promise<piAi.Credential | undefined>,
  ): Promise<piAi.Credential | undefined> {
    const run = this.#queue.then(async () => {
      if (providerId !== this.#providerId) return fn(undefined)
      const next = await fn(this.#credential)
      if (next?.type === 'oauth') {
        this.#credential = next
        await this.#persist(next).catch((error) => {
          console.error('[agents] Failed to persist refreshed OAuth credentials:', error)
        })
      }
      return this.#credential
    })
    this.#queue = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  /** Drops the in-memory credential; the encrypted secret is owned by the caller. */
  async delete(providerId: string): Promise<void> {
    await this.modify(providerId, async () => undefined)
    if (providerId === this.#providerId) this.#credential = undefined
  }
}
