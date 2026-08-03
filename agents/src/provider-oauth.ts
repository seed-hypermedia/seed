/**
 * Server-side OAuth login flows for subscription-authenticated model providers.
 *
 * Currently one flow exists: OpenAI "Sign in with ChatGPT" (the Codex CLI
 * OAuth client), implemented by pi-ai's `loginOpenAICodex`. That helper runs a
 * PKCE authorization-code flow against auth.openai.com and races two ways of
 * receiving the authorization code:
 *
 *  - a loopback HTTP listener on 127.0.0.1:1455 (`http://localhost:1455/auth/callback`
 *    is the registered redirect URI), which works when the agents server runs on
 *    the same machine as the user's browser (the desktop-spawned server), and
 *  - manually submitted input (the user pastes the redirect URL from the stuck
 *    browser tab), which covers remote servers where the loopback redirect
 *    cannot reach us.
 *
 * This module owns the pending-login state machine between the signed API
 * actions (`StartProviderOAuth` / `SubmitProviderOAuthCode` /
 * `GetProviderOAuthStatus` / `CancelProviderOAuth`) and that login helper. It is
 * storage-agnostic: the caller persists the resulting credentials and returns
 * the secret name clients should reference.
 */
import {loginOpenAICodex, type OAuthCredentials} from '@mariozechner/pi-ai/oauth'
import type {AuthStorageBackend} from '@mariozechner/pi-coding-agent'

export type OAuthLoginFn = (options: {
  onAuth: (info: {url: string; instructions?: string}) => void
  onPrompt: (prompt: {message: string}) => Promise<string>
  onManualCodeInput: () => Promise<string>
}) => Promise<OAuthCredentials>

/** Provider types that support subscription (OAuth) authentication. */
export const OAUTH_PROVIDER_TYPES = ['openai'] as const

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
      openai: (options) => loginOpenAICodex(options),
      ...loginFns,
    }
  }

  /**
   * Starts a login flow for the account. Resolves once the authorization URL is
   * known (the browser can then be opened). Any previous pending login for the
   * same account is canceled — the loopback listener is a single shared port,
   * and one login per account is all the UI can drive anyway.
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
    // If the flow has not asked for a code yet it is blocked on the loopback
    // listener; mark the login failed now so clients see the outcome immediately.
    // The eventual flow rejection is absorbed by #finish's status guard.
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
 * Pi `AuthStorage` backend holding one account's OAuth credentials in memory
 * and writing every change back through a persist callback (the encrypted
 * secret store). Pi refreshes expired access tokens through this backend's
 * locks, so refreshed/rotated tokens survive server restarts. Async access is
 * serialized in-process — the instance is shared per account+secret so
 * concurrent sessions cannot race a refresh against each other.
 */
export class PersistedOAuthBackend implements AuthStorageBackend {
  #value: string
  #persist: (json: string) => Promise<void>
  #queue: Promise<unknown> = Promise.resolve()

  constructor(initialJson: string, persist: (json: string) => Promise<void>) {
    this.#value = initialJson
    this.#persist = persist
  }

  withLock<T>(fn: (current: string | undefined) => {result: T; next?: string}): T {
    const {result, next} = fn(this.#value)
    if (next !== undefined) {
      this.#value = next
      void this.#persistSafe(next)
    }
    return result
  }

  async withLockAsync<T>(fn: (current: string | undefined) => Promise<{result: T; next?: string}>): Promise<T> {
    const run = this.#queue.then(async () => {
      const {result, next} = await fn(this.#value)
      if (next !== undefined) {
        this.#value = next
        await this.#persistSafe(next)
      }
      return result
    })
    this.#queue = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  #persistSafe(json: string): Promise<void> {
    return this.#persist(json).catch((error) => {
      console.error('[agents] Failed to persist refreshed OAuth credentials:', error)
    })
  }
}
