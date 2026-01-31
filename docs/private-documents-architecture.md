# Private Documents Backend Architecture

This document analyzes the private documents implementation introduced in commit `462fb204`.

## Overview

The implementation adds visibility-based access control to the Seed P2P network. Documents can be marked as **public** (accessible by anyone) or **private** (restricted to authorized peers). Authorization is capability-based, leveraging cryptographic signatures.

## Core Components

### 1. Visibility Tracking (`blob_visibility` table)

**Schema Change**: The `public_blobs` table was replaced with `blob_visibility`:

```sql
CREATE TABLE blob_visibility (
    id INTEGER REFERENCES blobs (id) NOT NULL,
    space INTEGER NOT NULL,  -- 0 = public, otherwise = public_keys.id
    PRIMARY KEY (id, space)
) WITHOUT ROWID;
```

Key properties:
- `space = 0` means public blob
- `space > 0` references a space owner's public key
- Same blob can exist in multiple spaces (e.g., a comment owned by both author and target document's space)
- A backwards-compatible `public_blobs` VIEW is retained

### 2. Peer Authentication (`peer_auth.go`)

Peers authenticate by proving account ownership via ephemeral capabilities:

```go
type peerAuthStore struct {
    mu    sync.Mutex
    peers map[peer.ID]map[core.PrincipalUnsafeString]*Capability
}
```

**Authentication Flow**:
1. Client creates an `EphemeralCapability` with:
   - `callerPID`: Client's libp2p peer ID
   - `account`: The account principal being claimed
   - `serverPID`: Target server's peer ID
   - `ts`: Current timestamp (must be within 1 minute)
   - `sig`: Signature from the account's private key

2. Server verifies signature and stores authentication state
3. Authentication persists for the connection lifetime

**Ephemeral Capability Structure**:
```go
type Capability struct {
    BaseBlob           // Type, Signer, Ts, Sig
    Delegate Principal // Client's peer ID as principal
    Audience Principal // Server's peer ID as principal
}
```

### 3. Access Control Logic (`index_access.go`)

The `CanPeerAccessCID` method determines blob accessibility:

```go
func (idx *Index) CanPeerAccessCID(peerID peer.ID, c cid.Cid) bool
```

**Access is granted if**:
1. CID is allowlisted for active push operation, OR
2. Blob exists locally AND:
   - Blob is public (`space = 0` in visibility), OR
   - Peer can access at least one of the blob's visibility spaces

**Space Access Rules** (`canPeerAccessSpace`):
1. Peer authenticated with the space account itself
2. Peer is the `siteUrl` server for the space
3. Peer authenticated with an account that has a `WRITER` capability for the space

### 4. Site Peer Resolver (`site_peer_resolver.go`)

Resolves `siteUrl` metadata to peer IDs with LRU caching:

```go
type sitePeerResolver struct {
    cache  *lru.Cache[string, sitePeerEntry]
    ttl    time.Duration
    client *http.Client
}
```

- Calls `GET {siteURL}/hm/api/config` to get peer info
- Caches results with TTL (default: 5 minutes)
- Used to verify if a peer is the authorized siteUrl server for a space

### 5. Push Allowlist

For push operations, blobs are temporarily allowlisted:

```go
// Maps peer ID -> request ID -> set of CIDs
allowlistEntries map[peer.ID]map[string]map[cid.Cid]struct{}
```

This allows bitswap to serve blobs during push operations without requiring authentication.

## Syncing Integration

### Client-Side (`syncing.go`)

**Authentication Pre-computation**:
```go
func (s *Service) computeAuthInfo(ctx context.Context, eids map[string]bool) *authInfo
```

1. Collects unique spaces from resources being synced
2. Looks up `siteUrl` for each space from local DB
3. Resolves siteUrl to peer ID
4. Maps which local keys have access to which siteUrl servers

**Auto-Authentication**:
When syncing with a peer that's a siteUrl server for an accessible space:
```go
if keys, ok := auth.peerKeys[pid]; ok {
    for _, kp := range keys {
        s.authenticateWithPeer(ctx, auth.addrInfos[pid], kp)
    }
}
```

### Server-Side (`server.go`)

**RBSR Store Filtering**:
```go
authorizedSpaces, _ := s.index.GetAuthorizedSpacesForPeer(ctx, pid, requestedIRIs)
store = store.WithFilter(authorizedSpaces)
```

The store only exposes blobs the peer is authorized to access.

### Authorized Store (`authorized_store.go`)

Wraps RBSR store with per-item visibility tracking:

```go
type authorizedStore struct {
    rbsr.Store
    privateOnly *btree.Map[visibilityKey, struct{}]
    authSet     map[core.PrincipalUnsafeString]struct{}
}
```

- `SetItemPrivateVisibility(i, space)`: Marks item as private for a space
- `WithFilter(spaces)`: Creates filtered view for authorized spaces
- Items with no private visibility pass filter (public)
- Items with private visibility require matching space in authSet

## Visibility Propagation

**Recording** (`index_visibility.go`):
```go
func recordBlobVisibility(conn *sqlite.Conn, blobID int64, space int64) error
```

**Propagation** (when indexing linked blobs):
```go
func propagateVisibility(ictx *indexingCtx, id int64) error
```

Uses `blob_visibility_rules` table to determine how visibility propagates:
- Changes inherit from dependent changes
- Refs propagate to head changes
- DagPB/Raw blobs inherit from all linking blobs

## Structural Blob Changes

Private blobs now track their visibility spaces:

```go
type structuralBlob struct {
    // ...
    Visibility       Visibility
    VisibilitySpaces []core.Principal  // New field
}
```

## Capability-Based Access

Users can grant access to others via capabilities:

```go
// Query to find authorized spaces via capabilities
SELECT DISTINCT pk_author.principal
FROM structural_blobs sb
WHERE sb.type = 'Capability'
  AND sb.extra_attrs->>'role' = 'WRITER'
  AND pk_del.principal IN (user_accounts)
```

A `WRITER` capability grants access to private content in the delegating account's space.

## Flow Diagrams

### Private Document Creation
```
1. User creates document with Visibility: Private
2. Change blob indexed with VisibilitySpaces: [owner_principal]
3. recordBlobVisibility(blob_id, owner_key_id)
4. propagateVisibility() applies to linked blobs (DagPB, Raw)
```

### Private Document Sync (Pull)
```
1. Client initiates sync with server (siteUrl peer)
2. computeAuthInfo() finds which keys have access
3. authenticateWithPeer() proves account ownership
4. Server runs GetAuthorizedSpacesForPeer()
5. RBSR store filtered to only authorized blobs
6. Bitswap serves blobs (CanPeerAccessCID check)
```

### Private Document Sync (Push)
```
1. Client calls AddAllowlist() for CIDs being pushed
2. Server pulls via bitswap
3. isAllowlisted() check passes during push
4. RemoveAllowlist() called on completion
```

## Key Files Modified

| File | Purpose |
|------|---------|
| `blob/index_access.go` | Access control logic (new) |
| `blob/peer_auth.go` | Peer authentication (new) |
| `blob/site_peer_resolver.go` | siteUrl resolution (new) |
| `blob/index_visibility.go` | Visibility propagation |
| `hmnet/syncing/authorized_store.go` | Filtered RBSR store (new) |
| `hmnet/syncing/syncing.go` | Auth integration |
| `hmnet/syncing/server.go` | Server-side filtering |
| `storage/schema.sql` | blob_visibility table |

## Security Considerations

1. **Token Freshness**: Auth tokens valid only within ±1 minute window
2. **Per-Connection**: Auth state cleared on peer disconnect
3. **Signature Verification**: All capabilities cryptographically verified
4. **Conservative Denial**: On errors, access is denied
5. **Space Isolation**: Private blobs require explicit space authorization
