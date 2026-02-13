import type * as api from "@/api"

export class APIError extends Error {
	constructor(
		message: string,
		public statusCode: number,
	) {
		super(message)
		this.name = "APIError"
	}
}

export class FetchClient implements api.ClientInterface {
	constructor(private baseUrl: string = "") {}

	private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
		const res = await fetch(`${this.baseUrl}${path}`, {
			...options,
			headers: {
				"Content-Type": "application/json",
				...options.headers,
			},
		})

		const data = await res.json()

		if (!res.ok) {
			throw new APIError(data.error || `Request failed`, res.status)
		}

		return data as T
	}

	// ==========================================================================
	// Auth
	// ==========================================================================

	async preLogin(req: api.PreLoginRequest): Promise<api.PreLoginResponse> {
		return this.request("/api/pre-login", {
			method: "POST",
			body: JSON.stringify(req),
		})
	}

	async registerStart(req: api.RegisterStartRequest): Promise<api.RegisterStartResponse> {
		return this.request("/api/register/start", {
			method: "POST",
			body: JSON.stringify(req),
		})
	}

	async registerPoll(req: api.RegisterPollRequest): Promise<api.RegisterPollResponse> {
		return this.request("/api/register/poll", {
			method: "POST",
			body: JSON.stringify(req),
		})
	}

	async registerVerifyLink(req: api.RegisterVerifyLinkRequest): Promise<api.RegisterVerifyLinkResponse> {
		return this.request("/api/register/verify-link", {
			method: "POST",
			body: JSON.stringify(req),
		})
	}

	async addPassword(req: api.AddPasswordRequest): Promise<api.AddPasswordResponse> {
		return this.request("/api/add-password", {
			method: "POST",
			body: JSON.stringify(req),
		})
	}

	async changePassword(req: api.ChangePasswordRequest): Promise<api.ChangePasswordResponse> {
		return this.request("/api/change-password", {
			method: "POST",
			body: JSON.stringify(req),
		})
	}

	async login(req: api.LoginRequest): Promise<api.LoginResponse> {
		return this.request("/api/login", {
			method: "POST",
			body: JSON.stringify(req),
		})
	}

	async getVault(): Promise<api.GetVaultResponse> {
		return this.request("/api/vault", { method: "GET" })
	}

	async saveVaultData(req: api.SaveVaultDataRequest): Promise<api.SaveVaultDataResponse> {
		return this.request("/api/vault", {
			method: "POST",
			body: JSON.stringify(req),
		})
	}

	async logout(): Promise<api.LogoutResponse> {
		return this.request("/api/logout", { method: "POST" })
	}

	async getSession(): Promise<api.GetSessionResponse> {
		return this.request("/api/session", { method: "GET" })
	}

	// ==========================================================================
	// Email Change
	// ==========================================================================

	async changeEmailStart(req: api.ChangeEmailStartRequest): Promise<api.ChangeEmailStartResponse> {
		return this.request("/api/change-email/start", {
			method: "POST",
			body: JSON.stringify(req),
		})
	}

	async changeEmailPoll(req: api.ChangeEmailPollRequest): Promise<api.ChangeEmailPollResponse> {
		return this.request("/api/change-email/poll", {
			method: "POST",
			body: JSON.stringify(req),
		})
	}

	async changeEmailVerifyLink(req: api.ChangeEmailVerifyLinkRequest): Promise<api.ChangeEmailVerifyLinkResponse> {
		return this.request("/api/change-email/verify-link", {
			method: "POST",
			body: JSON.stringify(req),
		})
	}

	// ==========================================================================
	// WebAuthn
	// ==========================================================================

	async webAuthnRegisterStart(): Promise<api.WebAuthnRegisterStartResponse> {
		return this.request("/api/webauthn/register/start", { method: "POST" })
	}

	async webAuthnRegisterComplete(
		req: api.WebAuthnRegisterCompleteRequest,
	): Promise<api.WebAuthnRegisterCompleteResponse> {
		return this.request("/api/webauthn/register/complete", {
			method: "POST",
			body: JSON.stringify(req),
		})
	}

	async webAuthnLoginStart(req: api.WebAuthnLoginStartRequest): Promise<api.WebAuthnLoginStartResponse> {
		return this.request("/api/webauthn/login/start", {
			method: "POST",
			body: JSON.stringify(req),
		})
	}

	async webAuthnLoginComplete(req: api.WebAuthnLoginCompleteRequest): Promise<api.WebAuthnLoginCompleteResponse> {
		return this.request("/api/webauthn/login/complete", {
			method: "POST",
			body: JSON.stringify(req),
		})
	}

	async webAuthnVaultStore(req: api.WebAuthnVaultStoreRequest): Promise<api.WebAuthnVaultStoreResponse> {
		return this.request("/api/webauthn/vault", {
			method: "POST",
			body: JSON.stringify(req),
		})
	}
}
