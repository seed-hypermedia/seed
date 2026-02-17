# Hypermedia Identity Delegation

This document describes how third-party websites authenticate users through the Seed Hypermedia Identity Vault. The protocol lets users bring their cryptographic identity to any site without exposing their real keys.

## The Problem

The Vault stores user's account signing keys — their real, long-lived identity. Third-party sites need to know _who_ a user is and let them perform signed actions, but they can't be trusted with the actual keys. A compromise of any single third-party site should not compromise the user's identity.

## The Solution: Session Key Delegation

Instead of sharing keys, we delegate authority. The third-party site generates its own ephemeral key pair and asks an account key stored in the Vault to vouch for it. The Vault signs a **Capability** — a cryptographic certificate that says "this session key is authorized to act on behalf of this account."

The session key's private half never leaves the browser that generated it. It is created as a WebCrypto **non-extractable** key, meaning no JavaScript — not even the site's own code — can read the raw key material. It can only be used to sign things through the WebCrypto API.

## How It Works

There are two servers involved:

- **The Vault** (`localhost:3000` in development) — the user's identity wallet. It stores encrypted account keys, handles authentication, and signs delegation capabilities.
- **The third-party site** (`localhost:8081` in the demo) — any website that wants to identify users via their Hypermedia identity. It has no special relationship with the Vault; it doesn't need to register as a client.

### The Ceremony

1. User clicks "Sign in with Hypermedia" on a third-party site.
2. The site generates a non-extractable key pair via WebCrypto and stores the handle in IndexedDB.
3. The browser redirects to the Vault, carrying the site's origin, a return URL, and the session public key.
4. If the user isn't logged in, the Vault walks them through registration or login. The delegation context persists in memory throughout.
5. Once the vault is unlocked, the user sees a consent screen identifying the requesting site. They pick an account and click Authorize.
6. The Vault signs a Capability with the account key, granting the session key the AGENT role. It records the delegation, then redirects back to the site with the signed capability and account info as URL params.
7. The site retrieves its key pair from IndexedDB. It now has an unextractable signing key and a capability proving it acts on behalf of the user's account.

For now: no back-channel between servers (maybe in the future), no client registration (on purpose) — the whole exchange is browser redirects and URL parameters.

### What Gets Passed Around

**To the Vault** (step 1, as URL search params):

| Parameter      | Example                        | Purpose                                                                                                 |
| -------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `client_id`    | `https://example.com`          | Origin of the requesting site. Must be HTTPS (HTTP allowed for localhost). No path, query, or fragment. |
| `redirect_uri` | `https://example.com/callback` | Where to send the user back. Must share origin with `client_id`.                                        |
| `session_key`  | `z6Mkr...`                     | Base58btc-encoded principal of the session public key.                                                  |

**Back to the site** (step 6, as URL search params):

| Parameter | Example         | Purpose                                                                     |
| --------- | --------------- | --------------------------------------------------------------------------- |
| `data`    | `p2J0c...`      | Base64url-encoded, gzip-compressed, CBOR-encoded callback data (see below). |
| `error`   | `access_denied` | Present if the user denied the request.                                     |

The `data` parameter contains a CBOR-encoded object with the following structure, then gzipped, then base64url-encoded:

```typescript
{
  account: Uint8Array; // Principal bytes of the account that authorized the delegation
  capability: Capability; // Signed capability blob
  profile: Profile; // Profile blob of the account
}
```

### The Capability Blob

The capability is a signed DAG-CBOR object:

```
{
  type: "Capability"
  signer: <account principal>     # who issued it
  delegate: <session key principal>  # who receives authority
  role: "AGENT"                   # what level of access
  label: "Session key for https://example.com"
  ts: 1707000000000               # when it was issued
  sig: <Ed25519 signature>        # proves the account key signed this
}
```

Anyone can verify this capability by checking the signature against the signer's public key. The session key can present this capability alongside its own signatures to prove it acts on behalf of the account.

## No Client Registration

Unlike OAuth 2.0, there is no client registration step. Any site can initiate the flow by redirecting to the Vault with the right parameters. The Vault validates the `redirect_uri` against the `client_id` origin — they must match — which prevents open redirect attacks. This is the same approach used by [LastLogin](https://lastlogin.net), inspired by dynamic OAuth 2.0 client registration but much simpler.

This works because the security model is fundamentally different from OAuth. In OAuth, a bearer token is the secret — anyone who has it can use it. Here, the capability is _public_. It's useless without the non-extractable private key locked inside the browser's WebCrypto module. There's nothing to steal from the redirect URL.

## The Demo

The repository includes a demo third-party site at `src/demo/`.

### Running It

```bash
# Terminal 1 — start the Vault
bun dev

# Terminal 2 — start the demo site
bun run ./src/demo/server.ts
```

The Vault runs on `localhost:3000`. The demo ("Acme Collaboration App") runs on `localhost:8081`.

### What the Demo Shows

1. A **Sign in with Hypermedia** button with a configurable Vault URL input.
2. Clicking it generates an unextractable session key and redirects to the Vault.
3. After the full ceremony (registration if needed → account creation → consent), you're redirected back.
4. The demo displays:
   - The **account profile** (name, description, principal) received from the Vault.
   - The **session key** stored in this browser's IndexedDB.
   - The **signed capability** that links the two.
   - A **"Sign a test message"** button that uses the session key to produce an Ed25519 signature, proving the non-extractable key works.

The demo uses the SDK at `src/sdk/hypermedia-auth.ts` — a zero-dependency, self-contained module that any third-party site can use.

### Relationship Between the Two Servers

The demo server is intentionally minimal. It serves static HTML and builds the SDK on-the-fly. It has no backend logic, no database, no session management of its own. It exists only to demonstrate what a third-party integration looks like.

The Vault server is the real application. It manages user accounts, encrypted vault data, authentication (passwords, passkeys, magic links), and the delegation consent flow. When a delegation request arrives, the Vault's SPA parses the parameters, preserves them across any authentication steps, and presents the consent screen once the user is fully authenticated and their vault is unlocked.

The two servers share nothing — no cookies, no database, no backend communication. The entire protocol happens through browser redirects and URL parameters. The session key in IndexedDB on the demo site's origin and the account key in the Vault's encrypted storage never meet; only the signed capability connects them.

## SDK

The client SDK (`src/sdk/hypermedia-auth.ts`) is designed to be copied into any project. It depends on `@ipld/dag-cbor` for CBOR encoding/decoding. Key functions:

```ts
import * as hmauth from "./hypermedia-auth";

// Start the flow — generates key, stores it, returns the Vault URL.
const authUrl = await hmauth.startAuth({
  vaultUrl: "https://vault.example.com",
});
window.location.href = authUrl;

// On callback — parses URL params, retrieves session from IndexedDB
const result = await hmauth.handleCallback({
  vaultUrl: "https://vault.example.com",
});
// result.accountPrincipal — base58btc-encoded principal who authorized you
// result.capability — typed Capability blob (verifiable signature)
// result.profile — typed Profile blob with name, description, avatar, etc.
// result.session — the stored session with signing key

// Sign data with the session key (non-extractable, uses WebCrypto)
const sig = await hmauth.signWithSession(result.session, data);

// Clean up
await hmauth.clearSession("https://vault.example.com");
```

## Security Considerations

**What's solid in the current implementation:**

- The session key is non-extractable — even XSS on the third-party site cannot steal it.
- The capability is cryptographically bound to the session key's public key — it's useless to anyone else.
- The redirect URI must share the same origin as the client ID — no open redirects.
- HTTPS is enforced (except localhost for development).
- The Vault never sends private key material anywhere.

**Hardening options for future versions:**

- **State nonce**: the third-party site generates a random `state` parameter, stores it, and verifies it on callback. Standard CSRF protection.
- **Proof of possession**: before the first redirect, the session key signs a message over the `client_id`, proving it consented to being linked. The Vault verifies this signature.
- **Capability expiration**: add a TTL to capabilities so they don't last forever.
- **Audience binding**: use the Capability's `audience` field to scope it to a specific service.
- **Session revocation**: let users revoke delegated sessions from within the Vault (the data model already tracks delegations).
