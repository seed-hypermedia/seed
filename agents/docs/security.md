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
