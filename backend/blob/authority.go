package blob

import (
	"context"
	"fmt"
	"maps"
	"seed/backend/blob/keylinesqlite"
	"seed/backend/core"
	"seed/backend/keyline"
	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"
	"slices"
	"strconv"
	"strings"

	"github.com/ipfs/go-cid"
	"go.uber.org/zap"
)

// keyline.md describes this projection; keep it in step with this file.

// One key plays three roles, so it gets three authority nodes: the account
// itself (key), the members of its space (space), and documents inside that
// space (resource). The space's home document is the space node, since grants
// are recursive and an empty path already means the whole space.
const (
	authorityKeyPrefix      = "key:"
	authoritySpacePrefix    = "space:"
	authorityResourcePrefix = "resource:"
)

// keyNode names an account identity.
func keyNode(p core.Principal) keyline.Node {
	return keyline.Node(authorityKeyPrefix + p.String())
}

// resourceNode names the scope of a document IRI. A space root IRI names the
// space node.
func resourceNode(iri IRI) keyline.Node {
	rest := strings.TrimPrefix(string(iri), "hm://")
	if !strings.Contains(rest, "/") {
		return keyline.Node(authoritySpacePrefix + rest)
	}

	return keyline.Node(authorityResourcePrefix + rest)
}

// sqlAuthorityNode is resourceNode in SQL, for an expression holding an hm:// IRI.
func sqlAuthorityNode(iriExpr string) string {
	return fmt.Sprintf(`(CASE WHEN instr(substr(%[1]s, 6), '/') = 0 THEN 'space:' ELSE 'resource:' END || substr(%[1]s, 6))`, iriExpr)
}

// Root edges are implied delegations named after the scope they ground:
// owner:<space>/<path> for a resource and space-owner:<space> for a space.
const (
	authorityOwnerPrefix      = "owner:"
	authoritySpaceOwnerPrefix = "space-owner:"
)

// authorityScopes lists the nodes whose authority covers resource, from the
// owner's key down: key:<owner>, space:<owner>, then each ancestor resource and
// resource itself. Grants are recursive, so Write over any of them is Write
// over resource, including resources that do not exist yet.
func authorityScopes(resource IRI) []keyline.Node {
	breadcrumbs := resource.Breadcrumbs()
	space := strings.TrimPrefix(string(breadcrumbs[0]), "hm://")
	nodes := make([]keyline.Node, 0, len(breadcrumbs)+1)
	nodes = append(nodes, keyline.Node(authorityKeyPrefix+space))
	for _, iri := range breadcrumbs {
		nodes = append(nodes, resourceNode(iri))
	}

	return nodes
}

// sqlAuthorityCanWrite is an SQL expression that is true when the key named by
// the SQL expression member holds Write over any node named in the SQL
// expression list scopes.
func sqlAuthorityCanWrite(scopes, member string) string {
	return keylinesqlite.SQLReaches(scopes, member, strconv.Itoa(int(keyline.Write)))
}

// sqlKeyNode and sqlSpaceNode name a principal column's key and space nodes in SQL.
func sqlKeyNode(principal string) string {
	return `'` + authorityKeyPrefix + `z' || base58btc_encode(` + principal + `)`
}

func sqlSpaceNode(principal string) string {
	return `'` + authoritySpacePrefix + `z' || base58btc_encode(` + principal + `)`
}

// projectAuthorityCapability stores a capability's delegation, with the root
// edges that ground it, and records the new delegate in batch.
//
// A WRITER capability's signer owns the space it names, and Keyline grounds a
// delegation only through its issuer's standing over the subject. Like
// upstream's root delegation from a document to its owners, two Admin edges
// carry that ownership: from the resource to its space, issued by the resource,
// and from the space to the signer's key, issued by the space. A capability on
// the space root needs only the second. Ownership follows from how nodes are
// named, not from the capability, so root edges are implied delegations with
// no blob, named after their scope: every capability that needs one repeats
// it exactly, and a scope has one however many capabilities it has. Authority
// over ancestors is checked by callers through authorityScopes, so
// intermediate path segments need no edges.
//
// An AGENT capability gives its delegate Write over the signer's key, in
// either direction: forward (account to session key) and reverse (session key
// to account) capabilities look the same, and neither may grant Admin. The
// signer's key needs no grounding.
func projectAuthorityCapability(conn *sqlite.Conn, batch *indexBatch, blobID int64, c cid.Cid, capability *Capability) error {
	issuer := keyNode(capability.Signer)
	delegate := keyNode(capability.Delegate)
	id := c.String()
	var facts []keyline.Delegation

	switch capability.Role {
	case RoleAgent:
		facts = append(facts, keyline.Delegation{
			ID: keyline.ID(id), Issuer: issuer, Audience: delegate, Subject: issuer, Power: keyline.Write, BlobID: blobID,
		})
	case RoleWriter:
		iri, err := NewIRI(capability.Space(), capability.Path)
		if err != nil {
			return err
		}

		subject := resourceNode(iri)
		spaceName := capability.Space().String()
		space := keyline.Node(authoritySpacePrefix + spaceName)

		facts = append(facts, keyline.Delegation{
			ID: keyline.ID(id), Issuer: issuer, Audience: delegate, Subject: subject, Power: keyline.Write, BlobID: blobID,
		}, keyline.Delegation{
			ID: keyline.ID(authoritySpaceOwnerPrefix + spaceName), Issuer: space, Audience: issuer, Subject: space, Power: keyline.Admin,
		})
		if subject != space {
			facts = append(facts, keyline.Delegation{
				ID:     keyline.ID(authorityOwnerPrefix + strings.TrimPrefix(string(subject), authorityResourcePrefix)),
				Issuer: subject, Audience: space, Subject: subject, Power: keyline.Admin,
			})
		}
	default:
		// Older indexes retained unknown roles without granting them authority.
		return nil
	}

	changed, err := (keylinesqlite.Tx{Conn: conn}).Apply(context.Background(), keyline.Batch{Delegations: facts})
	if err != nil || !changed {
		return err
	}

	batch.authorityDelegates[delegate] = true
	return nil
}

// flushAuthority retries blobs denied to the batch's new delegates and to keys
// acting for them. Applying a capability already updated the stored edges
// that answer authority checks. Retried blobs may index more capabilities, so
// it repeats until nothing is pending.
func (b *indexBatch) flushAuthority(opts indexOpts, conn *sqlite.Conn, bs *blockStore, log *zap.Logger, hookIDs *[]int64) error {
	ctx := context.Background()
	tx := keylinesqlite.Tx{Conn: conn}

	for len(b.authorityDelegates) > 0 {
		delegates := slices.Sorted(maps.Keys(b.authorityDelegates))
		clear(b.authorityDelegates)
		clear(b.writers)

		members, err := keyline.MembersOf(ctx, tx, delegates)
		if err != nil {
			return err
		}

		signers := make(map[string]bool)
		for _, delegate := range delegates {
			signers[strings.TrimPrefix(string(delegate), authorityKeyPrefix)] = true
			for member := range members[delegate] {
				if principal, ok := strings.CutPrefix(string(member), authorityKeyPrefix); ok {
					signers[principal] = true
				}
			}
		}

		for _, signer := range slices.Sorted(maps.Keys(signers)) {
			if err := reindexStashedBlobs(opts, conn, stashReasonPermissionDenied, signer, bs, log, b, hookIDs); err != nil {
				return err
			}
		}
	}

	return nil
}

// AuthorityBlobIDs selects existing signed blobs needed to evaluate authority
// over resource. It includes ancestor grants and transitive AGENT capabilities,
// even when the requested resource has no local record yet. The caller owns conn;
// finish active statements before calling. The returned IDs are local to conn.
//
// Only Capability blobs need transferring. Implied delegations, such as root
// edges, have no blob: receivers derive them from the capabilities.
func AuthorityBlobIDs(ctx context.Context, conn *sqlite.Conn, resource IRI) (ids []int64, err error) {
	if !strings.HasPrefix(string(resource), "hm://") {
		return nil, fmt.Errorf("invalid authority resource: %q", resource)
	}

	// Parse only the authority, not the signed path. Legacy NewIRI accepts
	// literal percent characters that are not URL escapes.
	if _, _, err := resource.Breadcrumbs()[0].SpacePath(); err != nil {
		return nil, err
	}

	defer sqlitex.Save(conn)(&err)
	tx := keylinesqlite.Tx{Conn: conn}
	seen := make(map[int64]bool)
	for _, scope := range authorityScopes(resource) {
		for record, err := range keyline.Closure(ctx, tx, scope) {
			if err != nil {
				return nil, err
			}

			if d, ok := record.(keyline.Delegation); ok && !d.Implied() && !seen[d.BlobID] {
				seen[d.BlobID] = true
				ids = append(ids, d.BlobID)
			}
		}
	}

	slices.Sort(ids)
	return ids, nil
}
