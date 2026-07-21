# ChatGPT (Codex) OAuth in Pi — research notes

Notes for adding official ChatGPT/Codex sign-in support to the agents stack, and for what we should upstream to
`@mariozechner/pi-ai`.

**Headline: this is far less work than the unification plan first assumed.** Pi already implements Codex OAuth
end-to-end. The gap is not "pi can't do this" — it is (a) the Seed agents service never wires pi's OAuth layer to its
own provider model, and (b) pi's login flow is loopback-only, which cannot work on a headless or remote agent server.
(b) is the piece genuinely worth upstreaming, and Seed desktop already has a working implementation of it.

Versions inspected: `@mariozechner/pi-ai` 0.70.6, `pi-coding-agent` 0.70.2.

---

## 1. What pi already has

### OAuth infrastructure — `pi-ai/dist/utils/oauth/`

A complete, pluggable OAuth layer, exported from `@mariozechner/pi-ai/oauth`:

```ts
export interface OAuthProviderInterface {
  readonly id: OAuthProviderId
  readonly name: string
  login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials>
  /** Whether login uses a local callback server and supports manual code input. */
  usesCallbackServer?: boolean
  refreshToken(credentials: OAuthCredentials): Promise<OAuthCredentials>
  getApiKey(credentials: OAuthCredentials): string
  modifyModels?(models: Model<Api>[], credentials: OAuthCredentials): Model<Api>[]
}

export type OAuthCredentials = {refresh: string; access: string; expires: number; [key: string]: unknown}
```

with `registerOAuthProvider()` / `getOAuthProvider(id)` / `unregisterOAuthProvider()`, and a
`getOAuthApiKey(providerId, credentials)` helper that **auto-refreshes expired tokens and hands back both the API key
and the updated credentials to persist**. Built-in providers: `anthropic` (Claude Pro/Max), `github-copilot`,
`google-gemini-cli`, `google-antigravity`, and **`openai-codex`**.

The login callback contract is already the right shape for a device flow:

```ts
export interface OAuthLoginCallbacks {
  onAuth: (info: {url: string; instructions?: string}) => void
  onPrompt: (prompt: OAuthPrompt) => Promise<string>
  onProgress?: (message: string) => void
  onManualCodeInput?: () => Promise<string>
  signal?: AbortSignal
}
```

`onAuth({url, instructions})` can carry "open this URL and enter code `ABCD-1234`" without any interface change.

### Codex specifics — `utils/oauth/openai-codex.ts` + `providers/openai-codex-responses.ts`

- `loginOpenAICodex()`, `refreshOpenAICodexToken()`, `openaiCodexOAuthProvider`.
- Same public client ID Seed desktop uses: `app_EMoamEEZ73f0CkXaXp7hrann`.
- Endpoints: `https://auth.openai.com/oauth/authorize`, `https://auth.openai.com/oauth/token`,
  `https://api.openai.com/auth`.
- Extracts `chatgpt_account_id` from the `id_token` claims (`getAccountId(...)`), and the request path already sets the
  `chatgpt-account-id` header, `instructions`, `store: false`, and an `originator` parameter.
- Registered as a distinct API, `openai-codex-responses`, with Codex-flavored options (`reasoningEffort`,
  `reasoningSummary`, `serviceTier`, `textVerbosity`).

**Everything `frontend/apps/desktop/src/chat-provider-options.ts` hand-rolls — `instructions` instead of a system
message, `systemMessageMode: 'remove'`, `store: false` — pi does natively.** Our desktop implementation is a subset of
pi's, not a superset. The only thing we have that pi does not is the login transport.

## 2. The one real gap: login transport

`openai-codex.d.ts` says it outright:

> NOTE: This module uses Node.js crypto and http for the OAuth callback. It is only intended for CLI use, not browser
> environments.

Pi's flow is the standard Codex CLI **loopback redirect**: bind `http://localhost:1455/auth/callback`, open the
browser, catch the redirect, exchange the code. That assumes *the browser and the agent runtime are the same machine.*

That assumption holds for a local agent server spawned by the desktop app. It breaks for:

- the hosted `agentic.seed.hyper.media` server — the browser is on the user's laptop, port 1455 is on the server;
- the Docker image (`agents/Dockerfile`) — nothing to open a browser with;
- any remote/SSH/VM deployment;
- possibly a sandboxed Electron child process, where binding a fixed port is unreliable.

Since a first-class Seed agent server is meant to run *anywhere*, loopback-only login is a real limitation.

## 3. What Seed already built: device authorization

`frontend/apps/desktop/src/app-ai-config.ts` implements a **device authorization flow** against undocumented but
working OpenAI endpoints — no local server, no browser on the same host:

| Constant                            | Value                                                       |
| ----------------------------------- | ----------------------------------------------------------- |
| `OPENAI_DEVICE_AUTH_USER_CODE_URL`  | `https://auth.openai.com/api/accounts/deviceauth/usercode`  |
| `OPENAI_DEVICE_AUTH_TOKEN_URL`      | `https://auth.openai.com/api/accounts/deviceauth/token`     |
| `OPENAI_DEVICE_AUTH_BROWSER_URL`    | `https://auth.openai.com/codex/device`                      |
| `OPENAI_DEVICE_AUTH_REDIRECT_URI`   | `https://auth.openai.com/deviceauth/callback`               |
| `OPENAI_CLIENT_ID`                  | `app_EMoamEEZ73f0CkXaXp7hrann` (same as pi)                 |

Sequence (`requestOpenAIDeviceCode` → `pollOpenAIDeviceAuthorizationCode` → `exchangeAuthorizationCode`):

1. `POST /api/accounts/deviceauth/usercode` `{client_id}` → `{user_code, device_auth_id, interval}`.
   Note the response has been seen with both `user_code` and `usercode` spellings — our code tolerates both.
2. Show the user `user_code` and tell them to visit `https://auth.openai.com/codex/device`.
3. Poll `POST /api/accounts/deviceauth/token` `{device_auth_id, user_code}` every `interval` seconds.
   **403 and 404 both mean "not authorized yet" — keep polling**, they are not failures.
4. On 200 → `{authorization_code, code_verifier}`. The server generates the PKCE verifier and hands it back, so the
   client does not generate the challenge itself.
5. `POST /oauth/token` with `grant_type=authorization_code`, `code`, `code_verifier`,
   `redirect_uri=https://auth.openai.com/deviceauth/callback`, `client_id` → `{id_token, access_token, refresh_token}`.
6. Refresh via `grant_type=refresh_token` (we re-run every 8 minutes; OpenAI access tokens are short-lived).
7. `id_token` claims carry the ChatGPT account ID and plan type — pi's `getAccountId()` already parses the same claim.

Wrapped in `withOpenAINetworkRetry(fn, 3)` with a 15-minute overall login timeout.

## 4. Proposed upstream change to pi

Add device authorization as a **second login strategy** on the existing Codex provider. Deliberately additive — no
behavior change for existing CLI users.

### 4.1 Interface

`OAuthProviderInterface` already has `usesCallbackServer?: boolean`. Add an optional sibling:

```ts
export interface OAuthProviderInterface {
  // ...existing
  /** Login without a local callback server (device authorization). Usable headless/remote. */
  loginDevice?(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials>
  /** True when loginDevice is implemented. */
  supportsDeviceLogin?: boolean
}
```

Callers pick: use `loginDevice` when there is no local browser (headless, container, remote server, or an explicit
`--device` flag), else `login`. No change to `OAuthCredentials`, `getApiKey`, `refreshToken`, or `getOAuthApiKey` — the
device flow terminates at the *same* `/oauth/token` exchange and yields the same credential shape, so everything
downstream is unchanged.

### 4.2 Implementation

New `loginOpenAICodexDevice()` in `utils/oauth/openai-codex.ts`, reusing that module's existing
`exchangeAuthorizationCode` and token parsing. Roughly a direct port of §3, with:

- `onAuth({url: OPENAI_DEVICE_AUTH_BROWSER_URL, instructions: 'Enter code ABCD-1234'})` at step 2;
- `onProgress('Waiting for authorization…')` on each poll;
- `signal` honored in the poll loop (pi's callbacks already carry an `AbortSignal`; our desktop version uses a session
  map + timeout instead, and should adopt the signal);
- treat 403/404 as pending, everything else as fatal;
- honor the server-provided `interval`, and tolerate the `usercode` spelling.

Then `openaiCodexOAuthProvider.loginDevice = loginOpenAICodexDevice` and `supportsDeviceLogin = true`.

`loginOpenAICodex`'s `originator` option (defaults to `"pi"`) should be threaded through the device flow too, so Seed
can identify itself.

### 4.3 Worth raising upstream

- These device endpoints are **undocumented**. They are what the ChatGPT desktop/device sign-in uses, and they work
  today, but they can change without notice. Pi should treat device login as best-effort and fall back to loopback.
  Our own implementation should carry the same warning.
- Same question for Anthropic/Copilot/Gemini: if the interface gains `loginDevice`, the other OAuth providers may want
  equivalents. Ship the interface plus the Codex implementation; leave the rest.
- Ask Mario whether he'd rather see this as `login(callbacks, {transport: 'device' | 'loopback'})` than a second
  method. Either is fine; the method keeps `usesCallbackServer` semantics intact.

## 5. Wiring into the Seed agents service

Independent of upstreaming — worth doing regardless, since pi's loopback flow already works for a **local** agent
server spawned by desktop, which is the unification plan's phase 1 target.

The service's provider model is API-key-only today: `SetModelProvider` stores `ModelProviderConfig {type, baseUrl,
secretRefs}` and `SetSecret` stores an encrypted key. OAuth credentials are a different shape (a refresh/access/expires
triple that mutates on every refresh).

1. **Protocol** (`agents/protocol/src/index.ts`): add `'openai-codex'` as a provider type, plus three actions —
   `StartProviderLogin {provider}` → `{loginId, verificationUrl, userCode}`, `GetProviderLoginStatus {loginId}` →
   `pending | success | error`, `CancelProviderLogin {loginId}`. This shape works for both transports: loopback
   returns a `verificationUrl` with no `userCode`, device returns both. The desktop already has an equivalent
   session-polling pattern in `app-ai-config.ts` (`openaiLoginSessions`) to model it on.
2. **Storage**: persist `OAuthCredentials` as a JSON secret in the existing AES-GCM `secrets` table
   (`secretRefs: {oauth: '<name>-oauth'}`). Refresh writes back through the same path. Never returned by
   `ListModelProviders` — only `hasSecrets`.
3. **Execution** (`api-service.ts` `piModelForDefinition`): when a provider is OAuth-backed, call
   `getOAuthApiKey('openai-codex', creds)` before building the pi model, persist `newCredentials` if it refreshed, and
   select the `openai-codex-responses` api. Pi handles the account-id header and Responses-API semantics.
4. **Desktop UI**: the provider dialog in `pages/agents/dialogs.tsx` gains a "Sign in with ChatGPT" path that renders
   the user code + link and polls status. This replaces the deleted settings flow from
   `pages/settings.tsx`/`app-ai-config.ts`.
5. **Delete**: `chat-provider-options.ts` (39 lines) has no successor — pi does it natively.

## 6. Consequence for the unification plan

`docs/plans/agent-unification.md` §6.1 listed ChatGPT OAuth as the parity gap blocking deletion of
`app-ai-config.ts`. That is now downgraded:

- for a **local** agent server, pi's existing loopback login works as-is — no upstream change needed, so it does not
  block phase 3 deletion;
- **device login is required for the hosted server**, and is a clean, self-contained upstream contribution we already
  have a working reference implementation for;
- roughly 1,100 lines of desktop OAuth code collapse into a provider type plus three protocol actions, because pi owns
  the token lifecycle.
