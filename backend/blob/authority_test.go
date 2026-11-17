package blob

import (
	"seed/backend/core"
	"seed/backend/core/coretest"
	"seed/backend/keyline"
	"seed/backend/keyline/keylinesqlite"
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

func TestAuthorityDeleteAndReinsert(t *testing.T) {
	ctx := t.Context()
	alice := coretest.NewTester("alice").Account
	bob := coretest.NewTester("bob").Account
	db := storage.MakeTestDB(t)
	idx, err := OpenIndex(ctx, db, zap.NewNop())
	require.NoError(t, err)
	grant, err := NewCapability(alice, bob.Principal(), alice.Principal(), "/team", RoleWriter, "", time.UnixMilli(10))
	require.NoError(t, err)
	require.NoError(t, idx.Put(ctx, grant))
	originalID := blobIDForCID(t, db, grant.CID)
	require.NoError(t, idx.DeleteBlock(ctx, grant.CID))
	has, err := idx.Has(ctx, grant.CID)
	require.NoError(t, err)
	require.False(t, has)
	allowed, err := idx.IsValidWriter(ctx, alice.Principal(), "/team/child", bob.Principal())
	require.NoError(t, err)
	require.False(t, allowed, "deleted capabilities must not leave cached authority")
	require.NoError(t, (keylinesqlite.Store{Pool: db}).View(ctx, func(tx keyline.ReadTx) error {
		_, found, err := tx.Delegation(ctx, keyline.ID(grant.CID.String()))
		require.NoError(t, err)
		require.False(t, found)
		return nil
	}))
	require.NoError(t, idx.DeleteBlock(ctx, grant.CID), "repeated deletion is a no-op")
	require.NoError(t, idx.Put(ctx, grant), "identical signed bytes can acquire a new local blob ID")
	require.NotEqual(t, originalID, blobIDForCID(t, db, grant.CID))
	allowed, err = idx.IsValidWriter(ctx, alice.Principal(), "/team/child", bob.Principal())
	require.NoError(t, err)
	require.True(t, allowed)
	stored, err := idx.Get(ctx, grant.CID)
	require.NoError(t, err)
	require.Equal(t, grant.RawData(), stored.RawData())
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
				if err != nil {
					return err
				}

				batch := newIndexBatch()
				batch.authoritySubjects[keyNode(alice.Principal())] = true
				return batch.flush(indexOpts{}, conn, idx.bs, idx.log, nil)
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

			incremental := authorityTables(t, db)
			require.NoError(t, idx.Reindex(t.Context()))
			require.Equal(t, incremental, authorityTables(t, db), "a full reindex rebuilds the same projection")
		})
	}
}

func TestAuthorityProjectionBackfill(t *testing.T) {
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

	var before string

	require.NoError(t, db.WithTx(ctx, func(conn *sqlite.Conn) error {
		before = must.Do2(dbGetReindexTime(conn))
		// Simulate an upgraded database: the validated legacy index and blobs
		// exist, but the new disposable projection is empty.
		return sqlitex.ExecScript(conn, `
			DELETE FROM keyline_members;
			DELETE FROM keyline_revocations;
			DELETE FROM keyline_delegations;
			DELETE FROM keyline_nodes;
			DELETE FROM kv WHERE key = 'keyline_projection_version';
		`)
	}))
	// Simulate a document the previous authority implementation could not
	// ground. Backfill must retry pending records as well as populate answers.
	pendingChange, err := NewChange(carol, cid.Undef, nil, 0, ChangeBody{}, clock.MustNow())
	require.NoError(t, err)
	pendingRef, err := NewRef(carol, 0, pendingChange.CID, alice.Principal(), "/literal%2Fsegment/child", []cid.Cid{pendingChange.CID}, clock.MustNow(), VisibilityPublic)
	require.NoError(t, err)
	require.NoError(t, idx.PutMany(ctx, []blocks.Block{pendingChange, pendingRef}))
	require.Equal(t, 1, countStashedBlobs(t, db))
	require.NoError(t, idx.MaybeReindex(ctx))
	require.Equal(t, 0, countStashedBlobs(t, db), "backfill recovers formerly ungrounded documents")
	changes, checkChanges := idx.iterChangesLatest(ctx, must.Do2(NewIRI(alice.Principal(), "/literal%2Fsegment/child")))
	var heads []cid.Cid

	for change := range changes {
		heads = append(heads, change.CID)
	}

	require.NoError(t, checkChanges())
	require.Equal(t, []cid.Cid{pendingChange.CID}, heads)
	check()
	conn, release, err := db.ReadConn(ctx)
	require.NoError(t, err)
	after, err := dbGetReindexTime(conn)
	release()
	require.NoError(t, err)
	require.Equal(t, before, after, "authority backfill must not schedule full reindex/embedding work")
	require.NoError(t, idx.Reindex(ctx))
	check()
	require.NoError(t, idx.MaybeReindex(ctx))
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

// authorityTables dumps the stored delegations and the members cache by node
// name, independent of local node and blob IDs.
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
		SELECT 'member ' || s.name || ' ' || m.name || ' ' || km.power
		FROM keyline_members km
		JOIN keyline_nodes s ON s.id = km.subject
		JOIN keyline_nodes m ON m.id = km.member
		ORDER BY 1`, func(row *sqlite.Stmt) error {
		rows = append(rows, row.ColumnText(0))
		return nil
	}))
	return rows
}

func TestAuthorityNodeNames(t *testing.T) {
	alice := coretest.NewTester("alice").Account.Principal()
	a := alice.String()
	for _, tc := range []struct {
		path   string
		node   keyline.Node
		parent keyline.Node
	}{
		{"", keyline.Node("space:" + a), keyline.Node("key:" + a)},
		{"/team", keyline.Node("resource:" + a + "/team"), keyline.Node("space:" + a)},
		{"/team/notes", keyline.Node("resource:" + a + "/team/notes"), keyline.Node("resource:" + a + "/team")},
		{"/100%complete", keyline.Node("resource:" + a + "/100%complete"), keyline.Node("space:" + a)},
	} {
		iri := must.Do2(NewIRI(alice, tc.path))
		require.Equal(t, tc.node, resourceNode(iri), tc.path)
		parent, ok := authorityParent(tc.node)
		require.True(t, ok)
		require.Equal(t, tc.parent, parent, tc.path)
		node, err := sqlitex.QueryOnePool[string](t.Context(), storage.MakeTestDB(t), "SELECT "+sqlAuthorityNode("?1"), string(iri))
		require.NoError(t, err)
		require.Equal(t, string(tc.node), node, "SQL naming matches Go for %q", tc.path)
	}

	_, ok := authorityParent(keyNode(alice))
	require.False(t, ok, "keys have no parent")
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
			power, err := authority.EffectivePower(ctx, tx, keyNode(pair[0].Principal()), keyNode(pair[1].Principal()))
			require.NoError(t, err)
			require.Equal(t, keyline.Write, power, "AGENT never grants Admin over another key")
		}

		power, err := authority.EffectivePower(ctx, tx, resourceNode(must.Do2(NewIRI(alice.Principal(), "/notes"))), keyNode(alice.Principal()))
		require.NoError(t, err)
		require.Equal(t, keyline.Admin, power, "the owner administers every document in its space")
		return nil
	}))

	incremental := authorityTables(t, db)
	require.NoError(t, idx.Reindex(ctx))
	require.Equal(t, incremental, authorityTables(t, db), "a full reindex rebuilds the same projection")
}
