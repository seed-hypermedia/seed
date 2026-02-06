package blob

import (
	"context"
	"fmt"
	"seed/backend/core"
	"seed/backend/ipfs"
	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"
	"time"

	"github.com/ipfs/go-cid"
	"github.com/libp2p/go-libp2p/core/peer"
)

// AuthenticatePeer verifies an authentication token and stores the authenticated peer.
// This method is called when a peer sends an authentication request.
func (idx *Index) AuthenticatePeer(callerPID peer.ID, account core.Principal, serverPID peer.ID, ts time.Time, sig core.Signature) error {
	return idx.peerAuth.authenticatePeer(callerPID, account, serverPID, ts, sig)
}

// ClearPeer removes all authentication state and allowlist for a disconnected peer.
func (idx *Index) ClearPeer(pid peer.ID) {
	idx.peerAuth.clearPeer(pid)

	// Also clean up any allowlist entries for this peer.
	idx.allowlistMu.Lock()
	defer idx.allowlistMu.Unlock()
	delete(idx.allowlistEntries, pid)
}

// isAuthenticated checks if a peer has authenticated with a specific account.
func (idx *Index) isAuthenticated(peerID peer.ID, account core.Principal) bool {
	return idx.peerAuth.isAuthenticated(peerID, account)
}

// ResolveSiteURL resolves a site URL to peer.ID using the cache.
func (idx *Index) ResolveSiteURL(ctx context.Context, siteURL string) (peer.AddrInfo, error) {
	return idx.sitePeerResolver.getAddrInfo(ctx, siteURL)
}

// ResolveSiteConfig resolves a site URL to its full config using the cache.
// This includes the registered account ID if available.
func (idx *Index) ResolveSiteConfig(ctx context.Context, siteURL string) (SiteConfigResponse, error) {
	return idx.sitePeerResolver.getConfig(ctx, siteURL)
}

// CanPeerAccessCID checks if a peer can access a specific CID.
// This method has the signature required by bitswap.WithPeerBlockRequestFilter.
// Access is granted if:
//  1. The CID is allowlisted for an active push operation, OR
//  2. We have the blob locally, AND
//     a. The blob is public (no visibility spaces), OR
//     b. The peer can access at least one of the blob's visibility spaces.
func (idx *Index) CanPeerAccessCID(peerID peer.ID, c cid.Cid) bool {
	ctx := context.Background()
	// Fast path: check if blob is allowlisted for this peer (e.g., during push).
	if idx.isAllowlisted(peerID, c) {
		return true
	}

	// Fast path: check if blob is public before doing more expensive space-based checks.
	dbdata, err := idx.isBlobPublic(ctx, c)
	if err != nil {
		return false
	}
	if dbdata.IsPublic {
		return true
	}

	// Enforce visibility-based authorization.
	spaces, err := idx.getBlobSpaces(ctx, dbdata.ID)
	if err != nil {
		// On errors (e.g., DB issues), deny conservatively.
		return false
	}

	// If blob has no spaces, it's public.
	if len(spaces) == 0 {
		return true
	}

	// Check if peer can access any of the spaces.
	for _, space := range spaces {
		canAccess, err := idx.canPeerAccessSpace(ctx, peerID, space)
		if err != nil {
			// Log error but continue checking other spaces.
			_ = err
			continue
		}
		if canAccess {
			return true
		}
	}

	return false
}

// canPeerAccessSpace checks if a peer can access a space (account).
// Access is granted if the peer:
// 1. Is authenticated with the space account, OR
// 2. Is the siteUrl server for the space, OR
// 3. Is authenticated with an account that has a capability granting access to the space.
func (idx *Index) canPeerAccessSpace(ctx context.Context, peerID peer.ID, spaceAccount core.Principal) (bool, error) {
	// Check if peer has authenticated with the space account.
	if idx.peerAuth.isAuthenticated(peerID, spaceAccount) {
		return true, nil
	}

	// Check if peer is the siteURL server for this space.
	isSiteURLServer, err := idx.checkSiteURLPeer(ctx, peerID, spaceAccount)
	if err != nil {
		// Log error but don't fail on siteURL check.
		_ = err
	}

	if isSiteURLServer {
		return true, nil
	}

	// Check if peer has capability-based access via any of their authenticated accounts.
	accounts := idx.peerAuth.accountsForPeer(peerID)
	if len(accounts) > 0 {
		authorizedSpaces, err := idx.GetAuthorizedSpaces(ctx, accounts)
		if err == nil {
			for _, space := range authorizedSpaces {
				if space.Equal(spaceAccount) {
					return true, nil
				}
			}
		}
	}

	return false, nil
}

// checkSiteURLPeer checks if the peer is the siteURL server for a space.
func (idx *Index) checkSiteURLPeer(ctx context.Context, peerID peer.ID, spaceAccount core.Principal) (bool, error) {
	// Get the siteURL from the space's home document.
	siteURL, err := idx.GetSiteURL(ctx, spaceAccount)
	if err != nil || siteURL == "" {
		return false, err
	}

	// Resolve siteURL to peer ID using cache.
	resolvedPeerID, err := idx.sitePeerResolver.getPeerID(ctx, siteURL)
	if err != nil {
		return false, err
	}

	return resolvedPeerID == peerID, nil
}

// AddAllowlist adds an allowlist entry for a specific push request.
// The requestID uniquely identifies the push request, allowing multiple
// concurrent pushes to the same peer.
func (idx *Index) AddAllowlist(peerID peer.ID, requestID string, cids []cid.Cid) {
	idx.allowlistMu.Lock()
	defer idx.allowlistMu.Unlock()

	// Ensure peer entry exists
	if idx.allowlistEntries[peerID] == nil {
		idx.allowlistEntries[peerID] = make(map[string]map[cid.Cid]struct{})
	}

	// Create CID set for this request
	cidSet := make(map[cid.Cid]struct{}, len(cids))
	for _, c := range cids {
		cidSet[c] = struct{}{}
	}

	idx.allowlistEntries[peerID][requestID] = cidSet
}

// RemoveAllowlist removes the allowlist entry for a specific push request.
// This should be called when the push request completes or fails.
func (idx *Index) RemoveAllowlist(peerID peer.ID, requestID string) {
	idx.allowlistMu.Lock()
	defer idx.allowlistMu.Unlock()

	if peerEntries, ok := idx.allowlistEntries[peerID]; ok {
		delete(peerEntries, requestID)

		// Clean up empty peer entry
		if len(peerEntries) == 0 {
			delete(idx.allowlistEntries, peerID)
		}
	}
}

// isAllowlisted checks if a CID is allowlisted for a peer.
// Returns true if the CID is allowlisted in any active push request for the peer.
func (idx *Index) isAllowlisted(peerID peer.ID, c cid.Cid) bool {
	idx.allowlistMu.RLock()
	defer idx.allowlistMu.RUnlock()

	peerEntries, ok := idx.allowlistEntries[peerID]
	if !ok {
		return false
	}

	// Check if CID exists in any request for this peer
	for _, cidSet := range peerEntries {
		if _, found := cidSet[c]; found {
			return true
		}
	}

	return false
}

// getBlobSpaces returns all spaces (accounts) that a blob belongs to.
// A blob can belong to multiple spaces, or be public (no space).
func (idx *Index) getBlobSpaces(ctx context.Context, blobID int64) ([]core.Principal, error) {
	var spaces []core.Principal
	err := idx.db.WithSave(ctx, func(conn *sqlite.Conn) (err error) {
		rows, discard, check := sqlitex.Query(conn, `
			SELECT DISTINCT pk.principal
			FROM blob_visibility bv
			LEFT JOIN public_keys pk ON pk.id = bv.space
			WHERE bv.id = ?
		`, blobID).All()
		defer discard(&err)

		for row := range rows {
			principal := core.Principal(row.ColumnBytes(0))
			// If we got empty principal it means the blob is public,
			// and not bound to any particular space.
			if len(principal) == 0 {
				continue
			}
			spaces = append(spaces, principal)
		}
		return check()
	})
	return spaces, err
}

// isBlobPublic checks if a blob is public using the public_blobs view.
func (idx *Index) isBlobPublic(ctx context.Context, c cid.Cid) (resp struct {
	ID       int64
	IsPublic bool
}, err error) {
	err = idx.db.WithSave(ctx, func(conn *sqlite.Conn) (err error) {
		_, hash := ipfs.DecodeCID(c)

		dbpub, err := dbBlobsGetSize(conn, hash, false)
		if err != nil {
			return err
		}

		if dbpub.BlobsID == 0 || dbpub.BlobsSize < 0 {
			return fmt.Errorf("blob not found")
		}

		resp.ID = dbpub.BlobsID

		rows, discard, check := sqlitex.Query(conn, `
			SELECT 1 FROM public_blobs WHERE id = ? LIMIT 1
		`, dbpub.BlobsID).All()
		defer discard(&err)

		for range rows {
			resp.IsPublic = true
			break
		}
		return check()
	})
	return resp, err
}

// GetAuthorizedSpaces returns the spaces that the given accounts can access.
// This includes the accounts themselves plus any spaces where the accounts have
// been granted access via WRITER or OWNER capabilities.
func (idx *Index) GetAuthorizedSpaces(ctx context.Context, accounts []core.Principal) ([]core.Principal, error) {
	if len(accounts) == 0 {
		return nil, nil
	}

	// Start with the accounts themselves — users can always access their own space.
	spaces := make([]core.Principal, 0, len(accounts))
	spaces = append(spaces, accounts...)

	err := idx.db.WithSave(ctx, func(conn *sqlite.Conn) error {
		// Query capabilities where any of the accounts is a delegate.
		// The resource owner (space) is the signer of the capability.
		// IMPORTANT: 'del' in extra_attrs is stored as the public_keys.id (integer), not the principal.
		// We look for WRITER role which grants access to private content.
		const q = `
			SELECT DISTINCT pk_author.principal
			FROM structural_blobs sb
			JOIN public_keys pk_author ON pk_author.id = sb.author
			JOIN public_keys pk_del ON pk_del.id = sb.extra_attrs->>'del'
			WHERE sb.type = 'Capability'
			AND pk_del.principal IN (SELECT unhex(value) FROM json_each(?))
			AND sb.extra_attrs->>'role' = 'WRITER'
		`

		// Build JSON array of account principals as hex strings for the query.
		accountsJSON := "["
		for i, acc := range accounts {
			if i > 0 {
				accountsJSON += ","
			}
			accountsJSON += `"` + fmt.Sprintf("%X", []byte(acc)) + `"`
		}
		accountsJSON += "]"

		rows, discard, check := sqlitex.Query(conn, q, accountsJSON).All()
		defer func() {
			var err error
			discard(&err)
		}()

		for row := range rows {
			space := core.Principal(row.ColumnBytes(0))
			if len(space) > 0 {
				spaces = append(spaces, space)
			}
		}
		return check()
	})
	if err != nil {
		return nil, err
	}

	return spaces, nil
}

// GetAuthorizedSpacesForPeer computes which spaces a peer can access.
// It considers:
//  1. Spaces the peer owns (authenticated accounts).
//  2. Spaces the peer has capability access to (via GetAuthorizedSpaces).
//  3. Spaces where the peer is the siteURL server (for given resources).
//
// The requestedResources parameter is used for siteURL checking — if the peer
// is the siteURL server for a space, they can access that space's private content.
func (idx *Index) GetAuthorizedSpacesForPeer(ctx context.Context, pid peer.ID, requestedResources []IRI) ([]core.Principal, error) {
	// Get accounts this peer has authenticated with.
	accounts := idx.peerAuth.accountsForPeer(pid)

	// Get all spaces these accounts can access (including via capabilities).
	spaces, err := idx.GetAuthorizedSpaces(ctx, accounts)
	if err != nil {
		return nil, err
	}

	// Build a set for deduplication.
	seenSpaces := make(map[string]struct{}, len(spaces))
	for _, sp := range spaces {
		seenSpaces[sp.String()] = struct{}{}
	}

	// Check if the peer is the siteURL server for any of the requested resources.
	for _, iri := range requestedResources {
		space, _, err := iri.SpacePath()
		if err != nil {
			continue
		}

		// Skip if already authorized.
		if _, ok := seenSpaces[space.String()]; ok {
			continue
		}

		// Check if this peer is the siteURL server for this space.
		isSiteURL, err := idx.checkSiteURLPeer(ctx, pid, space)
		if err == nil && isSiteURL {
			spaces = append(spaces, space)
			seenSpaces[space.String()] = struct{}{}
		}
	}

	return spaces, nil
}
