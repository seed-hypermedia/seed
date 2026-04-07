# Notes About Seed

## Core Concepts

### Join vs Subscribe vs Follow

These are three separate systems:

| Concept | What it does | Requires account? | Where data lives |
|---------|-------------|-------------------|-----------------|
| **Join** | Become a site member | Yes | Contact blob with `subscribe.site = true` |
| **Follow** | Follow a user profile | Yes | Contact blob with `subscribe.profile = true` |
| **Subscribe** | Get email notifications | No (just an email) | Separate notification service (`apps/notify`) |

- They're **independent** — you can subscribe without joining, join without subscribing.
- Join and Follow are both stored as Contact blobs, just with different flags.
- Subscribe is a completely separate system that talks to a notification service via `NOTIFY_SERVICE_HOST`.

### Key files for these:
- Join/Follow hooks: `packages/shared/src/models/join-site.ts`
- Email subscribe mutation: `packages/shared/src/models/email-notifications.ts`
- Subscribe dialog UI: `packages/ui/src/subscribe-dialog.tsx`

---

## Account Creation — 3 Methods

### 1. Vault (default web flow)

The **vault** is a hosted identity provider at `hyper.media`. It works like "Sign in with Google" but for Seed:

1. User clicks "Join" → redirected to `hyper.media`
2. User authenticates at the vault (passkeys, password+email, or magic link)
3. The vault holds the **master Ed25519 account key** — it never leaves the vault
4. The vault creates a **delegated session**: signs a capability saying "this session key on `ethosfera.org` can act on behalf of this account"
5. User is redirected back with the signed capability
6. The site stores a lightweight **session key** in IndexedDB

**Big win:** One account works across all Seed sites. Create it once, delegate sessions to each site you visit.

**Auth methods at the vault:**
- **Passkeys** (recommended) — uses PRF extension for deterministic key derivation
- **Password + email** — Argon2id key derivation, email as salt
- **Magic link** — a login link sent to your email. **Limited**: can only be used for registration and account recovery, NOT for decrypting vault data (since there's no password to derive a key from)

**Key files:**
- Vault data model: `vault/src/frontend/vault.ts`
- Vault docs: `vault/README.md`
- Delegation protocol: `docs/vault-session-key-delegation.md`
- Web auth flow: `apps/web/app/auth.tsx`
- Vault callback handler: `apps/web/app/routes/hm.auth.callback.tsx`
- Auth session/delegation: `packages/shared/src/hmauth.ts`

### 2. Local key (web, hidden/dev)

- Unlocked via **7-tap secret**: tap the title in login dialog 7 times within 3.5 seconds
- Generates an **ECDSA P-256** keypair directly in the browser
- Private key stored in **IndexedDB** — browser-locked, not recoverable if cleared
- Primarily for development/testing, not the main user flow

### 3. Desktop app (recovery phrase)

- Generates a **BIP-39 mnemonic** (recovery phrase)
- Private key stored in the **OS keyring**
- Can also import an existing recovery phrase or key file
- Key file: `apps/desktop/src/components/onboarding.tsx`

### All methods produce the same result

Regardless of creation method, you end up with an **account ID** (base58btc-encoded public key) that can sign things. The Join/Follow/Subscribe features don't care how the account was created — they just check if a Contact blob exists.

---

## Pending Intents

When a non-logged-in user tries to do something (join, comment, follow), the app saves a **pending intent** to IndexedDB before redirecting to the vault. After auth completes, the intent is automatically processed.

Example: User clicks "Join" while logged out → intent `{type: 'join', subjectUid: '...'}` saved → redirected to vault → vault auth → redirected back → site auto-joins.

Works for: `join`, `comment` (preserves comment text!), `follow`.

Key file: `apps/web/app/pending-intent.ts`

---

## Testing Tips

### Testing account features locally

For testing Join/Subscribe/Facepile features, **you don't need the vault**. The local 7-tap key is the fastest method.

| Method | Best for | Notes |
|--------|---------|-------|
| Local key (7-tap) | Quick local testing | Fully offline, no external dependencies |
| Vault | Testing pending intents, real auth flow | Needs internet connection to `hyper.media` |
| Different browser/incognito | Simulating multiple users | Each context has separate IndexedDB = separate identity |

### Simulating user states

| State | How |
|-------|-----|
| Not logged in | Incognito window, don't create account |
| Logged in, not joined | Create account (7-tap), don't click Join |
| Logged in, joined | Create account, then Join the site |

### Running locally

```bash
# Terminal 1: daemon
./dev run-backend

# Terminal 2: web app
./dev run-web
# → http://localhost:3000
```

### Environment

- Web: `http://localhost:3000`
- Daemon HTTP: port `58001`
- Daemon gRPC: port `56002`
- Email notifications require `NOTIFY_SERVICE_HOST` to be set
- Vault identity provider: `WEB_IDENTITY_ORIGIN` (defaults to `https://hyper.media`)

---

## Architecture Quick Reference

- `apps/web` — Remix web app
- `apps/desktop` — Electron desktop app
- `apps/notify` — Email notification service
- `packages/editor` — BlockNote/Tiptap editor
- `packages/ui` — Shared UI components (buttons, dialogs, content rendering)
- `packages/shared` — Shared hooks, models, utilities
- `packages/client` — gRPC client, type definitions
- `vault/` — Vault identity provider server
