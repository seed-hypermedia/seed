import type * as api from '@/api'
import {Account} from '@shm/shared/client/.generated/documents/v3alpha/documents_pb'

export class APIError extends Error {
  constructor(
    message: string,
    public statusCode: number,
  ) {
    super(message)
    this.name = 'APIError'
  }
}

export class FetchClient implements api.ClientInterface {
  constructor(private baseUrl: string = '/vault') {}

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    })

    const data = await res.json()

    if (!res.ok) {
      throw new APIError(data.error || `Request failed`, res.status)
    }

    return data as T
  }

  // Session and identity.

  async preLogin(req: api.PreLoginRequest): Promise<api.PreLoginResponse> {
    return this.request('/api/pre-login', {method: 'POST', body: JSON.stringify(req)})
  }

  async login(req: api.LoginRequest): Promise<api.LoginResponse> {
    return this.request('/api/login', {method: 'POST', body: JSON.stringify(req)})
  }

  async logout(): Promise<api.LogoutResponse> {
    return this.request('/api/logout', {method: 'POST'})
  }

  async getSession(): Promise<api.GetSessionResponse> {
    return this.request('/api/session', {method: 'GET'})
  }

  async getAccount(req: api.GetAccountRequest): Promise<api.GetAccountResponse> {
    return Account.fromJson(await this.request(`/api/accounts/${encodeURIComponent(req.id)}`, {method: 'GET'}))
  }

  async getConfig(): Promise<api.GetConfigResponse> {
    return this.request('/api/config', {method: 'GET'})
  }

  // Email-based registration.

  async registerStart(req: api.RegisterStartRequest): Promise<api.RegisterStartResponse> {
    return this.request('/api/register/start', {method: 'POST', body: JSON.stringify(req)})
  }

  async registerPoll(req: api.RegisterPollRequest): Promise<api.RegisterPollResponse> {
    return this.request('/api/register/poll', {method: 'POST', body: JSON.stringify(req)})
  }

  async registerVerifyLink(req: api.RegisterVerifyLinkRequest): Promise<api.RegisterVerifyLinkResponse> {
    return this.request('/api/register/verify-link', {method: 'POST', body: JSON.stringify(req)})
  }

  // Vault data.

  async getVault(req: api.GetVaultRequest = {}): Promise<api.GetVaultResponse> {
    const params = new URLSearchParams()
    if (req.knownVersion !== undefined) {
      params.set('knownVersion', String(req.knownVersion))
    }
    const queryString = params.toString()
    const query = queryString ? `?${queryString}` : ''
    return this.request(`/api/vault${query}`, {method: 'GET'})
  }

  async saveVault(req: api.SaveVaultRequest): Promise<api.SaveVaultResponse> {
    return this.request('/api/vault', {method: 'POST', body: JSON.stringify(req)})
  }

  // Credential management.

  async addPassword(req: api.AddPasswordRequest): Promise<api.AddPasswordResponse> {
    return this.request('/api/credentials/password', {method: 'POST', body: JSON.stringify(req)})
  }

  async changePassword(req: api.ChangePasswordRequest): Promise<api.ChangePasswordResponse> {
    return this.request('/api/credentials/password/change', {method: 'POST', body: JSON.stringify(req)})
  }

  async addSecretCredential(req: api.AddSecretCredentialRequest): Promise<api.AddSecretCredentialResponse> {
    return this.request('/api/credentials/secret', {method: 'POST', body: JSON.stringify(req)})
  }

  async addPasskeyStart(): Promise<api.AddPasskeyStartResponse> {
    return this.request('/api/credentials/passkey/start', {method: 'POST'})
  }

  async addPasskeyFinish(req: api.AddPasskeyFinishRequest): Promise<api.AddPasskeyFinishResponse> {
    return this.request('/api/credentials/passkey/finish', {method: 'POST', body: JSON.stringify(req)})
  }

  // Passkey authentication.

  async loginPasskeyStart(req: api.LoginPasskeyStartRequest): Promise<api.LoginPasskeyStartResponse> {
    return this.request('/api/login/passkey/start', {method: 'POST', body: JSON.stringify(req)})
  }

  async loginPasskeyFinish(req: api.LoginPasskeyFinishRequest): Promise<api.LoginPasskeyFinishResponse> {
    return this.request('/api/login/passkey/finish', {method: 'POST', body: JSON.stringify(req)})
  }

  // Email change.

  async changeEmailStart(req: api.ChangeEmailStartRequest): Promise<api.ChangeEmailStartResponse> {
    return this.request('/api/email-change/start', {method: 'POST', body: JSON.stringify(req)})
  }

  async changeEmailPoll(req: api.ChangeEmailPollRequest): Promise<api.ChangeEmailPollResponse> {
    return this.request('/api/email-change/poll', {method: 'POST', body: JSON.stringify(req)})
  }

  async changeEmailVerifyLink(req: api.ChangeEmailVerifyLinkRequest): Promise<api.ChangeEmailVerifyLinkResponse> {
    return this.request('/api/email-change/verify-link', {method: 'POST', body: JSON.stringify(req)})
  }
}
