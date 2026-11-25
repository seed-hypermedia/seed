package blob

import (
	"fmt"
	"seed/backend/blob/keylinesqlite"
	"seed/backend/core"
	"seed/backend/core/coretest"
	"seed/backend/keyline"
	"seed/backend/storage"
	"seed/backend/util/cclock"
	"seed/backend/util/must"
	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"
	"testing"
	"time"

	blocks "github.com/ipfs/go-block-format"
	"github.com/ipfs/go-cid"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
)

// TestAuthorityDeleteCited checks that a capability Keyline cites can't be
// deleted out from under the authority it grants.
func TestAuthorityDeleteCited(t *testing.T) {
	ctx := t.Context()
	alice := coretest.NewTester("alice").Account
	bob := coretest.NewTester("bob").Account
	db := storage.MakeTestDB(t)
	idx, err := OpenIndex(ctx, db, zap.NewNop())
	require.NoError(t, err)
	grant, err := NewCapability(alice, bob.Principal(), alice.Principal(), "/team", RoleWriter, "", time.UnixMilli(10))
	require.NoError(t, err)
	require.NoError(t, idx.Put(ctx, grant))
	require.Error(t, idx.DeleteBlock(ctx, grant.CID))
	has, err := idx.Has(ctx, grant.CID)
	require.NoError(t, err)
	require.True(t, has)
	allowed, err := idx.IsValidWriter(ctx, alice.Principal(), "/team/child", bob.Principal())
	require.NoError(t, err)
	require.True(t, allowed)
}

func TestAuthorityPowerThresholds(t *testing.T) {
	for _, tc := range []struct {
		power keyline.Power
		write bool
		agent bool
	}{
		{keyline.Sync, false, false},
		{keyline.Read, false, false},
		{keyline.Write, true, true},
		{keyline.Admin, true, true},
	} {
		t.Run(tc.power.String(), func(t *testing.T) {
			ctx := t.Context()
			alice := coretest.NewTester("alice").Account
			bob := coretest.NewTester("bob").Account
			db := storage.MakeTestDB(t)
			idx, err := OpenIndex(ctx, db, zap.NewNop())
			require.NoError(t, err)
			clock := cclock.New()
			aliceProfile, err := NewProfile(alice, "Alice", "", "", alice.Principal(), clock.MustNow())
			require.NoError(t, err)
			bobProfile, err := NewProfile(bob, "Bob", "", "", bob.Principal(), clock.MustNow())
			require.NoError(t, err)
			require.NoError(t, idx.PutMany(ctx, []blocks.Block{aliceProfile, bobProfile}))
			// Seed currently issues only Write/Admin grants. Supply trusted graph
			// facts directly to exercise the lower ranks through SQL authorization.
			require.NoError(t, db.WithTx(ctx, func(conn *sqlite.Conn) error {
				_, err := (keylinesqlite.Tx{Conn: conn}).Apply(ctx, keyline.Batch{Delegations: []keyline.Delegation{{
					ID: "grant", Issuer: keyNode(alice.Principal()),
					Audience: keyNode(bob.Principal()), Subject: keyNode(alice.Principal()),
					Power: tc.power, BlobID: 1,
				}}})
				return err
			}))
			for _, path := range []string{"", "/new/child"} {
				allowed, err := idx.IsValidWriter(ctx, alice.Principal(), path, bob.Principal())
				require.NoError(t, err)
				require.Equal(t, tc.write, allowed, "write authority at %q", path)
			}

			agent, err := idx.IsValidAgent(ctx, alice.Principal(), bob.Principal())
			require.NoError(t, err)
			require.Equal(t, tc.agent, agent)
		})
	}
}

func TestAuthorityAgentComposition(t *testing.T) {
	alice := coretest.NewTester("alice").Account
	bob := coretest.NewTester("bob").Account
	carol := coretest.NewTester("carol").Account
	dave := coretest.NewTester("david").Account
	eve := coretest.NewTester("alice").Device
	clock := cclock.New()
	writer, err := NewCapability(alice, bob.Principal(), alice.Principal(), "/team", RoleWriter, "", clock.MustNow())
	require.NoError(t, err)
	agent, err := NewCapability(bob, carol.Principal(), bob.Principal(), "", RoleAgent, "", clock.MustNow())
	require.NoError(t, err)
	session, err := NewCapability(carol, dave.Principal(), carol.Principal(), "", RoleAgent, "", clock.MustNow())
	require.NoError(t, err)
	// Writing Carol's documents is not delegation of Carol's identity.
	unrelated, err := NewCapability(carol, eve.Principal(), carol.Principal(), "", RoleWriter, "", clock.MustNow())
	require.NoError(t, err)
	change, err := NewChange(dave, cid.Undef, nil, 0, ChangeBody{}, clock.MustNow())
	require.NoError(t, err)
	ref, err := NewRef(dave, 0, change.CID, alice.Principal(), "/team/doc", []cid.Cid{change.CID}, clock.MustNow(), VisibilityPublic)
	require.NoError(t, err)

	for _, order := range [][]blocks.Block{
		{writer, agent, session}, {writer, session, agent},
		{agent, writer, session}, {agent, session, writer},
		{session, writer, agent}, {session, agent, writer},
	} {
		t.Run(order[0].Cid().String()+"/"+order[1].Cid().String(), func(t *testing.T) {
			db := storage.MakeTestDB(t)
			idx, err := OpenIndex(t.Context(), db, zap.NewNop())
			require.NoError(t, err)
			require.NoError(t, idx.PutMany(t.Context(), []blocks.Block{change, ref, unrelated}))
			require.Equal(t, 1, countStashedBlobs(t, db))
			for _, cap := range order {
				require.NoError(t, idx.Put(t.Context(), cap))
			}

			allowed, err := idx.IsValidWriter(t.Context(), alice.Principal(), "/team/doc", dave.Principal())
			require.NoError(t, err)
			require.True(t, allowed, "AGENT chains compose through the scoped WRITER grant")
			require.Equal(t, 0, countStashedBlobs(t, db), "a late upstream grant retries descendant signers")
			for _, path := range []string{"", "/teamish/doc", "/other"} {
				allowed, err := idx.IsValidWriter(t.Context(), alice.Principal(), path, dave.Principal())
				require.NoError(t, err)
				require.False(t, allowed, "scope boundary %q", path)
			}

			allowed, err = idx.IsValidWriter(t.Context(), alice.Principal(), "/team/new", dave.Principal())
			require.NoError(t, err)
			require.True(t, allowed, "authority applies before a descendant document exists")
			allowed, err = idx.IsValidWriter(t.Context(), alice.Principal(), "/team/doc", eve.Principal())
			require.NoError(t, err)
			require.False(t, allowed, "WRITER never stands in for the recipient's identity")
			allowed, err = idx.IsValidAgent(t.Context(), bob.Principal(), dave.Principal())
			require.NoError(t, err)
			require.True(t, allowed)
			allowed, err = idx.IsValidAgent(t.Context(), alice.Principal(), bob.Principal())
			require.NoError(t, err)
			require.False(t, allowed)

			require.NoError(t, (keylinesqlite.Store{Pool: db}).View(t.Context(), func(tx keyline.ReadTx) error {
				team := resourceNode(must.Do2(NewIRI(alice.Principal(), "/team")))
				power, err := keyline.EffectivePower(t.Context(), tx, team, keyNode(alice.Principal()))
				require.NoError(t, err)
				require.Equal(t, keyline.Admin, power, "root edges give the owner Admin over a granted scope")
				power, err = keyline.EffectivePower(t.Context(), tx, team, keyNode(dave.Principal()))
				require.NoError(t, err)
				require.Equal(t, keyline.Write, power)
				return nil
			}))

			incremental := authorityTables(t, db)
			require.NoError(t, idx.Reindex(t.Context()))
			require.Equal(t, incremental, authorityTables(t, db), "a full reindex rebuilds the same projection")
		})
	}
}

// TestAuthorityReindex covers rebuilding Keyline as ordinary derived data: a
// full reindex repopulates an empty projection and retries blobs it denied.
func TestAuthorityReindex(t *testing.T) {
	ctx := t.Context()
	alice := coretest.NewTester("alice").Account
	bob := coretest.NewTester("bob").Account
	carol := coretest.NewTester("carol").Account
	db := storage.MakeTestDB(t)
	idx, err := OpenIndex(ctx, db, zap.NewNop())
	require.NoError(t, err)
	clock := cclock.New()
	change, err := NewChange(alice, cid.Undef, nil, 0, ChangeBody{}, clock.MustNow())
	require.NoError(t, err)
	private, err := NewRef(alice, 0, change.CID, alice.Principal(), "/private", []cid.Cid{change.CID}, clock.MustNow(), VisibilityPrivate)
	require.NoError(t, err)
	// The first provenance for Alice's root is deliberately private. Exporting
	// a public child's authority must not disclose that incidental source.
	require.NoError(t, idx.PutMany(ctx, []blocks.Block{change, private}))
	writer, err := NewCapability(alice, bob.Principal(), alice.Principal(), "/literal%2Fsegment", RoleWriter, "", clock.MustNow())
	require.NoError(t, err)
	agent, err := NewCapability(bob, carol.Principal(), bob.Principal(), "", RoleAgent, "", clock.MustNow())
	require.NoError(t, err)
	unrelated, err := NewCapability(alice, carol.Principal(), alice.Principal(), "/unrelated", RoleWriter, "", clock.MustNow())
	require.NoError(t, err)
	literal, err := NewCapability(alice, bob.Principal(), alice.Principal(), "/100%complete", RoleWriter, "", clock.MustNow())
	require.NoError(t, err)
	require.NoError(t, idx.PutMany(ctx, []blocks.Block{writer, agent, unrelated, literal}))

	check := func() {
		t.Helper()
		allowed, err := idx.IsValidWriter(ctx, alice.Principal(), "/literal%2Fsegment/child", carol.Principal())
		require.NoError(t, err)
		require.True(t, allowed)
		allowed, err = idx.IsValidWriter(ctx, alice.Principal(), "/literal/segment/child", carol.Principal())
		require.NoError(t, err)
		require.False(t, allowed, "literal escapes must not become new scope separators")
		conn, release, err := db.ReadConn(ctx)
		require.NoError(t, err)
		ids, err := AuthorityBlobIDs(ctx, conn, must.Do2(NewIRI(alice.Principal(), "/literal%2Fsegment/child")))
		release()
		require.NoError(t, err)
		require.ElementsMatch(t, []int64{blobIDForCID(t, db, writer.CID), blobIDForCID(t, db, agent.CID)}, ids)
		conn, release, err = db.ReadConn(ctx)
		require.NoError(t, err)
		ids, err = AuthorityBlobIDs(ctx, conn, must.Do2(NewIRI(alice.Principal(), "/100%complete")))
		release()
		require.NoError(t, err, "legacy paths are not required to be URL-escaped")
		require.ElementsMatch(t, []int64{blobIDForCID(t, db, literal.CID), blobIDForCID(t, db, agent.CID)}, ids)
		for _, original := range []blocks.Block{change, private, writer, agent, unrelated, literal} {
			stored, err := idx.Get(ctx, original.Cid())
			require.NoError(t, err)
			require.Equal(t, original.RawData(), stored.RawData(), "signed bytes are never rewritten")
		}
	}
	check()

	require.NoError(t, db.WithTx(ctx, func(conn *sqlite.Conn) error {
		// Lose the projection, so the next blobs are denied permission.
		return sqlitex.ExecScript(conn, `
			DELETE FROM keyline_edges;
			DELETE FROM keyline_revocations;
			DELETE FROM keyline_delegations;
			DELETE FROM keyline_nodes;
		`)
	}))
	pendingChange, err := NewChange(carol, cid.Undef, nil, 0, ChangeBody{}, clock.MustNow())
	require.NoError(t, err)
	pendingRef, err := NewRef(carol, 0, pendingChange.CID, alice.Principal(), "/literal%2Fsegment/child", []cid.Cid{pendingChange.CID}, clock.MustNow(), VisibilityPublic)
	require.NoError(t, err)
	require.NoError(t, idx.PutMany(ctx, []blocks.Block{pendingChange, pendingRef}))
	require.Equal(t, 1, countStashedBlobs(t, db))
	require.NoError(t, idx.Reindex(ctx))
	require.Equal(t, 0, countStashedBlobs(t, db), "reindex recovers blobs the lost projection denied")
	changes, checkChanges := idx.iterChangesLatest(ctx, must.Do2(NewIRI(alice.Principal(), "/literal%2Fsegment/child")))
	var heads []cid.Cid

	for change := range changes {
		heads = append(heads, change.CID)
	}

	require.NoError(t, checkChanges())
	require.Equal(t, []cid.Cid{pendingChange.CID}, heads)
	check()
}

func TestAuthorityBatchRollback(t *testing.T) {
	ctx := t.Context()
	alice := coretest.NewTester("alice").Account
	bob := coretest.NewTester("bob").Account
	carol := coretest.NewTester("carol").Account
	db := storage.MakeTestDB(t)
	idx, err := OpenIndex(ctx, db, zap.NewNop())
	require.NoError(t, err)
	writer, err := NewCapability(alice, bob.Principal(), alice.Principal(), "", RoleWriter, "", cclock.New().MustNow())
	require.NoError(t, err)
	forged := *writer.Decoded
	forged.Delegate = carol.Principal()
	bad, err := encodeBlob(&forged)
	require.NoError(t, err)
	require.Error(t, idx.PutMany(ctx, []blocks.Block{writer, bad}))
	allowed, err := idx.IsValidWriter(ctx, alice.Principal(), "", bob.Principal())
	require.NoError(t, err)
	require.False(t, allowed, "failed signed-blob batch rolls back graph and SQL answers together")
	found, err := idx.Has(ctx, writer.CID)
	require.NoError(t, err)
	require.False(t, found)
	require.NoError(t, (keylinesqlite.Store{Pool: db}).View(ctx, func(tx keyline.ReadTx) error {
		_, found, err := tx.Delegation(ctx, keyline.ID(writer.CID.String()))
		require.NoError(t, err)
		require.False(t, found)
		return nil
	}))
	require.NoError(t, idx.Put(ctx, writer))
	allowed, err = idx.IsValidWriter(ctx, alice.Principal(), "", bob.Principal())
	require.NoError(t, err)
	require.True(t, allowed)
}

// authorityTables dumps the stored delegations and edges by node name,
// independent of local node and blob IDs.
func authorityTables(t *testing.T, db *sqlitex.Pool) []string {
	t.Helper()
	conn, release, err := db.ReadConn(t.Context())
	require.NoError(t, err)
	defer release()
	var rows []string

	require.NoError(t, sqlitex.Exec(conn, `
		SELECT 'delegation ' || d.id || ' ' || i.name || ' ' || a.name || ' ' || s.name || ' ' || d.power
		FROM keyline_delegations d
		JOIN keyline_nodes i ON i.id = d.issuer
		JOIN keyline_nodes a ON a.id = d.audience
		JOIN keyline_nodes s ON s.id = d.subject
		UNION ALL
		SELECT 'edge ' || s.name || ' ' || a.name || ' ' || e.power
		FROM keyline_edges e
		JOIN keyline_nodes s ON s.id = e.subject
		JOIN keyline_nodes a ON a.id = e.audience
		ORDER BY 1`, func(row *sqlite.Stmt) error {
		rows = append(rows, row.ColumnText(0))
		return nil
	}))
	return rows
}

func TestAuthorityNodeNames(t *testing.T) {
	alice := coretest.NewTester("alice").Account.Principal()
	a := alice.String()
	key, space := keyline.Node("key:"+a), keyline.Node("space:"+a)
	team := keyline.Node("resource:" + a + "/team")
	for _, tc := range []struct {
		path   string
		node   keyline.Node
		scopes []keyline.Node
	}{
		{"", space, []keyline.Node{key, space}},
		{"/team", team, []keyline.Node{key, space, team}},
		{"/team/notes", keyline.Node("resource:" + a + "/team/notes"), []keyline.Node{key, space, team, keyline.Node("resource:" + a + "/team/notes")}},
		{"/100%complete", keyline.Node("resource:" + a + "/100%complete"), []keyline.Node{key, space, keyline.Node("resource:" + a + "/100%complete")}},
	} {
		iri := must.Do2(NewIRI(alice, tc.path))
		require.Equal(t, tc.node, resourceNode(iri), tc.path)
		require.Equal(t, tc.scopes, authorityScopes(iri), tc.path)
		node, err := sqlitex.QueryOnePool[string](t.Context(), storage.MakeTestDB(t), "SELECT "+sqlAuthorityNode("?1"), string(iri))
		require.NoError(t, err)
		require.Equal(t, string(tc.node), node, "SQL naming matches Go for %q", tc.path)
	}
}

// TestAuthorityEdgesStayLinear guards against the quadratic membership cache:
// stored edges grow with capabilities, not with documents times the members
// of the keys they name.
func TestAuthorityEdgesStayLinear(t *testing.T) {
	ctx := t.Context()
	alice := coretest.NewTester("alice").Account
	bob := coretest.NewTester("bob").Account
	clock := cclock.New()
	const docs, agents = 12, 8

	var (
		caps []blocks.Block
		keys []*core.KeyPair
	)

	for range agents {
		key, err := core.GenerateKeyPair(core.Ed25519, nil)
		require.NoError(t, err)
		keys = append(keys, key)
		agent, err := NewCapability(bob, key.Principal(), bob.Principal(), "", RoleAgent, "", clock.MustNow())
		require.NoError(t, err)
		caps = append(caps, agent)
	}

	for i := range docs {
		writer, err := NewCapability(alice, bob.Principal(), alice.Principal(), fmt.Sprintf("/doc%d", i), RoleWriter, "", clock.MustNow())
		require.NoError(t, err)
		caps = append(caps, writer)
	}

	db := storage.MakeTestDB(t)
	idx, err := OpenIndex(ctx, db, zap.NewNop())
	require.NoError(t, err)
	require.NoError(t, idx.PutMany(ctx, caps))

	edges, err := sqlitex.QueryOnePool[int](ctx, db, "SELECT count(*) FROM keyline_edges")
	require.NoError(t, err)
	// Each document has edges to Bob and to Alice's space; Alice's space has
	// one to her key, and Bob's key one to each agent.
	require.Equal(t, 2*docs+1+agents, edges)

	// Root edges are implied and named after their scope, so Alice's space
	// has one edge to her key however many documents she shares.
	for query, want := range map[string]int{
		"SELECT count(*) FROM keyline_delegations WHERE blob_id IS NOT NULL": docs + agents,
		"SELECT count(*) FROM keyline_delegations WHERE blob_id IS NULL":     docs + 1,
	} {
		got, err := sqlitex.QueryOnePool[int](ctx, db, query)
		require.NoError(t, err)
		require.Equal(t, want, got, query)
	}

	for _, key := range keys {
		for i := range docs {
			allowed, err := idx.IsValidWriter(ctx, alice.Principal(), fmt.Sprintf("/doc%d/child", i), key.Principal())
			require.NoError(t, err)
			require.True(t, allowed, "agents of a writer write its documents")
		}

		allowed, err := idx.IsValidWriter(ctx, alice.Principal(), "", key.Principal())
		require.NoError(t, err)
		require.False(t, allowed, "a document grant is not a space grant")
	}
}

// TestAuthorityAgents covers the web sign-in shape: an account and its session
// keys hold AGENT capabilities in both directions.
func TestAuthorityAgents(t *testing.T) {
	ctx := t.Context()
	alice := coretest.NewTester("alice").Account
	laptop := coretest.NewTester("alice").Device
	phone := coretest.NewTester("bob").Device
	tablet := coretest.NewTester("carol").Device
	clock := cclock.New()
	capability := func(issuer *core.KeyPair, delegate *core.KeyPair) blocks.Block {
		c, err := NewCapability(issuer, delegate.Principal(), issuer.Principal(), "", RoleAgent, "", clock.MustNow())
		require.NoError(t, err)
		return c
	}

	// The laptop signs Alice's profile before any capability arrives.
	profile, err := NewProfile(laptop, "Alice", "", "", alice.Principal(), clock.MustNow())
	require.NoError(t, err)
	change, err := NewChange(alice, cid.Undef, nil, 0, ChangeBody{}, clock.MustNow())
	require.NoError(t, err)
	ref, err := NewRef(alice, 0, change.CID, alice.Principal(), "/notes", []cid.Cid{change.CID}, clock.MustNow(), VisibilityPublic)
	require.NoError(t, err)

	db := storage.MakeTestDB(t)
	idx, err := OpenIndex(ctx, db, zap.NewNop())
	require.NoError(t, err)
	require.NoError(t, idx.PutMany(ctx, []blocks.Block{profile, change, ref}))
	require.Equal(t, 1, countStashedBlobs(t, db), "a delegated profile waits for its agent capability")
	require.Empty(t, authorityTables(t, db), "Refs, Changes and Profiles write nothing to Keyline")

	require.NoError(t, idx.PutMany(ctx, []blocks.Block{
		capability(alice, laptop), capability(laptop, alice),
		capability(alice, phone), capability(phone, alice),
		capability(phone, tablet),
	}))
	require.Zero(t, countStashedBlobs(t, db), "the agent capability unstashes the delegated profile")

	for _, agent := range []*core.KeyPair{laptop, phone, tablet} {
		allowed, err := idx.IsValidWriter(ctx, alice.Principal(), "/notes", agent.Principal())
		require.NoError(t, err)
		require.True(t, allowed, "agents and agents of agents write where the account can")
		allowed, err = idx.IsValidAgent(ctx, alice.Principal(), agent.Principal())
		require.NoError(t, err)
		require.True(t, allowed)
	}

	allowed, err := idx.IsValidWriter(ctx, laptop.Principal(), "", alice.Principal())
	require.NoError(t, err)
	require.True(t, allowed, "a reverse capability lets the account act for its session key")

	require.NoError(t, (keylinesqlite.Store{Pool: db}).View(ctx, func(tx keyline.ReadTx) error {
		for _, pair := range [][2]*core.KeyPair{{alice, laptop}, {laptop, alice}, {laptop, phone}, {alice, tablet}} {
			power, err := keyline.EffectivePower(ctx, tx, keyNode(pair[0].Principal()), keyNode(pair[1].Principal()))
			require.NoError(t, err)
			require.Equal(t, keyline.Write, power, "AGENT never grants Admin over another key")
		}

		return nil
	}))

	incremental := authorityTables(t, db)
	require.NoError(t, idx.Reindex(ctx))
	require.Equal(t, incremental, authorityTables(t, db), "a full reindex rebuilds the same projection")
}
