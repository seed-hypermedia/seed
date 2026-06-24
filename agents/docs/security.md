# Security model

The Agents security model centers on signed account-scoped actions, server-side ownership checks, encrypted/redacted
secrets, and signed WebSocket subscriptions.

## Trust boundaries

- Desktop app ↔ agents server.
- Agents server ↔ model providers.
- Agents server ↔ Seed Hypermedia/content servers.
- Agents server ↔ SQLite storage.
- Desktop renderer ↔ desktop daemon signing API.

## HTTP action authentication

Every HTTP action is a signed `SignedActionEnvelope`:

```ts
{
  type: 'AgentsAction', signer, sig, account, action
}
```

Server verifies the signature and authorizes the signer for the account.

A signer is authorized when:

- `signer === account`; or
- `account_authorizations` has role `OWNER` or `AGENT` for `(account, signer)`.

## WebSocket authentication

The socket receives no private data until it sends a signed `Subscribe` action. The server validates the subscription
key belongs to the signed account.

A socket cannot switch accounts after a successful subscription.

Server-to-client events are not individually signed.

## Account isolation

Account-owned tables include `account_id`:

- model providers;
- secrets;
- agents;
- sessions;
- action idempotency;
- authorizations.

Session events do not store account ID directly; the server verifies ownership through the parent session.

## Secrets

`SetSecret` accepts key bytes, encrypts them, and returns only redacted metadata. `CreateSigningIdentity` generates a
server-side Ed25519 HM account key and stores the raw seed through the same encrypted secret path.
`ListSigningIdentities` only returns redacted metadata for account-scoped secrets tagged with `kind: 'hm-account-key'`;
the plaintext key material is never returned and cross-account keys are not visible.

Desktop refuses to send secrets to non-local plain HTTP servers. Remote servers must use HTTPS.

Do not log:

- plaintext secrets;
- decrypted API keys;
- provider secret config;
- signed request bodies;
- full model prompts/responses;
- full session content;
- large/sensitive tool outputs.

## Secret encryption limitations

Current key storage:

- AES-GCM key lives in `server_config` in the same SQLite DB.

This prevents accidental API/log disclosure but does not protect against full DB compromise.

Future production work should add:

- OS keychain or KMS-backed key storage;
- key rotation;
- secret versioning;
- backup/restore guidance.

## Provider endpoint safety

OpenAI custom `baseUrl` is restricted by `isTrustedOpenAIBaseUrl()`. This prevents arbitrary URL configuration from
exfiltrating API keys. The Pi SDK runner still applies this Seed-owned check before registering an OpenAI provider with
Pi.

Anthropic and Google currently use default Pi/Seed base URLs unless a provider record supplies a custom `baseUrl`;
custom endpoint trust policy for those providers is follow-up hardening work.

Provider-backend additions must include endpoint trust policy.

## `read` safety

The tool accepts HM IDs and web URLs. It may contact external URLs for resolution/fetching.

Important resolver requirement: pasted HM web-domain URLs should be resolved by reusing the existing Seed client
resolver stack (`resolveHypermediaUrl` / `resolveId` / `resolveIdWithClient`). That stack tries a `DomainResolverFn`
first and falls back to OPTIONS-header resolution. The agents Bun service should provide a `DomainResolverFn` backed by
read-only Seed API `GetDomain`, not by duplicating custom URL parsing.

Risks:

- SSRF/private-network access if server runs in sensitive networks;
- model-driven reads of arbitrary web resources;
- large or sensitive tool outputs.

Mitigations already present:

- input validation;
- output size limit;
- durable visible tool events for user-facing tools;
- hidden `set_session_title` is limited to bounded session metadata and cannot overwrite user-authored titles;
- no CLI shellout.

Future mitigations:

- outbound allow/deny policy;
- private-network blocklist;
- audit log;
- per-agent/user tool permissions;
- explicit separation between read-only query keys and future write/action tools;
- audit and least-privilege checks for future signing/publishing tools that consume uploaded HM account keys.

## Web tools safety (`web_search`, `web_read`)

`web_read` fetches model- or user-supplied public web URLs (`agents/src/web-tools.ts`). Both tools are self-hosted and
carry no third-party API keys.

Risks:

- **SSRF / private-network access.** `web_read` performs server-side `fetch` of an arbitrary URL (the static tier) and,
  when configured, has Crawl4AI fetch it (the browser tier). On a host with access to a private network or cloud
  metadata endpoint, a model could request internal addresses. This shares the `read` SSRF concern and is currently
  **unmitigated** beyond requiring `http(s)` scheme. Before exposing these tools on a sensitive network, add a
  private-network/metadata blocklist and an outbound allow/deny policy (tracked with the `read` future mitigations).
- Model-driven retrieval of arbitrary web content into the conversation (prompt-injection surface): treat fetched page
  text as untrusted input, never as instructions.
- Crawl4AI executes a real browser; keep it on the internal network only, never published to the host or internet.

Mitigations present:

- `http`/`https` scheme enforcement and URL validation;
- bounded markdown output (200 KiB, truncated on a byte boundary);
- the Crawl4AI shared token (`SEED_AGENTS_CRAWLER_TOKEN`) gates access to the crawler so only the agents service can use
  it; Crawl4AI 0.9.x is secure-by-default and refuses tokenless non-loopback access;
- per-agent opt-in: web tools are not granted by default and must be enabled per agent in the Tools tab;
- failures degrade to `tool_result.error` (or a `degraded` flag for partial search), never silent fabrication;
- no third-party API keys or outbound calls beyond SearXNG, the target site, and the optional Crawl4AI container.

## MCP server safety

Agents can reach account-configured remote MCP servers (`agents/src/mcp.ts`, see `mcp.md`). Only remote HTTP/SSE
transports are supported; the service never spawns local `stdio` subprocesses.

Risks:

- **SSRF / private-network access.** Connecting to an MCP server is a server-side request to an account-supplied URL,
  sharing the `read`/web-tools SSRF concern. It is currently **unmitigated** beyond `http(s)` scheme enforcement. Add
  the same private-network/metadata blocklist and outbound allow/deny policy before exposing agents on a sensitive
  network.
- **Untrusted tools.** Enabled MCP tools execute during the agent run with whatever capability the remote server grants,
  and their results are untrusted model input (prompt-injection surface). Agent owners should only enable servers they
  trust.

Mitigations present:

- `http`/`https` scheme enforcement and URL validation on every MCP server config;
- auth headers stored as encrypted account secrets, redacted in all responses; the desktop refuses to send a secret
  header to a non-HTTPS remote agent server;
- per-agent opt-in: an agent only loads MCP tools from servers listed in its `mcpServers`, and servers are not enabled
  by default;
- failure isolation: an unreachable MCP server is logged and skipped so the run still proceeds; tool errors degrade to
  `tool_result.error`;
- bounded MCP tool-result size (256 KiB);
- connections are opened at run start and closed when the run finishes.

## Replay protection status

Implemented:

- idempotency for create/message actions with client IDs;
- every signed action carries a signed `action.ts` Unix epoch millisecond timestamp;
- HTTP and WebSocket envelopes are rejected when `action.ts` is missing, invalid, or more than 30 seconds from server
  local time.

Not implemented:

- nonce caching, so a captured request can still be replayed within the 30-second timestamp window.

Nonce caching remains a high-priority hardening project.

## Logging security

Recent diagnostic logs are designed to include:

- account/agent/session IDs;
- partial IDs;
- event counts;
- byte lengths;
- status codes;
- content types;
- durations.

They should not include secret values or full message content. Keep future logs at this level unless doing explicit
local-only debugging.

## Security checklist for new work

For every new action:

1. Verify signature.
2. Verify signer authorization.
3. Normalize inputs at the boundary.
4. Scope DB queries by account ownership.
5. Redact sensitive data.
6. Add unauthorized/cross-account tests.
7. Decide idempotency/replay semantics.
8. Decide WebSocket fanout policy.
9. Update docs.

For every new provider/tool:

1. Define endpoint trust policy.
2. Add or update the canonical registry entry in `agents/protocol/src/tool-registry.ts` so prompt metadata, input
   schema, and rendering metadata are reviewed together.
3. Validate inputs at the runtime boundary.
4. Bound output/response sizes.
5. Avoid sensitive logs.
6. Add tests for missing credentials and provider errors.
7. Update `security.md`, `model-providers.md`, or `tools.md`.
