package blob

import (
	"testing"

	"seed/backend/core/coretest"
	"seed/backend/storage"
	"seed/backend/util/cclock"
	"seed/backend/util/must"
	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"

	blocks "github.com/ipfs/go-block-format"
	"github.com/ipfs/go-cid"
	"github.com/multiformats/go-multicodec"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
)

// Reindex truncates derived tables with foreign keys off and recreates the
// virtual ones, so it must leave them working and enforcement back on.
func TestReindexRebuildsDerivedTables(t *testing.T) {
	t.Parallel()

	alice := coretest.NewTester("alice")
	clock := cclock.New()
	change := must.Do2(NewChange(alice.Account, cid.Undef, nil, 0, ChangeBody{Ops: []OpMap{
		NewOpMoveBlocks("", []string{"b1"}, nil),
		NewOpReplaceBlock(Block{ID_Good: "b1", Type: "paragraph", Text: "quokka"}),
	}}, clock.MustNow()))
	ref := must.Do2(NewRef(alice.Account, 0, change.CID, alice.Account.Principal(), "/doc", []cid.Cid{change.CID}, clock.MustNow(), VisibilityPublic))

	db := storage.MakeTestDB(t)
	idx := must.Do2(OpenIndex(t.Context(), db, zap.NewNop()))
	require.NoError(t, idx.PutMany(t.Context(), []blocks.Block{change, ref}))

	matches := func() int {
		n, err := sqlitex.QueryOnePool[int](t.Context(), db, "SELECT count(*) FROM fts WHERE fts MATCH 'quokka'")
		require.NoError(t, err)
		return n
	}
	require.Positive(t, matches(), "the block text is searchable before the reindex")

	require.NoError(t, idx.Reindex(t.Context()))

	require.Positive(t, matches(), "the recreated full-text table is rebuilt")
	generations, err := sqlitex.QueryOnePool[int](t.Context(), db, "SELECT count(*) FROM document_generations")
	require.NoError(t, err)
	require.Equal(t, 1, generations)

	conn, release, err := db.WriteConn(t.Context())
	require.NoError(t, err)
	defer release()
	foreignKeys, err := sqlitex.QueryOne[int](conn, "PRAGMA foreign_keys")
	require.NoError(t, err)
	require.Equal(t, 1, foreignKeys, "the write connection enforces foreign keys again")
	reindexTime, err := dbGetReindexTime(conn)
	require.NoError(t, err)
	require.NotEmpty(t, reindexTime)

	// Truncation commits on its own, so it must leave a reindex pending in
	// case the rebuild never finishes.
	require.NoError(t, truncateDerivedTables(conn))
	reindexTime, err = dbGetReindexTime(conn)
	require.NoError(t, err)
	require.Empty(t, reindexTime)
	resources, err := sqlitex.QueryOne[int](conn, "SELECT count(*) FROM resources")
	require.NoError(t, err)
	require.Zero(t, resources)
}

// A rebuild that fails after truncation has committed leaves the index empty,
// so it must not be reported as Completed, which would lift the gates on
// syncing and blob storage, and it must leave a reindex pending.
func TestReindexFailureIsNotCompleted(t *testing.T) {
	t.Parallel()

	db := storage.MakeTestDB(t)
	idx := must.Do2(OpenIndex(t.Context(), db, zap.NewNop()))

	// Data that isn't zstd fails decompression, which aborts the rebuild.
	require.NoError(t, db.WithTx(t.Context(), func(conn *sqlite.Conn) error {
		return sqlitex.Exec(conn, "INSERT INTO blobs (multihash, codec, size, data) VALUES (?, ?, 4, x'00010203')", nil,
			[]byte("not-a-real-multihash"), uint64(multicodec.DagCbor))
	}))

	require.Error(t, idx.Reindex(t.Context()))
	require.Equal(t, ReindexStateInProgress, idx.ReindexInfo().State)

	reindexTime, err := sqlitex.QueryOnePool[string](t.Context(), db, "SELECT value FROM kv WHERE key = 'last_reindex_time'")
	require.NoError(t, err)
	require.Empty(t, reindexTime)
}
