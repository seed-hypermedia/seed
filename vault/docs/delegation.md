# Hypermedia Identity Delegation

This document explains how a third-party website can let a user sign in with their Hypermedia identity without ever receiving the user’s long-lived private key.

In one sentence: the website creates a browser-local session key, the Vault signs a delegation capability for that key after user consent, and the website uses that delegated session to act on behalf of the account.

## Why this exists.

A user’s account key is high value and long lived. A third-party site should not be trusted to store or handle that key material.

Delegation solves this by separating identity ownership from session execution:

- The Vault keeps the account key.
- The third-party site holds only an ephemeral session key.
- The account key signs a capability that authorizes that session key.

If a third-party site is compromised, the attacker does not obtain the account private key.

## Actors and trust boundaries.

There are two independent origins:

- **Vault origin.**
  - Hosts account creation, authentication, account key storage, and consent UI.
  - Signs delegation capabilities.
- **Client origin.**
  - Hosts the third-party application.
  - Creates a local session key and performs delegated actions.

The protocol is redirect-based. No server-to-server trust channel is required.

## Core objects.

- **Principal.**
  - A public-key identity representation.
- **Capability blob.**
  - A signed statement that grants authority from an account principal to a delegate principal.
- **Profile blob.**
  - A signed identity profile for the account.
- **Stored blob.**
  - A blob represented as decoded data plus its CID.

Conceptually:

```ts
type StoredBlob<T> = {
  cid: CID
  decoded: T
}
```

CIDs are the stable content-addressed identifiers used to bind decoded data to a deterministic encoded form.

## High-level ceremony.

1. The user clicks **Sign in with Hypermedia** on the client site.
2. The client creates a non-extractable session key in WebCrypto.
3. The client redirects the browser to the Vault with delegation request parameters.
4. The Vault authenticates the user if needed.
5. The Vault shows consent for the requesting origin.
6. On approval, the Vault signs a capability from the selected account to the session key.
7. The Vault redirects back with callback data.
8. The client validates the callback, reconstructs/verifies blobs, and activates the delegated session.
9. The client may also create reverse blobs for bidirectional trust records and persist all relevant blobs.

## Request and callback shape.

### Request to the Vault.

The redirect request carries enough data for origin binding, replay protection, and proof of possession:

- Requesting origin identifier.
- Redirect URI.
- Session key principal.
- Random state nonce.
- Timestamp.
- Signature proof made by the session key over the request payload.

### Callback from the Vault.

The callback carries:

- The authorizing account principal.
- Delegation capability as a stored blob.
- Account profile as a stored blob.
- Echoed state value.
- Optional error code when consent is denied or flow fails.

Callback payloads are encoded for URL transport. On the client, decoded payloads are re-encoded and checked against the provided CIDs before use.

## Validation rules.

### Vault-side checks.

The Vault validates at least:

- Redirect URI is valid for the requesting origin.
- Request timestamp freshness.
- Proof signature correctness.
- Consent is explicit for the selected account.

### Client-side checks.

The client validates at least:

- Callback state matches the original request state.
- Capability/profile signatures are valid.
- Recomputed CIDs match the callback-provided CIDs.
- Capability delegate matches the local session principal.
- Account principal matches capability signer and profile owner.

These checks ensure both authenticity and cross-blob coherence.

## Security properties.

This protocol is designed to provide the following guarantees:

- **No account key export.**
  - The account private key never leaves the Vault.
- **Bound delegation.**
  - Capability is bound to a specific delegate principal.
- **Origin-aware consent.**
  - Consent is shown in terms of the requesting origin.
- **Replay resistance.**
  - Requests include timestamp and state.
- **Transport integrity by content addressing.**
  - Decoded blob data is checked against CIDs.

The capability itself is not secret. The usable authority comes from capability + possession of the delegated private key.

## SDK usage model.

A client integration typically follows this sequence:

1. Call `startAuth(...)` and navigate to the returned Vault URL.
2. After redirect back, call `handleCallback(...)`.
3. Use the returned delegated session for signing.
4. Persist delegation artifacts as needed.
5. Clear session on logout with `clearSession(...)`.

The SDK handles encoding/decoding and standard validation steps, while the application owns session lifecycle and UI behavior.

## Scope and non-goals.

Current design intentionally keeps the protocol simple:

- No client pre-registration.
- No mandatory server-to-server callback channel.
- Browser redirect flow as the primary transport.

This keeps integration straightforward while preserving strong key isolation.
