# Desktop App Vault Authentication — Design Plan

## Context

The desktop app (Electron) has no vault-based auth. Users can only use local daemon accounts. We want to let users sign
up/log in via the vault from the desktop app, with passkey/password auth happening in the system browser.

**Why browser-based?** Passkeys (WebAuthn + PRF) require the vault's registered origin. Electron runs on
`file://`/localhost — can't do WebAuthn for the vault's RP ID. Opening the system browser is the standard native app
auth pattern (VS Code, Slack, Spotify, GitHub CLI).

**Key insight**: `hmauth.ts` already allows HTTP localhost for both `validateClientId` (line 202) and
`validateRedirectUri` (line 228). The delegation callback data is entirely self-contained in URL params (no cookies
needed). **Zero protocol changes required.**

---

## Approach: Localhost HTTP Callback (RFC 8252)

```
Desktop App                    System Browser                  Vault
─────────────                  ──────────────                  ─────
1. User clicks "Sign in"
2. Generate Ed25519 session key
3. Build delegation URL
4. shell.openExternal(url) ──→ Opens vault page ──→           Receives request
                               5. User authenticates            Validates proof
                                  (passkey/password)
                               6. User consents                 Signs capability
                               7. Vault redirects ←──────────── Redirects to
                                  to localhost                   localhost:{port}
8. HTTP server receives    ←── Browser hits
   callback at /auth/callback  localhost:{port}/auth/callback
9. Validate state + capability
10. Persist session (safeStorage)
11. BrowserWindow.focus()
12. IPC → renderer updates     13. Browser shows
                                   "Success! Return to app"
```

**Why not alternatives?**

- Deep link (`hm://`): Requires hmauth changes, URL length limits, unreliable protocol registration
- Polling: New vault API endpoints, latency, more complex

---

## UX Design (Nielsen Heuristics)

| Heuristic            | Application                                                          |
| -------------------- | -------------------------------------------------------------------- |
| **System status**    | Desktop shows "Waiting for sign-in..." spinner while browser is open |
| **Real world match** | "Sign in" button, "Your browser will open to complete sign-in"       |
| **User control**     | "Cancel" button aborts flow; 10-min timeout with retry               |
| **Consistency**      | Same OAuth-like pattern users know from Slack/VS Code/Spotify        |
| **Error prevention** | Pre-validate vault URL reachable; bind 127.0.0.1 only                |
| **Recognition**      | After sign-in, show account name + avatar persistently               |
| **Efficiency**       | Auto-focus desktop after callback; auto-close browser tab            |
| **Minimalism**       | Vault handles all auth complexity; desktop just shows spinner        |
| **Error recovery**   | Browser fails → show URL + "Copy link"; callback fails → "Try again" |

---

## Implementation

### Decisions (from user input)

- **Vault URL**: User-configurable setting, same pattern as gateway URL
- **Session persistence**: Yes, persist across restarts via `safeStorage`
- **Daemon integration**: Deferred — will investigate separately

### Files to Modify

| File                                           | Change                                                                     |
| ---------------------------------------------- | -------------------------------------------------------------------------- |
| `frontend/apps/desktop/src/app-http-server.ts` | Add `/auth/callback` GET route before the `/api/` check                    |
| `frontend/apps/desktop/src/app-api.ts`         | Register `vaultAuthApi` in tRPC router                                     |
| `frontend/apps/desktop/src/app-store.mts`      | (No change — already supports arbitrary keys)                              |
| `frontend/apps/desktop/src/pages/settings.tsx` | Add vault URL setting to a settings tab (mirror `GatewaySettings` pattern) |

### New Files

| File                                             | Purpose                                                                                                                                 |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `frontend/apps/desktop/src/app-vault-auth.ts`    | Core auth logic: key gen, URL building, callback handling, persistence. Exports tRPC router (`vaultAuthApi`) and HTTP callback handler. |
| `frontend/apps/desktop/src/models/vault-auth.ts` | React Query hooks for renderer: `useVaultAuth()`, `useStartVaultAuth()`, `useVaultAuthState()`, `useVaultUrl()`, `useSetVaultUrl()`     |

### Reuse Existing Code

| Module                               | What to reuse                                                                                                      |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `@shm/shared/src/hmauth.ts`          | `validateClientId`, `validateRedirectUri`, `validateState`, `principalEncode`, protocol constants, URL param names |
| `@shm/shared/src/blobs.ts`           | `principalFromEd25519`, `principalToString`, capability decoding/verification                                      |
| `@shm/shared/src/cbor.ts`            | CBOR decode for callback data                                                                                      |
| `@shm/shared/src/base64.ts`          | Base64url decode for callback data                                                                                 |
| `@noble/curves/ed25519`              | Key generation + signing (already a project dependency)                                                            |
| `electron-store` via `app-store.mts` | Persist vault URL setting (same pattern as `GatewayUrl` key)                                                       |
| `safeStorage` (Electron API)         | Encrypt session key seed at rest                                                                                   |

### Vault URL Setting (mirrors gateway URL pattern)

Follow the exact architecture from `app-gateway-settings.ts`:

```
settings.tsx (VaultSettings component)
  ↓
vault-auth.ts (useVaultUrl, useSetVaultUrl hooks — React Query)
  ↓
tRPC Client → IPC → Main Process
  ↓
app-vault-auth.ts (getVaultUrl/setVaultUrl procedures)
  ↓
electron-store (key: 'VaultUrl')
```

- Store key: `'VaultUrl'` in `AppStore`
- Default: `DEFAULT_VAULT_URL` from `@shm/shared/constants.ts` (currently `WEB_IDENTITY_ORIGIN`)
- Query key: add `VAULT_URL` to `@shm/shared/models/query-keys`

### Session Key Management

**Generation** (main process):

```ts
import {ed25519} from '@noble/curves/ed25519'
import {randomBytes} from 'node:crypto'

const seed = randomBytes(32)
const publicKey = ed25519.getPublicKey(seed)
const principal = hmauth.principalEncode(publicKey)
```

**Proof signing** (same Ed25519 as web app, noble instead of Web Crypto):

```ts
const unsignedUrl = buildDelegationUrl(/* without proof */)
const signature = ed25519.sign(new TextEncoder().encode(unsignedUrl), seed)
const proof = base64.encode(signature)
// Append &proof={proof} to URL
```

**Persistence** (survives restarts):

```ts
import {safeStorage} from 'electron'

// Save
const encrypted = safeStorage.encryptString(Buffer.from(seed).toString('hex'))
fs.writeFileSync(sessionPath, encrypted)

// Load
const encrypted = fs.readFileSync(sessionPath)
const hex = safeStorage.decryptString(encrypted)
const seed = Buffer.from(hex, 'hex')
```

### Callback Processing (`/auth/callback` route)

Add to `app-http-server.ts` before the `/api/` path check:

```ts
if (pathname === '/auth/callback') {
  const result = handleAuthCallback(url.searchParams)
  // Returns { status, html } or { status, error }
  res.writeHead(result.status, {'Content-Type': 'text/html'})
  res.end(result.html)
  return
}
```

In `app-vault-auth.ts`, `handleAuthCallback()`:

1. Extract `data` and `state` from query params
2. Validate `state` matches stored pending auth state
3. Base64-decode → gunzip → CBOR-decode the `data` param
4. Verify capability: CID integrity, signature, delegate matches our session key
5. Persist: session key (safeStorage) + capability blob + account principal
6. Notify renderer via IPC: `{ type: 'vaultAuthComplete', accountPrincipal }`
7. `BrowserWindow.getAllWindows()[0]?.focus()`
8. Return success HTML page

### Success Page (returned to browser)

```html
<!doctype html>
<html>
  <head>
    <title>Signed in</title>
    <style>
      body {
        font-family: system-ui;
        display: flex;
        justify-content: center;
        align-items: center;
        height: 100vh;
        margin: 0;
        color: #333;
      }
      .box {
        text-align: center;
      }
    </style>
  </head>
  <body>
    <div class="box">
      <h1>Signed in successfully</h1>
      <p>You can close this tab and return to the desktop app.</p>
    </div>
    <script>
      setTimeout(() => window.close(), 2000)
    </script>
  </body>
</html>
```

### tRPC API (`vaultAuthApi`)

```ts
export const vaultAuthApi = t.router({
  // Vault URL setting
  getVaultUrl: t.procedure.query(() => vaultUrl),
  setVaultUrl: t.procedure.input(z.string().url()).mutation(({input}) => {
    writeVaultUrl(input)
  }),

  // Auth flow
  startAuth: t.procedure.mutation(async () => {
    // 1. Generate session key
    // 2. Build delegation URL with redirect_uri=http://localhost:{port}/auth/callback
    // 3. Store pending auth state (state nonce, seed)
    // 4. shell.openExternal(delegationUrl)
    // 5. Return { started: true }
  }),

  cancelAuth: t.procedure.mutation(() => {
    // Clear pending auth state
  }),

  // Session state
  getAuthState: t.procedure.query(() => {
    // Returns: { status: 'none' | 'pending' | 'authenticated', account?: {...} }
  }),

  logout: t.procedure.mutation(() => {
    // Clear stored session key + capability
  }),
})
```

---

## Deferred (Not In Scope)

- **Daemon integration**: How to register the delegation with the daemon for P2P operations. Will investigate the
  daemon's gRPC API separately.
- **Account switching**: Supporting multiple vault-delegated accounts.
- **Session refresh**: Auto-refreshing expired sessions (24h vault session TTL).
- **Blob publishing**: Publishing capability blobs to identity origin after auth.

---

## Verification

1. **Manual test**: Click "Sign in" → browser opens vault → authenticate with passkey/password → consent → desktop
   receives delegation → account shows in UI
2. **Cancel test**: Start auth → click Cancel → state resets cleanly
3. **Persistence test**: Sign in → restart app → session still active
4. **Error cases**: Invalid vault URL, vault unreachable, callback with wrong state, timeout
5. **Settings test**: Change vault URL in settings → next auth uses new URL
