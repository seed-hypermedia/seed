# Email Notification Request Signing Architecture

Research notes on the signed request system used for email notification APIs, as implemented from March-July 2025.

## Overview

The email notification system used client-side cryptographic signing for every API request. Each request included the full payload data, a timestamp, and an ECDSA signature. The server verified the signature, checked the timestamp window, and confirmed the signer had authority over the target account. This prevented replay attacks, request tampering, and unauthorized access without any session tokens or cookies.

## Key Commits

| Date | Commit | Description |
|------|--------|-------------|
| Mar 26, 2025 | `01d1a4d22` | Initial "Email Notifications (#88)" - introduced the signing system |
| Jul 2, 2025 | `c246ceec6` | "Email notifications for document mentions and document changes (#109)" - extended with `notifyOwnedDocChange` |
| Oct 19, 2025 | `3a72bdad5` | "Seed Notify Service (#123)" - migrated from web app to separate `frontend/apps/notify/` service |

## File Locations

### Client-Side (web app)
- `frontend/apps/web/app/api.ts` — `signObject()` function, `cborEncode()`, `postCBOR()`
- `frontend/apps/web/app/auth.tsx` — `useLocalKeyPair()` hook, key pair management
- `frontend/apps/web/app/auth-utils.ts` — `preparePublicKey()` for P-256 key compression
- `frontend/apps/web/app/email-notifications-models.ts` — React hooks that build signed requests
- `frontend/apps/web/app/local-db.ts` — IndexedDB storage for CryptoKeyPair

### Client-Side (desktop app)
- `frontend/apps/desktop/src/models/email-notifications.ts` — Desktop notification hooks with gRPC-based signing
- `frontend/apps/desktop/src/grpc-client.ts` — gRPC client to the Go daemon

### Backend (Go daemon — signing service for desktop)
- `backend/api/daemon/v1alpha/daemon.go` — `SignData()` gRPC endpoint
- `backend/core/crypto.go` — `KeyPair.Sign()` implementation for ECDSA P-256 and Ed25519

### Server-Side (now in notify app)
- `frontend/apps/notify/app/routes/hm.api.email-notifier.$.tsx` — API route handler with verification
- `frontend/apps/notify/app/validate-signature.ts` — Signature verification (ECDSA P-256 + Ed25519)
- `frontend/apps/notify/app/server-api.ts` — `cborApiAction()` generic CBOR request handler
- `frontend/apps/notify/app/auth-utils.ts` — Server-side key utilities

---

## Detailed Flow

### 1. Key Pair Generation & Storage (Client)

Keys are generated once per browser session using Web Crypto API and stored in IndexedDB:

```typescript
// frontend/apps/web/app/auth.tsx
const keyPair = await crypto.subtle.generateKey(
  {
    name: 'ECDSA',
    namedCurve: 'P-256',
  },
  false, // non-extractable (private key can't be exported)
  ['sign', 'verify'],
)
```

Stored in IndexedDB under a `keys` store as non-extractable `CryptoKey` objects. The `useLocalKeyPair()` hook exposes the key pair reactively.

### 2. Public Key Compression (Client)

Before sending, the public key is compressed from 65-byte uncompressed format to 35 bytes with a varint prefix:

```typescript
// frontend/apps/web/app/auth-utils.ts
export async function preparePublicKey(publicKey: CryptoKey): Promise<Uint8Array> {
  const raw = await crypto.subtle.exportKey('raw', publicKey)
  const bytes = new Uint8Array(raw)
  // Raw format: 0x04 + x (32 bytes) + y (32 bytes)
  const x = bytes.slice(1, 33)
  const y = bytes.slice(33)
  const prefix = y[31] & 1 ? 0x03 : 0x02  // even/odd y indicator
  return new Uint8Array([
    128, 36,   // varint prefix for 0x1200 (multicodec P-256 public key)
    prefix,    // 0x02 or 0x03
    ...x,      // 32-byte x coordinate
  ])
}
```

This produces a 35-byte compressed key: `[128, 36, prefix_byte, ...x_coordinate]`.

### 3. Request Construction & Signing (Client)

Each request is built as a plain object, CBOR-encoded, signed, then the signature is appended:

```typescript
// frontend/apps/web/app/email-notifications-models.ts
const publicKey = await preparePublicKey(keyPair.publicKey)
const payload = {
  action: 'get-email-notifications',  // or 'set-email-notifications'
  signer: publicKey,                   // compressed public key (Uint8Array)
  time: Date.now(),                    // milliseconds since epoch
  // ... additional fields for set actions (email, notifyAllMentions, etc.)
} as const

// Sign the payload (without sig field)
const sig = await signObject(keyPair, payload)

// Send CBOR-encoded payload WITH signature appended
const result = await postCBOR(
  `/hm/api/email-notifier/${accountId}`,
  cborEncode({
    ...payload,
    sig: new Uint8Array(sig),
  }),
)
```

### 4. Signing Implementation (Client)

The `signObject` function CBOR-encodes the data then signs with ECDSA SHA-256:

```typescript
// frontend/apps/web/app/api.ts
export async function signObject(
  keyPair: CryptoKeyPair,
  data: any,
): Promise<ArrayBuffer> {
  const cborData = cborEncode(data)  // @ipld/dag-cbor encode
  const signature = await crypto.subtle.sign(
    {
      name: 'ECDSA',
      hash: {name: 'SHA-256'},
    },
    keyPair.privateKey,
    cborData,
  )
  return signature
}
```

The data being signed is the CBOR encoding of the payload **without** the `sig` field. This is critical for verification on the server.

---

## Desktop App Signing Flow

The desktop app uses a fundamentally different signing path than the web. Instead of holding keys in the browser's IndexedDB, the desktop app delegates signing to the Go daemon process via gRPC.

### Desktop Key Management

The desktop app does NOT hold private keys in the Electron renderer. Keys are managed by the Go daemon's `KeyStore`. The account UID (base58btc-encoded public key) is used as the key name.

### Desktop Signing Flow

```typescript
// frontend/apps/desktop/src/models/email-notifications.ts
async function notifierRequest(
  accountUid: string,
  action: Omit<EmailNotifierAction, 'sig'>,
) {
  // STEP 1: CBOR-encode the unsigned payload
  const cborData = cborEncode(action)

  // STEP 2: Ask the Go daemon to sign via gRPC
  const signResponse = await grpcClient.daemon.signData({
    signingKeyName: accountUid,   // account UID is the key name
    data: cborData,               // raw CBOR bytes to sign
  })

  // STEP 3: Attach signature and send
  const signedPayload = {...action, sig: signResponse.signature}
  const response = await fetch(
    `${gatewayUrl}/hm/api/email-notifier/${accountUid}`,
    {
      method: 'POST',
      body: cborEncode(signedPayload),
      headers: { 'Content-Type': 'application/cbor' },
    },
  )
  return response.json()
}
```

### Desktop Request Construction

```typescript
// Get notifications
async function getNotifs() {
  const publicKey = base58btc.decode(accountUid)  // decode account UID to bytes
  const payload = {
    action: 'get-email-notifications',
    signer: publicKey,
    time: Date.now(),
  } as const
  return await notifierRequest(accountUid, payload)
}

// Set notifications
async function setNotifs(input: SetEmailNotificationsInput) {
  const publicKey = base58btc.decode(accountUid)
  const payload = {
    action: 'set-email-notifications',
    signer: publicKey,
    time: Date.now(),
    ...input,   // email, notifyAllMentions, notifyAllReplies, notifyOwnedDocChange
  } as const
  return await notifierRequest(accountUid, payload)
}
```

### Go Daemon SignData gRPC Endpoint

The Go daemon exposes a `SignData` RPC that signs arbitrary data with a named key:

```go
// backend/api/daemon/v1alpha/daemon.go
func (srv *Server) SignData(ctx context.Context, in *daemon.SignDataRequest) (*daemon.SignDataResponse, error) {
    // Validate inputs
    if in.SigningKeyName == "" {
        return nil, status.Errorf(codes.InvalidArgument, "signing key name is required")
    }
    if len(in.Data) == 0 {
        return nil, status.Errorf(codes.InvalidArgument, "data to sign is required")
    }

    // Retrieve key pair from the key store
    keyPair, err := srv.store.KeyStore().GetKey(ctx, in.SigningKeyName)
    if err != nil {
        return nil, status.Errorf(codes.NotFound, "key %s: %v", in.SigningKeyName, err)
    }

    // Sign the data
    signature, err := keyPair.Sign(in.Data)
    if err != nil {
        return nil, status.Errorf(codes.Internal, "failed to sign data: %v", err)
    }

    return &daemon.SignDataResponse{
        Signature: signature,
    }, nil
}
```

### Go Key Pair Sign Implementation

The `KeyPair.Sign()` method dispatches to the appropriate algorithm:

```go
// backend/core/crypto.go

// For ECDSA P-256:
SignFunc: func(key any, data []byte) (Signature, error) {
    k := key.(*ecdsa.PrivateKey)
    sum := sha256.Sum256(data)
    r, s, err := ecdsa.Sign(rand.Reader, k, sum[:])
    // ... encode r,s into 64-byte signature
}

// For Ed25519:
SignFunc: func(key any, data []byte) (Signature, error) {
    k := key.(ed25519.PrivateKey)
    return ed25519.Sign(k, data), nil
}
```

### Key Difference: Web vs Desktop Signing

| Aspect | Web App | Desktop App |
|--------|---------|-------------|
| Key storage | IndexedDB (browser) | Go daemon KeyStore (filesystem) |
| Key type | ECDSA P-256 (Web Crypto API) | ECDSA P-256 or Ed25519 (Go crypto) |
| Signing | `crypto.subtle.sign()` in browser | gRPC call to `daemon.SignData()` |
| Key identity | Compressed public key from `preparePublicKey()` | `base58btc.decode(accountUid)` |
| Private key access | Non-extractable CryptoKey in renderer | Held by Go daemon, never in renderer |
| Gateway URL | Same origin (relative `/hm/api/...`) | Configurable via `useGatewayUrl()` |

The desktop app sends requests to an external gateway URL (the web server hosting the notifier), while the web app sends to its own server. Both produce identical CBOR+signature payloads that the same server-side verification handles.

---

### 5. Transport

Requests are sent as raw CBOR bytes via POST with `Content-Type: application/cbor`:

```typescript
// frontend/apps/web/app/api.ts
export async function postCBOR(path: string, body: Uint8Array) {
  const response = await fetch(`${path}`, {
    method: 'POST',
    body,
    headers: {
      'Content-Type': 'application/cbor',
    },
  })
  return await response.json()
}
```

### 6. Server-Side CBOR Decoding

The `cborApiAction` helper decodes the incoming CBOR body:

```typescript
// frontend/apps/notify/app/server-api.ts
export function cborApiAction<RequestType, ResultType>(handler) {
  const apiAction: ActionFunction = async ({request}) => {
    const cborData = await request.arrayBuffer()
    const data: RequestType = cborDecode(new Uint8Array(cborData))
    const result = await handler(data, { ...parsedRequest, rawData: cborData })
    return withCors(json(result))
  }
  return apiAction
}
```

### 7. Server-Side Verification

The API route handler performs a multi-step verification:

```typescript
// frontend/apps/notify/app/routes/hm.api.email-notifier.$.tsx
export const action = cborApiAction<EmailNotifierAction, any>(
  async (signedPayload, {pathParts}) => {
    const accountId = pathParts[3]

    // STEP 1: Separate signature from payload
    const {sig, ...restPayload} = signedPayload

    // STEP 2: Re-encode the payload WITHOUT sig and verify signature
    const isValid = await validateSignature(
      signedPayload.signer,       // compressed public key
      signedPayload.sig,          // ECDSA signature
      cborEncode(restPayload),    // CBOR of payload without sig
    )
    if (!isValid) {
      throw new BadRequestError('Invalid signature')
    }

    // STEP 3: Verify signer identity matches the account
    const signerId = base58btc.encode(signedPayload.signer)
    if (signerId !== accountId) {
      // Check for agent capability delegation
      const caps = await queryClient.accessControl.listCapabilitiesForDelegate({
        delegate: signerId,
      })
      const agentCap = caps.capabilities.find(
        (cap) => cap.role === Role.AGENT && cap.issuer === accountId,
      )
      if (!agentCap) {
        throw new BadRequestError(
          'Mismatched signer and account ID, with no matching agent capability found',
        )
      }
    }

    // STEP 4: Verify timestamp (replay attack prevention)
    const now = Date.now()
    const timeDiff = Math.abs(now - restPayload.time)
    if (timeDiff > 20_000) {  // 20-second window
      throw new BadRequestError('Request time invalid')
    }

    // STEP 5: Process the action
    // ...
  },
)
```

### 8. Signature Verification Implementation (Server)

The server decompresses the P-256 key and verifies using Node.js `webcrypto`:

```typescript
// frontend/apps/notify/app/validate-signature.ts
export async function validateSignature(
  compressedPublicKey: Uint8Array,
  signature: Uint8Array,
  data: Uint8Array,
): Promise<boolean> {
  // For Ed25519 keys (prefix 0xED)
  if (compressedPublicKey[0] === 0xed) {
    // Extract 32-byte key, import as Ed25519, verify
  }

  // For P-256 keys: decompress and verify
  const publicKey = await decompressPublicKey(compressedPublicKey)
  return webcrypto.subtle.verify(
    { name: 'ECDSA', hash: {name: 'SHA-256'} },
    publicKey,
    signature,
    data,
  )
}
```

P-256 key decompression involves:
1. Strip 2-byte varint prefix `[128, 36]`
2. Read prefix byte (0x02 = even y, 0x03 = odd y)
3. Extract 32-byte x coordinate
4. Compute y from the P-256 curve equation: `y^2 = x^3 + ax + b (mod p)`
5. Use Tonelli-Shanks algorithm for modular square root
6. Select correct y based on even/odd prefix
7. Construct 65-byte uncompressed key: `[0x04, x, y]`
8. Import as `CryptoKey` with `webcrypto.subtle.importKey`

---

## Request Schema (Zod)

```typescript
const emailNotifierAction = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('get-email-notifications'),
    signer: z.instanceof(Uint8Array),  // compressed public key
    time: z.number(),                   // Date.now() milliseconds
    sig: z.instanceof(Uint8Array),      // ECDSA signature
  }),
  z.object({
    action: z.literal('set-email-notifications'),
    signer: z.instanceof(Uint8Array),
    time: z.number(),
    sig: z.instanceof(Uint8Array),
    email: z.string(),
    notifyAllMentions: z.boolean(),
    notifyAllReplies: z.boolean(),
    notifyOwnedDocChange: z.boolean(),  // added in July 2025
  }),
])
```

---

## Security Properties

### What the signing achieves:

1. **Authentication**: Only the holder of the private key can create valid signatures. The server verifies the signer's public key matches the target account ID (or has an agent capability delegation).

2. **Integrity**: The entire payload (action, settings, email, timestamp) is signed. Any modification invalidates the signature.

3. **Replay Attack Prevention**: The `time` field (millisecond timestamp) is included in the signed data. The server rejects requests where `|server_time - request_time| > 20 seconds`. A captured request becomes invalid after 20 seconds.

4. **No Session State**: The server doesn't need sessions, cookies, or JWT tokens. Each request is self-authenticating.

5. **Agent Delegation**: If the signer's key doesn't directly match the account ID, the server checks for an `AGENT` capability delegation from the account to the signer. This supports the desktop app signing on behalf of a web identity.

### Key design decisions:

- **CBOR encoding** (not JSON): Deterministic binary encoding ensures the same data always produces the same bytes, which is essential for signature verification. JSON serialization order isn't guaranteed.
- **Signature over payload-without-sig**: The `sig` field is excluded from the signed data (using spread: `const {sig, ...restPayload} = signedPayload`). The server re-encodes `restPayload` with CBOR to get the exact same bytes the client signed.
- **20-second time window**: Balances clock skew tolerance with replay attack protection.
- **Non-extractable private keys**: `generateKey(..., false, ...)` means the private key can never be exported from the browser's crypto subsystem.

---

## Evolution

### March 2025 (commit `01d1a4d22`)
- Initial implementation with `get-email-notifications` and `set-email-notifications`
- Only P-256 ECDSA signatures
- Direct signer-to-accountId matching only (no delegation)
- Fields: `notifyAllMentions`, `notifyAllReplies`

### July 2025 (commit `c246ceec6`)
- Added `notifyOwnedDocChange` notification type
- Added agent capability delegation check (allows desktop app signing)
- Same signing architecture

### October 2025 (commit `3a72bdad5`)
- Migrated to separate `frontend/apps/notify/` Remix service
- Added Ed25519 key support in `validateSignature`
- Wrapped action handler in `cborApiAction` utility
- Added CORS handling

### Current State
- The signed request pattern **still exists** in the codebase at `frontend/apps/notify/app/routes/hm.api.email-notifier.$.tsx`
- A newer **public subscribe** endpoint (`hm.api.public-subscribe.$.tsx`) uses plain JSON without signing - this is for public/anonymous subscriptions
- The web app's `email-notifications.tsx` now uses `useSubscribeToNotifications` which calls the public subscribe endpoint instead of the signed one
