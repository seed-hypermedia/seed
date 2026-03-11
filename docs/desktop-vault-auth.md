# Desktop Vault Authentication

This document explains the proposed authentication model for connecting the Seed desktop app to the vault.

The design should satisfy five goals:

- The system browser should handle Vault sign-in.
- Existing local-only users should be able to ignore the desktop app.
- OAuth-scale machinery should stay out of scope.
- Durable access to the encrypted vault data and API server should come from a single approval.
- Daemon signing should remain unchanged in v1.

## Overview

The desktop app will authenticate to the vault using a new vault credential type: `secret`.

The `secret` credential stays close to a password credential in structure, but the secret itself has four important
properties:

- It's generated randomly.
- It has high entropy from the start.
- Users never type it.
- Desktop secure storage is its only home.

The browser approval flow uses an ephemeral X25519 key pair only to deliver that long-lived desktop secret safely to the
desktop app. The ephemeral key is not the final desktop credential.

Two distinctions matter here:

- The ephemeral X25519 key is a one-shot pairing channel.
- The `secret` credential is the durable desktop authentication factor for future vault reads and writes.

## Why Not Reuse Delegation Directly

The existing delegation flow in
[`vault/docs/delegation.md`](/Users/burdiyan/code/src/github.com/seed-hypermedia/seed/vault/docs/delegation.md) is for
authorizing a session key to act on behalf of an account identity.

Desktop vault access requires several additional capabilities:

- A durable way to authenticate to the vault API later.
- Access to a credential-specific `encrypted_dek`.
- A way to fetch and save the encrypted vault blob without reopening the browser every time.

V1 therefore keeps the same broad browser-based shape but changes the semantics:

- Delegation remains account/session auth.
- Desktop vault auth creates a new persistent `secret` credential.

## Main Idea

The browser is the only place that can unlock the vault using passkey or password, because it runs on the vault origin
and already knows how to decrypt the DEK.

Once the user unlocks the vault in the browser and approves the desktop app, the system performs six steps:

1. Generates a long-lived random secret for the desktop.
2. Creates a `secret` credential in the vault database.
3. Wraps the DEK for that secret and stores it as the credential's `encrypted_dek`.
4. Encrypts the new desktop credential material to the desktop app's ephemeral X25519 public key.
5. Sends that encrypted payload to the desktop loopback server.
6. Desktop stores the long-lived secret securely and discards the ephemeral key.

After that, the desktop can authenticate directly to the vault API without browser help.

## Credential Model

The vault keeps using the existing `credentials` table. V1 does not need a separate `device_credentials` table.

The new credential type is `secret`.

Each `secret` credential should include the following fields:

- `id`: opaque credential id.
- `type`: `secret`.
- `encrypted_dek`: DEK encrypted for this secret credential.
- Verifier data: `secret_hash`.
- Metadata: device label, platform, app version, created time, last-used time, revoked time.

This model is intentionally similar to password credentials, but it differs in three ways:

- No Argon derivation is needed.
- No email-based login semantics are needed.
- The secret is not user-facing.

The desktop authenticates using `credential_id + secret`, not email + password.

## Pairing Flow

### 1. Desktop starts pairing

The Electron main process starts the auth flow.

The Electron main process generates four values at the start of the flow:

- An ephemeral X25519 key pair.
- A random `state` nonce.
- A temporary loopback callback endpoint on `127.0.0.1`.
- A short human-readable fingerprint shown as 4-5 BIP-39 words.

The browser URL carries the minimum pairing fields:

- Vault origin.
- Desktop ephemeral public key.
- Callback URL.
- `state`.
- Device label.

The desktop then opens the system browser to the vault pairing page.

### 2. Browser authenticates and shows the same fingerprint

The vault browser app performs three actions before approval:

- It authenticates the user with the normal vault flow.
- Next, it unlocks the vault so the DEK is available in browser memory.
- Finally, it derives the same short word sequence from the pairing request.

The same words appear in two places:

- One copy appears in the desktop app.
- Another appears on the browser approval page.

This is a visual pairing check only. The user does not type anything.

The word check reduces accidental misbinding in several common cases:

- It helps catch a wrong browser tab.
- It helps catch a stale pairing attempt.
- It separates multiple concurrent pairing flows.

It is not meant to defend against a compromised vault origin.

### 3. Browser creates the long-lived desktop credential

After the user approves, the browser performs five steps:

1. The browser generates a long-lived random secret.
2. The browser computes `secret_hash`.
3. The browser derives a wrapping key from that secret.
4. The browser encrypts the current DEK to produce the credential's `encrypted_dek`.
5. The browser creates a new `credentials(type = secret)` row in the vault backend.

At this point, the vault backend stores three things:

- The verifier or hash.
- The credential metadata.
- The wrapped `encrypted_dek`.

It does not learn the raw desktop secret.

### 4. Browser delivers the credential to the desktop

The browser prepares a payload with three values:

- The vault origin.
- The credential id.
- The long-lived secret.

That payload is encrypted to the desktop app's ephemeral X25519 public key and sent to the loopback server with a
`POST`.

The browser must not place the secret in any of the following locations:

- Query params must not carry the secret.
- Fragments must not carry the secret.
- Browser history must not retain the secret.
- Plain loopback URLs must not carry the secret.

Only the encrypted payload is sent to the loopback server.

### 5. Desktop finalizes

The Electron main process then completes five steps:

- It validates `state`.
- Then it decrypts the payload using the ephemeral private key.
- Next, it stores the long-lived secret in Electron secure storage.
- It also stores the vault origin and credential id alongside it.
- Finally, it discards the ephemeral X25519 private key.

From then on, the desktop uses the durable `secret` credential for vault API access.

## What The Desktop Stores

The desktop app should persist four values:

- The vault origin.
- The credential id.
- The long-lived secret.
- The paired device label or lightweight account metadata if useful for UI.

These should live in Electron secure storage, not in renderer state.

V1 should keep this logic in Electron main, not in the Go daemon.

Electron main is the right owner in v1 for four reasons:

- It already owns app-level secure storage.
- It can host the loopback callback.
- Browser launch and pairing UX already live there.
- Meanwhile, the daemon can stay focused on key storage, signing, and import/export.

## What The Desktop Does Later

The desktop app later authenticates with two pieces of material:

- `credential_id`.
- `secret`.

The vault backend then performs four actions:

- It looks up the `secret` credential by id.
- Then it verifies `secret_hash`.
- Next, it returns the credential's `encrypted_dek`.
- It also returns the encrypted vault blob as needed.

The desktop app then performs three actions:

- It derives the wrapping key from the secret.
- Then it decrypts `encrypted_dek`.
- Finally, it uses the DEK to decrypt and update vault data locally.

This is the mechanism that makes later vault reads and writes work without reopening the browser.

## Relation To Key Management

This authentication design does not replace daemon signing.

This design keeps v1 scoped in three ways:

- The daemon remains the source of truth for local signing keys.
- Vault auth on the desktop only reads and updates the encrypted vault.
- Manual key import and export happen only after auth succeeds.

This produces two concrete key-management operations:

- Import from vault to desktop: the desktop decrypts the vault, extracts one account seed, and imports it into the daemon.
- Export from desktop to vault: the desktop exports one daemon seed, adds it to the vault, and saves the vault back.

Actual document signing still uses the daemon, exactly as today.

## Why No Persistent Pairing Table In V1

For the same-machine flow, v1 does not need a persistent `device_authorizations` table.

The same-machine pairing state can stay in memory for three reasons:

- The desktop starts the flow.
- The browser returns immediately to the loopback server.
- A failure only means the user retries.

This keeps v1 smaller.

This approach breaks down in three cases:

- The desktop might restart mid-pairing.
- The browser callback might arrive too late.
- Approval might need to happen from another device.

In those cases, the flow cannot resume.

That is acceptable for the first version.

## Future Extension: Cross-Device Approval

If we later want approval from another device, pure loopback + in-memory state is no longer enough.

A future cross-device flow would need a rendezvous mechanism:

- One option would be a device-code flow.
- Another option would be a short-lived pending authorization record.
- Polling or websocket coordination could also work.

The installed credential model would stay the same in three respects:

- It would still use `credentials(type = secret)`.
- Wrapped `encrypted_dek` would still be part of the design.
- A desktop-held long-lived secret would still be the credential.

Only the pairing transport would need to change.

## Security Notes

- The long-lived secret is the real desktop credential. Protect it like any other high-value local secret.
- The ephemeral X25519 key pair exists only to deliver that secret safely during pairing.
- Approval should only be possible after the vault is unlocked, because the browser must produce the
  credential-specific `encrypted_dek`.
- The safety words are a misbinding check, not a substitute for origin security.
- Loopback binding should stay on `127.0.0.1` only, with a fresh random `state` value for each attempt.
- The callback should prefer `POST` with an encrypted body, not redirect query params with secrets.

## Summary

The v1 design has seven defining characteristics:

- It uses the system browser for vault sign-in.
- Ephemeral X25519 handles one-shot pairing.
- Short matching BIP-39 words provide the visual pairing check.
- A new `secret` credential type lives in the existing vault `credentials` table.
- Long-lived desktop auth uses `credential_id + secret`.
- No persistent pending-authorization table is required in v1.
- Daemon signing behavior does not change.

This keeps the design small, compatible with the current vault architecture, and sufficient for manual key import/export
from the desktop app.
