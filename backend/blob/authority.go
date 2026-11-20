package blob

import (
	"context"
	"fmt"
	"maps"
	"seed/backend/core"
	"seed/backend/keyline"
	"seed/backend/keyline/keylinesqlite"
	"seed/backend/util/dqb"
	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"
	"slices"
	"strings"

	"github.com/ipfs/go-cid"
	"go.uber.org/zap"
)

// keyline.md describes this projection; keep it in step with this file.

// authorityVersion identifies the projection's node naming and edge rules.
// Changing it rebuilds the projection at startup.
const authorityVersion = "3"

// One key plays three roles, so it gets three authority nodes: the account
// itself (key), the members of its space (space), and documents inside that
// space (resource). The space's home document is the space node, since grants
// are recursive and an empty path already means the whole space.
const (
	authorityKeyPrefix      = "key:"
	authoritySpacePrefix    = "space:"
	authorityResourcePrefix = "resource:"
)

// authority evaluates Seed's graph. Owner and path inheritance edges follow
// from node names, so they are computed here and never stored.
var authority = keyline.Evaluator{Parent: authorityParent}

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

// authorityParent gives a resource's parent scope, a top-level resource's
// space, and a space's owning key. Keys have no parent.
func authorityParent(n keyline.Node) (keyline.Node, bool) {
	if rest, ok := strings.CutPrefix(string(n), authorityResourcePrefix); ok {
		first, last := strings.IndexByte(rest, '/'), strings.LastIndexByte(rest, '/')
		if first < 0 {
			return "", false
		}

		if first == last {
			return keyline.Node(authoritySpacePrefix + rest[:first]), true
		}

		return keyline.Node(authorityResourcePrefix + rest[:last]), true
	}

	if rest, ok := strings.CutPrefix(string(n), authoritySpacePrefix); ok {
		return keyline.Node(authorityKeyPrefix + rest), true
	}

	return "", false
}

// projectAuthorityCapability stores a capability's delegation and records the
// change in batch. The members cache is refreshed when the batch is flushed.
//
// An AGENT capability gives its delegate Write over the signer's key, in
// either direction: forward (account to session key) and reverse (session key
// to account) capabilities look the same, and neither may grant Admin.
func projectAuthorityCapability(conn *sqlite.Conn, batch *indexBatch, blobID int64, c cid.Cid, capability *Capability) error {
	var subject keyline.Node

	switch capability.Role {
	case RoleAgent:
		subject = keyNode(capability.Signer)
	case RoleWriter:
		iri, err := NewIRI(capability.Space(), capability.Path)
		if err != nil {
			return err
		}

		subject = resourceNode(iri)
	default:
		// Older indexes retained unknown roles without granting them authority.
		return nil
	}

	delegate := keyNode(capability.Delegate)

	changed, err := (keylinesqlite.Tx{Conn: conn}).Apply(context.Background(), keyline.Batch{Delegations: []keyline.Delegation{{
		ID: keyline.ID(c.String()), Issuer: keyNode(capability.Signer), Audience: delegate,
		Subject: subject, Power: keyline.Write, BlobID: blobID,
	}}})
	if err != nil || !changed {
		return err
	}

	batch.authoritySubjects[subject] = true
	batch.authorityDelegates[delegate] = true
	return nil
}

// flushAuthority refreshes keyline_members for every subject the batch's
// capabilities changed, then retries blobs denied to the new delegates and to
// keys acting for them. Retried blobs may index more capabilities, so it
// repeats until nothing is pending.
//
// keyline_members caches members of every delegation subject and of each
// key subject's space. A changed subject also invalidates every cached subject
// it is a member of. All stale subjects are evaluated together, so the
// authority graph they share is evaluated once per flush, not once per
// capability. Seed's signed format has grants only; a revocation projection
// would also need to invalidate through historical reach.
func (b *indexBatch) flushAuthority(opts indexOpts, conn *sqlite.Conn, bs *blockStore, log *zap.Logger, hookIDs *[]int64) error {
	ctx := context.Background()
	tx := keylinesqlite.Tx{Conn: conn}

	for len(b.authoritySubjects) > 0 || len(b.authorityDelegates) > 0 {
		subjects, delegates := b.authoritySubjects, b.authorityDelegates
		b.authoritySubjects, b.authorityDelegates = make(map[keyline.Node]bool), make(map[keyline.Node]bool)
		clear(b.writers)

		stale := make(map[keyline.Node]bool, len(subjects))
		for subject := range subjects {
			stale[subject] = true
			if principal, ok := strings.CutPrefix(string(subject), authorityKeyPrefix); ok {
				stale[keyline.Node(authoritySpacePrefix+principal)] = true
			}

			if err := sqlitex.Exec(conn, qAuthorityDependents(), func(row *sqlite.Stmt) error {
				stale[keyline.Node(row.ColumnText(0))] = true
				return nil
			}, subject); err != nil {
				return err
			}
		}

		roots := slices.Collect(maps.Keys(stale))
		for delegate := range delegates {
			if !stale[delegate] {
				roots = append(roots, delegate)
			}
		}

		members, err := authority.MembersOf(ctx, tx, roots)
		if err != nil {
			return err
		}

		ids := make(map[keyline.Node]int64)
		for subject := range stale {
			if err := writeAuthorityMembers(ctx, tx, ids, subject, members[subject]); err != nil {
				return err
			}
		}

		signers := make(map[string]bool)
		for delegate := range delegates {
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

// writeAuthorityMembers replaces subject's cached members, writing only rows
// that changed. ids memoizes interned node IDs across one flush.
func writeAuthorityMembers(ctx context.Context, tx keylinesqlite.Tx, ids map[keyline.Node]int64, subject keyline.Node, members map[keyline.Node]keyline.Power) error {
	intern := func(n keyline.Node) (int64, error) {
		if id, ok := ids[n]; ok {
			return id, nil
		}

		id, err := tx.InternNode(ctx, n)
		if err != nil {
			return 0, err
		}

		ids[n] = id
		return id, nil
	}

	subjectID, err := intern(subject)
	if err != nil {
		return err
	}

	want := make(map[int64]string, len(members))
	for member, power := range members {
		id, err := intern(member)
		if err != nil {
			return err
		}

		want[id] = power.String()
	}

	have := make(map[int64]string)

	if err := sqlitex.Exec(tx.Conn, qAuthorityMembers(), func(row *sqlite.Stmt) error {
		have[row.ColumnInt64(0)] = row.ColumnText(1)
		return nil
	}, subjectID); err != nil {
		return err
	}

	for member := range have {
		if _, ok := want[member]; !ok {
			if err := sqlitex.Exec(tx.Conn, qAuthorityDeleteMember(), nil, subjectID, member); err != nil {
				return err
			}
		}
	}

	for member, power := range want {
		if have[member] == power {
			continue
		}

		if err := sqlitex.Exec(tx.Conn, qAuthorityUpsertMember(), nil, subjectID, member, power); err != nil {
			return err
		}
	}

	return nil
}

// AuthorityBlobIDs selects existing signed blobs needed to evaluate authority
// over resource. It includes ancestor grants and transitive AGENT capabilities,
// even when the requested resource has no local record yet. The caller owns conn;
// finish active statements before calling. The returned IDs are local to conn.
//
// Ownership and path inheritance are computed from node names at the receiver,
// so only Capability blobs need transferring.
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
	for record, err := range authority.Closure(ctx, tx, resourceNode(resource)) {
		if err != nil {
			return nil, err
		}

		if d, ok := record.(keyline.Delegation); ok && !seen[d.BlobID] {
			seen[d.BlobID] = true
			ids = append(ids, d.BlobID)
		}
	}

	slices.Sort(ids)
	return ids, nil
}

// backfillAuthority upgrades only the disposable authority projection. It reads
// the already authenticated structural index and leaves signed bytes, document
// generations, embeddings, and the full-reindex timestamp untouched.
func (idx *Index) backfillAuthority(conn *sqlite.Conn) error {
	version, err := sqlitex.QueryOne[string](conn, qAuthorityVersion())
	if err != nil || version == authorityVersion {
		return err
	}

	return idx.rebuildAuthority(conn)
}

// rebuildAuthority replaces the projection from surviving Capability blobs,
// then retries every blob that was denied permission, since the rules may have
// changed.
func (idx *Index) rebuildAuthority(conn *sqlite.Conn) error {
	return sqlitex.WithTx(conn, func() error {
		for _, query := range []string{qAuthorityClearMembers(), qAuthorityClearRevocations(), qAuthorityClearDelegations(), qAuthorityClearNodes()} {
			if err := sqlitex.Exec(conn, query, nil); err != nil {
				return err
			}
		}

		type capabilityRow struct {
			BlobID   int64
			Codec    int64
			Hash     []byte
			Signer   core.Principal
			Delegate core.Principal
			IRI      IRI
			Role     Role
		}

		// Buffer metadata, not blob contents, so no live cursor overlaps a
		// Keyline operation on this connection.
		var capabilities []capabilityRow

		if err := sqlitex.Exec(conn, qAuthorityBackfillCapabilities(), func(row *sqlite.Stmt) error {
			capabilities = append(capabilities, capabilityRow{
				BlobID: row.ColumnInt64(0), Codec: row.ColumnInt64(1), Hash: row.ColumnBytes(2),
				Signer: row.ColumnBytes(3), Delegate: row.ColumnBytes(4), IRI: IRI(row.ColumnText(5)), Role: Role(row.ColumnText(6)),
			})
			return nil
		}); err != nil {
			return err
		}

		batch := newIndexBatch()
		for _, row := range capabilities {
			// Preserve the signed path bytes, including literal percent escapes.
			path := strings.TrimPrefix(string(row.IRI), "hm://"+row.Signer.String())

			capability := &Capability{BaseBlob: BaseBlob{Signer: row.Signer}, Delegate: row.Delegate, Path: path, Role: row.Role}
			if err := projectAuthorityCapability(conn, batch, row.BlobID, cid.NewCidV1(uint64(row.Codec), row.Hash), capability); err != nil {
				return err
			}
		}

		opts := indexOpts{DeriveDocFields: idx.docFieldsDeriver()}
		if err := batch.flush(opts, conn, idx.bs, idx.log, nil); err != nil {
			return err
		}

		if err := reindexStashedBlobs(opts, conn, stashReasonPermissionDenied, "", idx.bs, idx.log, batch, nil); err != nil {
			return err
		}

		if err := batch.flush(opts, conn, idx.bs, idx.log, nil); err != nil {
			return err
		}

		if err := sqlitex.Exec(conn, qAuthorityStaleScopes(), nil); err != nil {
			return fmt.Errorf("invalidate pre-Keyline sync scopes: %w", err)
		}

		return sqlitex.Exec(conn, qAuthoritySetVersion(), nil, authorityVersion)
	})
}

var (
	qAuthorityDependents = dqb.Str(`
		SELECT subject.name FROM keyline_members m
		JOIN keyline_nodes subject ON subject.id = m.subject
		WHERE m.member = (SELECT id FROM keyline_nodes WHERE name = ?)
	`)
	qAuthorityMembers      = dqb.Str(`SELECT member, power FROM keyline_members WHERE subject = ?`)
	qAuthorityDeleteMember = dqb.Str(`DELETE FROM keyline_members WHERE subject = ? AND member = ?`)
	qAuthorityUpsertMember = dqb.Str(`
		INSERT INTO keyline_members(subject, member, power) VALUES (?, ?, ?)
		ON CONFLICT(subject, member) DO UPDATE SET power = excluded.power
	`)
	qAuthorityVersion              = dqb.Str(`SELECT coalesce((SELECT value FROM kv WHERE key = 'keyline_projection_version'), '')`)
	qAuthoritySetVersion           = dqb.Str(`INSERT OR REPLACE INTO kv(key, value) VALUES ('keyline_projection_version', ?)`)
	qAuthorityClearMembers         = dqb.Str(`DELETE FROM keyline_members`)
	qAuthorityClearRevocations     = dqb.Str(`DELETE FROM keyline_revocations`)
	qAuthorityClearDelegations     = dqb.Str(`DELETE FROM keyline_delegations`)
	qAuthorityClearNodes           = dqb.Str(`DELETE FROM keyline_nodes`)
	qAuthorityStaleScopes          = dqb.Str(`UPDATE rbsr_scope SET materialized = 0 WHERE materialized = 1`)
	qAuthorityBackfillCapabilities = dqb.Str(`
		SELECT sb.id, b.codec, b.multihash, author.principal, delegate.principal, r.iri, sb.extra_attrs->>'role'
		FROM structural_blobs sb
		JOIN blobs b ON b.id = sb.id
		JOIN public_keys author ON author.id = sb.author
		JOIN public_keys delegate ON delegate.id = sb.extra_attrs->>'del'
		JOIN resources r ON r.id = sb.resource
		WHERE sb.type = 'Capability' ORDER BY sb.id
	`)
)
