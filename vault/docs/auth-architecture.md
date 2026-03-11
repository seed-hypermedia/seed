# Authentication & Vault Architecture

This document describes the full signup/login flow, the vault's internal architecture, and how the frontend
integrates with the vault for identity delegation. For the delegation protocol specifically, see `delegation.md`.

## Overview

The system has two independent applications:

- **Frontend web app** (`frontend/apps/web/`): The main site. Users interact with content here.
- **Vault app** (`vault/`): A capability-based identity service. Stores account keys, handles authentication,
  and delegates authority to third-party sites.

Users can create accounts in two ways:

1. **Local account** (default): Browser-only P-256 ECDSA key pair. No vault involved.
2. **Vault-delegated account**: Ed25519 account key stored in the vault, delegated to the frontend via a signed
   capability. This is the path described below.

## Vault Tech Stack

- **Runtime**: Bun HTTP server
- **Frontend**: React SPA (Vite), React Router, Valtio state management
- **UI**: shadcn/ui + Tailwind CSS
- **Database**: SQLite (via `better-sqlite3`)
- **Auth methods**: Email magic link + password OR passkey (WebAuthn with PRF extension)

## Database Schema

Located in `vault/src/sqlite.ts`.

### users

| Column           | Type    | Notes                         |
| ---------------- | ------- | ----------------------------- |
| `id`             | TEXT PK | UUID                          |
| `email`          | TEXT    | Unique, not null              |
| `encrypted_data` | BLOB    | Encrypted vault data          |
| `version`        | INTEGER | Optimistic locking version    |
| `create_time`    | INTEGER | Unix timestamp                |

### credentials

Wraps a user's Data Encryption Key (DEK) with different auth methods.

| Column          | Type    | Notes                                                  |
| --------------- | ------- | ------------------------------------------------------ |
| `id`            | TEXT PK | UUID                                                   |
| `user_id`       | TEXT FK | References `users`                                     |
| `type`          | TEXT    | `'password'` or `'passkey'`                            |
| `encrypted_dek` | BLOB    | DEK encrypted with credential-specific KEK             |
| `metadata`      | JSON    | Password: `{authHash}`. Passkey: `{credentialId, ...}` |
| `create_time`   | INTEGER | Unix timestamp                                         |

### sessions

| Column        | Type    | Notes                      |
| ------------- | ------- | -------------------------- |
| `id`          | TEXT PK | UUID                       |
| `user_id`     | TEXT FK | References `users`         |
| `expire_time` | INTEGER | 24 hours from creation     |
| `create_time` | INTEGER | Unix timestamp             |

### email_challenges

Temporary records for email verification (registration and email changes).

| Column       | Type    | Notes                                    |
| ------------ | ------- | ---------------------------------------- |
| `id`         | TEXT PK | Challenge ID used for polling            |
| `user_id`    | TEXT FK | Null for registration, set for changes   |
| `purpose`    | TEXT    | `'registration'` or `'email_change'`     |
| `token_hash` | TEXT    | SHA-256 hash of the verification token   |
| `email`      | TEXT    | Email being verified                     |
| `new_email`  | TEXT    | For email changes only                   |
| `verified`   | INTEGER | Boolean flag                             |
| `expire_time`| INTEGER | 2 minutes from creation                  |

## API Routes

All routes are at `/vault/api/*`. Defined in `vault/src/main.ts`, implemented in `vault/src/api-service.ts`.

### Authentication

| Route                            | Method | Purpose                                    |
| -------------------------------- | ------ | ------------------------------------------ |
| `/vault/api/pre-login`           | POST   | Check if email exists, has password/passkeys |
| `/vault/api/register/start`      | POST   | Start registration, send magic link email  |
| `/vault/api/register/poll`       | POST   | Poll for magic link verification           |
| `/vault/api/register/verify-link`| POST   | Verify magic link token                    |
| `/vault/api/login`               | POST   | Password login                             |
| `/vault/api/add-password`        | POST   | Add password credential                    |
| `/vault/api/change-password`     | POST   | Change password credential                 |
| `/vault/api/logout`              | POST   | Destroy session                            |
| `/vault/api/session`             | GET    | Check current session status               |

### WebAuthn / Passkey

| Route                                  | Method | Purpose                          |
| -------------------------------------- | ------ | -------------------------------- |
| `/vault/api/webauthn/register/start`   | POST   | Generate passkey registration options |
| `/vault/api/webauthn/register/complete`| POST   | Complete passkey registration    |
| `/vault/api/webauthn/login/start`      | POST   | Generate passkey login challenge |
| `/vault/api/webauthn/login/complete`   | POST   | Complete passkey login           |
| `/vault/api/webauthn/vault`            | POST   | Store passkey-encrypted DEK      |

### Vault Data & Config

| Route                    | Method   | Purpose                              |
| ------------------------ | -------- | ------------------------------------ |
| `/vault/api/vault`       | GET      | Get encrypted vault data             |
| `/vault/api/vault`       | POST     | Save encrypted vault data            |
| `/vault/api/config`      | GET      | Get backend config (base URLs)       |
| `/vault/api/accounts/:id`| GET      | Get account profile (protobuf)       |

### Email Change

| Route                                  | Method | Purpose                          |
| -------------------------------------- | ------ | -------------------------------- |
| `/vault/api/change-email/start`        | POST   | Start email change               |
| `/vault/api/change-email/poll`         | POST   | Poll for email change verification |
| `/vault/api/change-email/verify-link`  | POST   | Verify email change link         |

## Signup Flow (New User)

### Step 1: Email Entry

- User enters email on the vault's `PreLoginView` (or arrives with email pre-filled from delegation).
- Frontend calls `POST /vault/api/pre-login` with `{email}`.
- Backend checks if user exists. Returns `{exists: false}` for new users.

### Step 2: Magic Link Verification

- Frontend calls `POST /vault/api/register/start` with `{email}`.
- Backend generates a 32-byte random token, stores SHA-256 hash in `email_challenges`.
- Sends magic link email: `{rpOrigin}/vault/verify/{challengeId}/{token}`.
- Returns `{message, challengeId}`.
- Frontend navigates to `VerifyPendingView`, shows 2-minute countdown, polls every 2s.

### Step 3: User Clicks Magic Link

- Opens `VerifyLinkView` at `/vault/verify/:challengeId/:token`.
- Frontend calls `POST /vault/api/register/verify-link` with `{challengeId, token}`.
- Backend: timing-safe hash comparison, sets `verified = 1`. Does NOT create user yet.
- Page shows "Email Verified!" checkmark.

### Step 4: Poll Succeeds

- Polling endpoint sees `verified = 1`.
- Backend **now creates the user**: inserts into `users`, deletes challenge.
- Creates session (24h), sets `HttpOnly` cookie.
- Returns `{verified: true, userId}`.

### Step 5: Choose Auth Method

- Frontend navigates to `ChooseAuthView`: "Use Passkey (Recommended)" or "Use Master Password".

### Step 6a: Password Setup

- User enters password at `SetPasswordView`.
- Frontend validates strength (8+ chars, mixed case, numbers, symbols).
- Key derivation:
  ```
  Argon2id(password, salt=email, memoryCost=64MB, iterations=3, parallelism=4) → 256-bit masterKey
  HKDF-SHA256(masterKey, info="enc") → 512-bit stretchedKey
  Bytes 0-31: encryption key
  Bytes 32-63: auth hash (sent to server, never the password)
  ```
- Generates random 64-byte DEK, encrypts with XChaCha20-Poly1305 using encryption key.
- Sends `POST /vault/api/add-password` with `{encryptedDEK, authHash}`.

### Step 6b: Passkey Setup

- Frontend calls `POST /vault/api/webauthn/register/start` → gets WebAuthn options.
- Prompts user to create passkey with PRF extension (salt: `"hypermedia-identity-vault-v1"`).
- Sends `POST /vault/api/webauthn/register/complete` with attestation response.
- PRF output (32 bytes) used as key encryption key to encrypt DEK.
- Sends `POST /vault/api/webauthn/vault` with `{credentialId, encryptedDEK}`.

### Step 7: Vault Unlocked

- DEK decrypted and stored in memory as `state.decryptedDEK`.
- Vault data loaded and decrypted. User can manage accounts.

## Login Flow (Existing User)

### Password Login

1. Email entry → `pre-login` returns `{exists: true, hasPassword: true}`.
2. Navigate to `LoginView`.
3. Derive key from password (same Argon2id + HKDF as signup).
4. Send `POST /vault/api/login` with `{email, authHash}`.
5. Backend: timing-safe authHash comparison. Creates session, returns `{encryptedDEK}`.
6. Frontend decrypts DEK, loads vault.

### Passkey Login

Three variants:

- **Conditional mediation** (autofill): On `PreLoginView` mount, starts `webauthn.startAuthentication({useBrowserAutofill: true})`. Browser shows passkey suggestions in the email field.
- **Modal login**: User clicks "Sign in with a passkey" link. Shows system passkey picker.
- **Email-specific**: After entering email, user clicks passkey button. Challenge scoped to that user's credentials.

All passkey logins: PRF output decrypts DEK → session created → vault unlocked.

### Quick Unlock (Locked State)

When session is valid but `decryptedDEK` is null (vault locked), `LockedView` shows unlock options:
passkey unlock or master password re-entry.

## Session & Cookie Management

Located in `vault/src/session.ts`.

| Property     | Value                                             |
| ------------ | ------------------------------------------------- |
| Cookie name  | `__Secure-Vault-Session` (prod) / `Vault-Session` (dev) |
| httpOnly     | true                                              |
| sameSite     | strict                                            |
| secure       | true (prod)                                       |
| path         | `/vault`                                          |
| maxAge       | 86400 (24 hours)                                  |

## Encryption Architecture

Located in `vault/src/frontend/crypto.ts`.

### Key Hierarchy

```
Master Password
  → Argon2id (salt=email) → 256-bit master key
  → HKDF-SHA256 → 512-bit stretched key
    → Bytes 0-31: Encryption Key (XChaCha20-Poly1305)
    → Bytes 32-63: Auth Hash (sent to server)

Passkey PRF
  → PRF evaluation (fixed salt) → 32-byte wrap key
  → Used directly as Key Encryption Key
```

### Data Encryption

- Algorithm: XChaCha20-Poly1305
- DEK: Random 64 bytes, generated once per user
- DEK encrypted separately per credential (password, each passkey)
- Vault data encrypted/decrypted with DEK
- Nonce format: `nonce (24 bytes) || ciphertext || tag (16 bytes)`

## Frontend Integration (Delegation Flow)

See `delegation.md` for the full protocol. Here's the practical integration:

### Key Files

**Frontend (main site):**

| File | Purpose |
| ---- | ------- |
| `frontend/apps/web/app/auth.tsx` | `CreateAccountDialog` with 7-tap Easter egg for vault sign-in |
| `frontend/apps/web/app/auth-session.ts` | `startAuth()`, `handleCallback()`, session key management |
| `frontend/apps/web/app/routes/hm.auth.callback.tsx` | Callback route handler |
| `frontend/apps/web/app/local-db.ts` | IndexedDB storage for keys, auth state, pending intents |
| `frontend/packages/shared/src/hmauth.ts` | Protocol constants, types, URL building, validation |
| `frontend/packages/shared/src/constants.ts` | `WEB_IDENTITY_ORIGIN` env var |

**Vault app:**

| File | Purpose |
| ---- | ------- |
| `vault/src/frontend/views/PreLoginView.tsx` | Email entry screen |
| `vault/src/frontend/views/LoginView.tsx` | Password/passkey login |
| `vault/src/frontend/views/VerifyPendingView.tsx` | Magic link polling with countdown |
| `vault/src/frontend/views/VerifyLinkView.tsx` | Magic link verification |
| `vault/src/frontend/views/ChooseAuthView.tsx` | Passkey vs password choice |
| `vault/src/frontend/views/SetPasswordView.tsx` | Password setup |
| `vault/src/frontend/views/DelegateView.tsx` | Consent screen with account selection |
| `vault/src/frontend/store.ts` | All state and actions (Valtio) |
| `vault/src/frontend/router.tsx` | Route definitions, auth guards |
| `vault/src/api-service.ts` | Backend API handlers |
| `vault/src/config.ts` | Environment config |
| `vault/src/session.ts` | Session/cookie management |
| `vault/src/challenge.ts` | WebAuthn challenge HMAC management |
| `vault/src/email.ts` | Magic link email sending |
| `vault/src/sqlite.ts` | Database schema and queries |

### Delegation URL Parameters

The delegation URL includes these signed parameters:

| Parameter      | Constant         | Purpose                                |
| -------------- | ---------------- | -------------------------------------- |
| `client_id`    | `PARAM_CLIENT_ID`| Origin of requesting site              |
| `redirect_uri` | `PARAM_REDIRECT_URI` | Where vault redirects after delegation |
| `session_key`  | `PARAM_SESSION_KEY` | Base58btc Ed25519 public key principal |
| `state`        | `PARAM_STATE`    | CSRF protection nonce                  |
| `ts`           | `PARAM_TS`       | Request timestamp (unix ms)            |
| `email`        | `PARAM_EMAIL`    | Optional pre-filled email              |
| `proof`        | `PARAM_PROOF`    | Ed25519 signature (must be last param) |

The `proof` parameter signs everything before it. Any parameter added must come before `proof`.

### Delegation Flow (End-to-End)

1. User clicks "Continue to join" or "Sign in" in the frontend `CreateAccountDialog`.
2. `authSession.startAuth()` generates an Ed25519 session key, stores it in IndexedDB.
3. Builds delegation URL with signed params, navigates to vault.
4. Vault's `RootLayout` calls `parseDelegationFromUrl()` on mount → stores in `state.delegationRequest`.
5. If email is in the URL, it's pre-filled in `state.email`.
6. If user is not authenticated: shows `PreLoginView` → login/signup flow.
7. If user is authenticated but vault locked: shows `LockedView` → unlock.
8. Once unlocked: `RootView` detects `delegationRequest` → redirects to `/delegate`.
9. `DelegateView` shows consent screen: requesting origin, account selection, "Authorize"/"Deny".
10. On "Authorize": vault signs capability, saves delegation to vault data, redirects back.
11. Frontend's `/hm/auth/callback` receives callback data, validates, activates session.

### Vault Routing & Auth Guards

```
/ (RootView)
  - Unauthenticated → PreLoginView
  - Authenticated + locked → LockedView
  - Authenticated + unlocked + delegationRequest → redirect to /delegate
  - Authenticated + unlocked → VaultView

RedirectIfUnlocked (wraps auth routes)
  - If unlocked + delegationRequest → redirect to /delegate
  - If unlocked → redirect to /
  - Otherwise → show child route

EnsureUnlocked (wraps protected routes)
  - Not authenticated → redirect to /
  - Authenticated + locked → LockedView
  - Authenticated + unlocked → show child route
```

## Environment Variables

### Vault (`vault/src/config.ts`)

| Variable                          | Default       | Purpose                                |
| --------------------------------- | ------------- | -------------------------------------- |
| `SEED_VAULT_HTTP_HOSTNAME`        | `0.0.0.0`    | Server bind address                    |
| `SEED_VAULT_HTTP_PORT`            | `3000`       | Server port                            |
| `SEED_VAULT_RP_ID`               | (required)    | WebAuthn Relying Party ID              |
| `SEED_VAULT_RP_NAME`             | `Seed Hypermedia Identity Vault` | WebAuthn RP display name |
| `SEED_VAULT_RP_ORIGIN`           | (required)    | Origin for WebAuthn + magic links      |
| `SEED_VAULT_DB_PATH`             | `./data/vault.sqlite` | SQLite database path            |
| `SEED_VAULT_BACKEND_HTTP_BASE_URL`| (required)   | For IPFS asset access                  |
| `SEED_VAULT_BACKEND_GRPC_BASE_URL`| (required)   | For account lookups                    |
| `SEED_VAULT_SMTP_HOST`           | (optional)    | Email server host                      |
| `SEED_VAULT_SMTP_PORT`           | `587`        | Email server port                      |
| `SEED_VAULT_SMTP_USER`           | (optional)    | Email auth user                        |
| `SEED_VAULT_SMTP_PASSWORD`       | (optional)    | Email auth password                    |
| `SEED_VAULT_SMTP_SENDER`         | (optional)    | From address for emails                |

### Frontend

| Variable                | Purpose                                                |
| ----------------------- | ------------------------------------------------------ |
| `WEB_IDENTITY_ORIGIN`   | Vault origin URL (default vault for delegation)       |

## Security Properties

1. **Timing-safe comparisons** for passwords and token hashes (prevent timing attacks)
2. **HMAC challenge cookies** for WebAuthn (CSRF prevention, 5-min expiry)
3. **HttpOnly + SameSite=Strict** cookies (no JS access, no cross-site)
4. **Server never sees plaintext password** (only auth hash derived client-side)
5. **High-entropy tokens** (32 bytes, only hash stored)
6. **Challenge expiry** (2 min for email, 5 min for WebAuthn)
7. **Counter verification** for passkeys (prevents cloned authenticators)
8. **Argon2id** with Bitwarden-equivalent params (64MB, 3 iterations, 4 parallelism)
9. **Optimistic locking** for vault data (version field prevents write conflicts)
10. **Signed delegation requests** (proof parameter covers all other params)
