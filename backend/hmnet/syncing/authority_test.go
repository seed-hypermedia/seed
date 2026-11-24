package syncing

import (
	"testing"

	"seed/backend/blob"
	"seed/backend/core"
	"seed/backend/core/coretest"
	"seed/backend/storage"
	"seed/backend/util/cclock"
	"seed/backend/util/colx"
	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"

	blocks "github.com/ipfs/go-block-format"
	"github.com/ipfs/go-cid"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
)

type authorityFixture struct {
	db      *sqlitex.Pool
	idx     *blob.Index
	owner   *core.KeyPair
	clock   *cclock.Clock
	child   blob.IRI
	caps    []blocks.Block
	private []blocks.Block
}

func newAuthorityFixture(t *testing.T, withCaps bool) authorityFixture {
	t.Helper()
	f := authorityFixture{
		db:    storage.MakeTestDB(t),
		owner: coretest.NewTester("alice").Account,
		clock: cclock.New(),
	}
	var err error

	f.idx, err = blob.OpenIndex(t.Context(), f.db, zap.NewNop())
	require.NoError(t, err)
	f.child = blob.IRI("hm://" + f.owner.Principal().String() + "/parent/child")
	bob := coretest.NewTester("bob").Account
	carol := coretest.NewTester("carol").Account
	david := coretest.NewTester("david").Account
	for _, grant := range []struct {
		issuer   *core.KeyPair
		delegate core.Principal
		path     string
		role     blob.Role
	}{
		{f.owner, bob.Principal(), "/parent", blob.RoleWriter},
		{bob, carol.Principal(), "", blob.RoleAgent},
		{carol, david.Principal(), "", blob.RoleAgent},
		{f.owner, david.Principal(), "/unrelated", blob.RoleWriter},
	} {
		capability, err := blob.NewCapability(grant.issuer, grant.delegate, grant.issuer.Principal(), grant.path, grant.role, "", f.clock.MustNow())
		require.NoError(t, err)
		f.caps = append(f.caps, capability)
	}

	f.putDocument(t, f.owner, "/parent/child", blob.VisibilityPublic)
	f.private = f.putDocument(t, bob, "/private", blob.VisibilityPrivate)
	profile, err := blob.NewProfile(carol, "Carol", "", "", carol.Principal(), f.clock.MustNow())
	require.NoError(t, err)
	require.NoError(t, f.idx.Put(t.Context(), profile))
	f.private = append(f.private, profile)
	// These identities were first projected from private content and a profile,
	// so their node provenance must not ride along with authority dependencies.
	if withCaps {
		require.NoError(t, f.idx.PutMany(t.Context(), f.caps))
	}

	return f
}

func (f authorityFixture) putDocument(t *testing.T, signer *core.KeyPair, path string, visibility blob.Visibility) []blocks.Block {
	t.Helper()
	change, err := blob.NewChange(signer, cid.Undef, nil, 0, blob.ChangeBody{}, f.clock.MustNow())
	require.NoError(t, err)
	ref, err := blob.NewRef(signer, 0, change.CID, signer.Principal(), path, []cid.Cid{change.CID}, f.clock.MustNow(), visibility)
	require.NoError(t, err)
	blks := []blocks.Block{change, ref}
	require.NoError(t, f.idx.PutMany(t.Context(), blks))
	return blks
}

func (f authorityFixture) id(t *testing.T, b blocks.Block) int64 {
	t.Helper()
	id, err := sqlitex.QueryOnePool[int64](t.Context(), f.db, "SELECT id FROM blobs WHERE multihash = ?", []byte(b.Cid().Hash()))
	require.NoError(t, err)
	return id
}

func TestCollectBlobs_AuthorityDependencies(t *testing.T) {
	t.Parallel()
	f := newAuthorityFixture(t, true)
	for _, tc := range []struct {
		name string
		key  DiscoveryKey
	}{
		{"exact child", DiscoveryKey{IRI: f.child}},
		{"recursive child", DiscoveryKey{IRI: f.child, Recursive: true}},
		{"depth one child", DiscoveryKey{IRI: f.child, DepthOne: true}},
		{"typed exact", DiscoveryKey{IRI: f.child, BlobTypes: "Ref"}},
		{"typed directory", DiscoveryKey{IRI: f.child, DepthOne: true, BlobTypes: dirStructureTypes}},
		{"requested resource without local content", DiscoveryKey{IRI: f.child + "/missing", BlobTypes: "Profile"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := collectDownloadedBlobIDs(t, f.db, tc.key)
			for _, cap := range f.caps[:3] {
				require.Contains(t, got, f.id(t, cap), "ancestor WRITER and both composed AGENT hops must be dependencies")
			}

			require.NotContains(t, got, f.id(t, f.caps[3]), "an unrelated path grant must not enter the closure")
			for _, provenance := range f.private {
				require.NotContains(t, got, f.id(t, provenance), "authority must not bring in private documents or member profiles")
			}
		})
	}
}

func TestMaintainRBSRIndex_AuthorityForwardTarget(t *testing.T) {
	t.Parallel()
	f := newAuthorityFixture(t, true)
	david := coretest.NewTester("david").Account
	landing := blob.IRI("hm://" + david.Principal().String() + "/landing")
	landingBlobs := f.putDocument(t, david, "/landing", blob.VisibilityPublic)
	keys := []DiscoveryKey{
		{IRI: landing},
		{IRI: landing, Recursive: true},
		{IRI: landing, DepthOne: true},
		{IRI: landing, DepthOne: true, BlobTypes: dirStructureTypes},
	}
	scopeIDs := make(map[DiscoveryKey]int64)
	for _, key := range keys {
		scopeIDs[key] = materializeFixtureScope(t, f.db, key)
		require.NotContains(t, itemSetForScope(t, f.db, scopeIDs[key]), f.id(t, f.caps[0]))
	}

	ref, err := blob.NewRef(david, 0, landingBlobs[0].Cid(), david.Principal(), "/landing", []cid.Cid{landingBlobs[0].Cid()}, f.clock.MustNow(), blob.VisibilityPublic)
	require.NoError(t, err)
	require.NoError(t, f.idx.Put(t.Context(), ref))
	refID := f.id(t, ref)
	require.NoError(t, f.db.WithTx(t.Context(), func(conn *sqlite.Conn) error {
		// Model a structural forward dependency outside the requested resource.
		// Only the new Ref joins the scope directly; its target brings authority.
		if err := sqlitex.Exec(conn, `INSERT INTO blob_links (source, type, target)
			SELECT ?, 'test/link', sb.id FROM structural_blobs sb
			JOIN resources r ON r.id = sb.resource WHERE r.iri = ? AND sb.type = 'Ref'`, nil, refID, string(f.child)); err != nil {
			return err
		}

		if err := sqlitex.Exec(conn, `UPDATE rbsr_scope SET last_access = 1`, nil); err != nil {
			return err
		}

		return MaintainRBSRIndex(conn, []int64{refID})
	}))
	for _, key := range keys {
		got := itemSetForScope(t, f.db, scopeIDs[key])
		require.Equal(t, collectDownloadedBlobIDs(t, f.db, key), got)
		for _, capability := range f.caps[:3] {
			require.Contains(t, got, f.id(t, capability))
		}

		require.NotContains(t, got, f.id(t, f.caps[3]))
		for _, provenance := range f.private {
			require.NotContains(t, got, f.id(t, provenance))
		}

		require.True(t, scopeStillMaterialized(t, f.db, scopeIDs[key]))
		lastAccess, err := sqlitex.QueryOnePool[int64](t.Context(), f.db, `SELECT last_access FROM rbsr_scope WHERE id = ?`, scopeIDs[key])
		require.NoError(t, err)
		require.EqualValues(t, 1, lastAccess, "ordinary Ref maintenance must not re-materialize the scope")
	}
}

func TestMaintainRBSRIndex_AuthorityExistingForwardTarget(t *testing.T) {
	t.Parallel()
	f := newAuthorityFixture(t, true)
	var rootGrants []blocks.Block

	for _, name := range []string{"bob", "carol"} {
		issuer := coretest.NewTester(name).Account
		grant, err := blob.NewCapability(issuer, f.owner.Principal(), issuer.Principal(), "", blob.RoleWriter, "", f.clock.MustNow())
		require.NoError(t, err)
		rootGrants = append(rootGrants, grant)
	}

	require.NoError(t, f.idx.PutMany(t.Context(), rootGrants))
	keys := []DiscoveryKey{
		{IRI: f.child},
		{IRI: f.child, Recursive: true},
		{IRI: f.child, DepthOne: true},
		{IRI: f.child, DepthOne: true, BlobTypes: dirStructureTypes},
	}
	scopeIDs := make(map[DiscoveryKey]int64)
	for _, key := range keys {
		scopeIDs[key] = materializeFixtureScope(t, f.db, key)
		got := itemSetForScope(t, f.db, scopeIDs[key])
		require.Contains(t, got, f.id(t, f.caps[1]))
		require.Contains(t, got, f.id(t, f.caps[2]))
		for _, grant := range rootGrants {
			require.NotContains(t, got, f.id(t, grant), "authority-only capabilities must not expand their resource anchors")
		}
	}

	f.idx.SetIndexedHook(MaintainRBSRIndex)
	// Ordinary maintenance must not expand anchors of existing authority-only
	// members either. Neither account root is independently selected yet.
	f.putDocument(t, f.owner, "/parent/child", blob.VisibilityPublic)
	require.NoError(t, f.idx.WaitIndexedHook(t.Context()))
	for _, key := range keys {
		got := itemSetForScope(t, f.db, scopeIDs[key])
		require.Equal(t, collectDownloadedBlobIDs(t, f.db, key), got)
		for _, grant := range rootGrants {
			require.NotContains(t, got, f.id(t, grant))
		}
	}

	// Bob's AGENT capability is already a member, but now also becomes a
	// forward target. Its resource must contribute authority even though the
	// INSERT OR IGNORE for the capability itself adds no row.
	change, err := blob.NewChange(f.owner, cid.Undef, nil, 0, blob.ChangeBody{Ops: []blob.OpMap{
		blob.NewOpReplaceBlock(blob.Block{ID_Good: "file", Type: "File", Link: "ipfs://" + f.caps[1].Cid().String()}),
	}}, f.clock.MustNow())
	require.NoError(t, err)
	ref, err := blob.NewRef(f.owner, 0, change.CID, f.owner.Principal(), "/parent/child", []cid.Cid{change.CID}, f.clock.MustNow(), blob.VisibilityPublic)
	require.NoError(t, err)
	require.NoError(t, f.idx.PutMany(t.Context(), []blocks.Block{change, ref}))
	require.NoError(t, f.idx.WaitIndexedHook(t.Context()))
	for _, key := range keys {
		got := itemSetForScope(t, f.db, scopeIDs[key])
		require.Equal(t, collectDownloadedBlobIDs(t, f.db, key), got)
		require.Contains(t, got, f.id(t, rootGrants[0]), "the independently selected Bob root contributes its WRITER grant")
		require.NotContains(t, got, f.id(t, rootGrants[1]), "Carol's capability remains authority-only; its root must not expand")
		for _, provenance := range f.private {
			require.NotContains(t, got, f.id(t, provenance))
		}
	}
}

// TestMaintainRBSRIndex_CapabilityDemotesScopes: a capability batch demotes
// every materialized scope instead of rebuilding it inside the hook's write
// transaction, which held the writer for seconds per batch. Demotion keeps
// last_access, so cold scopes stay cold, and the next serve rebuilds the scope.
func TestMaintainRBSRIndex_CapabilityDemotesScopes(t *testing.T) {
	t.Parallel()
	f := newAuthorityFixture(t, false)
	key := DiscoveryKey{IRI: f.child}
	scopeID := materializeFixtureScope(t, f.db, key)
	f.idx.SetIndexedHook(MaintainRBSRIndex)

	// Both unrelated and relevant grants demote the scope.
	for _, capability := range []blocks.Block{f.caps[3], f.caps[0]} {
		require.NoError(t, f.db.WithTx(t.Context(), func(conn *sqlite.Conn) error {
			return sqlitex.Exec(conn, `UPDATE rbsr_scope SET last_access = 1 WHERE id = ?`, nil, scopeID)
		}))
		require.NoError(t, f.idx.Put(t.Context(), capability))
		require.NoError(t, f.idx.WaitIndexedHook(t.Context()))
		require.False(t, scopeStillMaterialized(t, f.db, scopeID))
		lastAccess, err := sqlitex.QueryOnePool[int64](t.Context(), f.db, `SELECT last_access FROM rbsr_scope WHERE id = ?`, scopeID)
		require.NoError(t, err)
		require.EqualValues(t, 1, lastAccess, "demotion must preserve actual access recency")

		require.Equal(t, collectDownloadedBlobIDs(t, f.db, key), servedItemSet(t, f.db, key))
		require.True(t, scopeStillMaterialized(t, f.db, scopeID))
	}

	require.Contains(t, itemSetForScope(t, f.db, scopeID), f.id(t, f.caps[0]))
}

func TestCollectBlobs_AuthoritySelectedResources(t *testing.T) {
	t.Parallel()
	for _, edge := range []string{"link", "citation", "blob link"} {
		t.Run(edge, func(t *testing.T) {
			f := newAuthorityFixture(t, true)
			david := coretest.NewTester("david").Account
			landing := blob.IRI("hm://" + david.Principal().String() + "/landing")
			landingBlobs := f.putDocument(t, david, "/landing", blob.VisibilityPublic)
			landingChange, landingRef := f.id(t, landingBlobs[0]), f.id(t, landingBlobs[1])
			require.NoError(t, f.db.WithTx(t.Context(), func(conn *sqlite.Conn) error {
				switch edge {
				case "link":
					return sqlitex.Exec(conn, `INSERT INTO resource_links (source, type, target)
						SELECT ?, 'test/link', id FROM resources WHERE iri = ?`, nil, landingChange, string(f.child))
				case "citation":
					return sqlitex.Exec(conn, `INSERT INTO resource_links (source, type, target)
						SELECT child.genesis_blob, 'test/link', landing.id
						FROM resources child, resources landing WHERE child.iri = ? AND landing.iri = ?`, nil, string(f.child), string(landing))
				default:
					return sqlitex.Exec(conn, `INSERT INTO blob_links (source, type, target)
						SELECT ?, 'test/link', sb.id FROM structural_blobs sb
						JOIN resources r ON r.id = sb.resource WHERE r.iri = ? AND sb.type = 'Ref'`, nil, landingRef, string(f.child))
				}
			}))
			var got []int64

			require.NoError(t, f.db.WithSaveTempOnly(t.Context(), func(conn *sqlite.Conn) error {
				if err := collectBlobs(conn, map[DiscoveryKey]struct{}{{IRI: landing, BlobTypes: "Ref"}: {}}, edge != "blob link"); err != nil {
					return err
				}

				return sqlitex.Exec(conn, `SELECT id FROM rbsr_blobs`, func(stmt *sqlite.Stmt) error {
					got = append(got, stmt.ColumnInt64(0))
					return nil
				})
			}))
			for _, capability := range f.caps[:3] {
				require.Contains(t, got, f.id(t, capability), "selected resources supply authority even outside the requested scope")
			}

			require.NotContains(t, got, f.id(t, f.caps[3]))
			for _, provenance := range f.private {
				require.NotContains(t, got, f.id(t, provenance))
			}
		})
	}
}

func TestCollectBlobs_AuthorityTypedDescendants(t *testing.T) {
	t.Parallel()
	f := newAuthorityFixture(t, true)
	bob := coretest.NewTester("bob").Account
	var descendantCaps []blocks.Block

	for _, path := range []string{"/parent/child/deep", "/parent/child/deep/far"} {
		capability, err := blob.NewCapability(f.owner, bob.Principal(), f.owner.Principal(), path, blob.RoleWriter, "", f.clock.MustNow())
		require.NoError(t, err)
		descendantCaps = append(descendantCaps, capability)
	}

	require.NoError(t, f.idx.PutMany(t.Context(), descendantCaps))
	for _, tc := range []struct {
		name  string
		key   DiscoveryKey
		count int
	}{
		{"exact", DiscoveryKey{IRI: f.child, BlobTypes: "Ref"}, 0},
		{"depth one", DiscoveryKey{IRI: f.child, DepthOne: true, BlobTypes: dirStructureTypes}, 1},
		{"recursive", DiscoveryKey{IRI: f.child, Recursive: true, BlobTypes: "Ref"}, 2},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := collectDownloadedBlobIDs(t, f.db, tc.key)
			for i, capability := range descendantCaps {
				if i < tc.count {
					require.Contains(t, got, f.id(t, capability), "type-filtered resource seeds still supply authority")
				} else {
					require.NotContains(t, got, f.id(t, capability), "authority must not widen the requested depth")
				}
			}
		})
	}
}

func TestMaintainRBSRIndex_AuthorityDependencies(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		name  string
		order []int
	}{
		{"new resource", nil},
		{"late ancestor grant", []int{2, 1, 0, 3}},
		{"late AGENT chain", []int{0, 1, 2, 3}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := newAuthorityFixture(t, tc.order == nil)

			keys := []DiscoveryKey{
				{IRI: f.child},
				{IRI: f.child, Recursive: true},
				{IRI: f.child, DepthOne: true},
				{IRI: f.child, DepthOne: true, BlobTypes: dirStructureTypes},
			}
			if tc.order == nil {
				for i := range keys {
					keys[i].IRI += "/new"
				}
			}

			scopeIDs := make(map[DiscoveryKey]int64)
			for _, key := range keys {
				scopeIDs[key] = materializeFixtureScope(t, f.db, key)
			}

			f.idx.SetIndexedHook(MaintainRBSRIndex)

			if tc.order != nil {
				// Exercise both arrival orders: a grant connects an existing AGENT
				// chain, or late AGENT edges extend a grant. No cap is anchored here.
				for _, i := range tc.order {
					require.NoError(t, f.idx.Put(t.Context(), f.caps[i]))
					require.NoError(t, f.idx.WaitIndexedHook(t.Context()))
					for _, key := range keys {
						require.Equal(t, collectDownloadedBlobIDs(t, f.db, key), servedItemSet(t, f.db, key),
							"scope %+v must agree immediately after capability %d", key, i)
					}
				}
			} else {
				f.putDocument(t, f.owner, "/parent/child/new", blob.VisibilityPublic)
				require.NoError(t, f.idx.WaitIndexedHook(t.Context()))
			}

			for _, key := range keys {
				want := collectDownloadedBlobIDs(t, f.db, key)
				got := servedItemSet(t, f.db, key)
				require.Equal(t, want, got, "maintained membership must match legacy for %+v", key)
				require.True(t, scopeStillMaterialized(t, f.db, scopeIDs[key]))
				for _, cap := range f.caps[:3] {
					require.Contains(t, got, f.id(t, cap))
				}

				legacy := newAuthorizedStore()
				require.NoError(t, f.db.WithSaveTempOnly(t.Context(), func(conn *sqlite.Conn) error {
					return loadRBSRStore(conn, map[DiscoveryKey]struct{}{key: {}}, legacy)
				}))
				require.NoError(t, legacy.Seal())
				maintained := newAuthorizedTreeStore()
				_, err := loadIndexedScopes(t.Context(), f.db, colx.HashSet[DiscoveryKey]{key: {}}, maintained)
				require.NoError(t, err)
				require.NoError(t, maintained.Seal())
				require.Equal(t, fingerprintOf(t, legacy.WithFilter(nil)), fingerprintOf(t, maintained.WithFilter(nil)))
			}
		})
	}
}

func TestCommentOnlyDiscoveryIncludesDelegationProof(t *testing.T) {
	t.Parallel()

	db := storage.MakeTestDB(t)
	idx, err := blob.OpenIndex(t.Context(), db, zap.NewNop())
	require.NoError(t, err)
	clock := cclock.New()
	alice := coretest.NewTester("alice").Account
	bob := coretest.NewTester("bob")

	change, err := blob.NewChange(alice, cid.Undef, nil, 0, blob.ChangeBody{}, clock.MustNow())
	require.NoError(t, err)
	ref, err := blob.NewRef(alice, 0, change.CID, alice.Principal(), "/doc", []cid.Cid{change.CID}, clock.MustNow(), blob.VisibilityPublic)
	require.NoError(t, err)
	agent, err := blob.NewCapability(bob.Account, bob.Device.Principal(), bob.Account.Principal(), "", blob.RoleAgent, "", clock.MustNow())
	require.NoError(t, err)
	// Bob's session key comments on Alice's document on behalf of Bob.
	comment, err := blob.NewComment(bob.Device, "", bob.Account.Principal(), alice.Principal(), "/doc", []cid.Cid{change.CID}, cid.Undef, cid.Undef,
		[]blob.CommentBlock{{Block: blob.Block{Type: "paragraph", Text: "hi"}}}, blob.VisibilityPublic, clock.MustNow())
	require.NoError(t, err)
	require.NoError(t, idx.PutMany(t.Context(), []blocks.Block{change, ref, agent, comment}))

	var agentID, commentID int64
	var got []int64

	require.NoError(t, db.WithTx(t.Context(), func(conn *sqlite.Conn) error {
		lookup := func(c cid.Cid) (id int64, err error) {
			return sqlitex.QueryOne[int64](conn, `SELECT id FROM blobs WHERE multihash = ?`, []byte(c.Hash()))
		}
		if agentID, err = lookup(agent.CID); err != nil {
			return err
		}

		if commentID, err = lookup(comment.CID); err != nil {
			return err
		}

		dkey := DiscoveryKey{IRI: blob.IRI("hm://" + alice.Principal().String() + "/doc"), BlobTypes: BlobTypesString([]string{"Comment"})}
		if err := collectBlobs(conn, map[DiscoveryKey]struct{}{dkey: {}}, false); err != nil {
			return err
		}

		return sqlitex.Exec(conn, `SELECT id FROM rbsr_blobs`, func(stmt *sqlite.Stmt) error {
			got = append(got, stmt.ColumnInt64(0))
			return nil
		})
	}))

	require.Contains(t, got, commentID)
	require.Contains(t, got, agentID, "a receiver can't index the delegated comment without its AGENT capability")
}
