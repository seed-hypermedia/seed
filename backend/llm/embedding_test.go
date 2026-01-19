package llm

import (
	"context"
	"sync"
	"testing"
	"time"

	"seed/backend/daemon/taskmanager"
	daemonpb "seed/backend/genproto/daemon/v1alpha"
	"seed/backend/storage"
	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"

	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
)

type fakeEmbeddingBackend struct {
	mu sync.Mutex

	loadCalls  int
	embedCalls int

	embedInputs [][]string

	contextSize int
}

func (b *fakeEmbeddingBackend) LoadModel(ctx context.Context, model string, force bool) (int, int, error) {
	_ = ctx
	_ = model
	_ = force

	b.mu.Lock()
	defer b.mu.Unlock()

	b.loadCalls++
	return 768, b.contextSize, nil
}

func (b *fakeEmbeddingBackend) Embed(ctx context.Context, inputs []string) ([][]float32, error) {
	_ = ctx

	b.mu.Lock()
	b.embedCalls++
	b.embedInputs = append(b.embedInputs, append([]string(nil), inputs...))
	b.mu.Unlock()

	out := make([][]float32, len(inputs))
	for i := range inputs {
		embedding := make([]float32, 768)
		embedding[0] = float32(len([]rune(inputs[i])))
		out[i] = embedding
	}
	return out, nil
}

func (b *fakeEmbeddingBackend) Version(ctx context.Context) (string, error) {
	_ = ctx
	return "fake", nil
}

func countEmbeddings(t *testing.T, conn *sqlite.Conn) int64 {
	t.Helper()

	var n int64
	require.NoError(t, sqlitex.Exec(conn, "SELECT COUNT(*) FROM embeddings;", func(stmt *sqlite.Stmt) error {
		n = stmt.ColumnInt64(0)
		return nil
	}))
	return n
}

func countEmbeddingsForFTSID(t *testing.T, conn *sqlite.Conn, ftsID int64) int64 {
	t.Helper()

	var n int64
	require.NoError(t, sqlitex.Exec(conn, "SELECT COUNT(*) FROM embeddings WHERE fts_id = ?;", func(stmt *sqlite.Stmt) error {
		n = stmt.ColumnInt64(0)
		return nil
	}, ftsID))
	return n
}

func TestEmbedderRunOnce_IndexingBehavior(t *testing.T) {
	ctx := t.Context()

	db := storage.MakeTestMemoryDB(t)
	require.NoError(t, db.WithTx(ctx, func(conn *sqlite.Conn) error {
		const (
			fts1 int64 = 1
			fts2 int64 = 2
			fts3 int64 = 3
		)

		longText := "01234567890123456789" // 20 runes
		alreadyEmbeddedText := "this one is already embedded"
		shortText := "tiny-text"

		if err := sqlitex.Exec(conn,
			`INSERT INTO fts(rowid, raw_content, type) VALUES (?, ?, ?);`,
			nil, fts1, longText, "document",
		); err != nil {
			return err
		}
		if err := sqlitex.Exec(conn,
			`INSERT INTO fts(rowid, raw_content, type) VALUES (?, ?, ?);`,
			nil, fts2, alreadyEmbeddedText, "document",
		); err != nil {
			return err
		}
		if err := sqlitex.Exec(conn,
			`INSERT INTO fts(rowid, raw_content, type) VALUES (?, ?, ?);`,
			nil, fts3, shortText, "title",
		); err != nil {
			return err
		}

		// Mark fts2 as already embedded so it must be skipped by pending query.
		return sqlitex.Exec(conn,
			`INSERT INTO embeddings (embeddinggemma300m, fts_id) VALUES (vec_int8(?), ?);`,
			nil, make([]int8, 768), fts2,
		)
	}))

	tm := taskmanager.NewTaskManager()
	tm.UpdateGlobalState(daemonpb.State_ACTIVE)

	backend := &fakeEmbeddingBackend{contextSize: 10} // maxChunkLength=floor(10*0.9)=9

	e, err := NewEmbedder(
		db,
		backend,
		zap.NewNop(),
		tm,
		WithModel(DefaultEmbeddingModel),
		WithIndexPassSize(1), // force multiple passes
		WithSleepPerPass(0*time.Millisecond),
	)
	require.NoError(t, err)

	conn, release, err := db.Conn(ctx)
	require.NoError(t, err)
	beforeTotal := countEmbeddings(t, conn)
	beforeFTS2 := countEmbeddingsForFTSID(t, conn, 2)
	release()

	require.Equal(t, int64(1), beforeFTS2)

	require.NoError(t, e.runOnce(ctx))

	backend.mu.Lock()
	require.Equal(t, 1, backend.loadCalls)
	require.Equal(t, 2, backend.embedCalls) // fts1 pass + fts3 pass
	firstPassInputs := append([]string(nil), backend.embedInputs[0]...)
	secondPassInputs := append([]string(nil), backend.embedInputs[1]...)
	backend.mu.Unlock()

	require.Equal(t, chunkText("01234567890123456789", 9), firstPassInputs)
	require.Equal(t, []string{"tiny-text"}, secondPassInputs)

	conn, release, err = db.Conn(ctx)
	require.NoError(t, err)
	afterTotal := countEmbeddings(t, conn)
	require.Equal(t, beforeFTS2, countEmbeddingsForFTSID(t, conn, 2), "fts2 must not be duplicated")
	require.Equal(t, int64(3), countEmbeddingsForFTSID(t, conn, 1), "fts1 must be chunked into 3 rows")
	require.Equal(t, int64(1), countEmbeddingsForFTSID(t, conn, 3), "fts3 must produce one row")

	wantIncrease := int64(3 + 1) // chunks(fts1)=3 plus fts3=1
	require.Equal(t, beforeTotal+wantIncrease, afterTotal)

	release()

	// Second run must not embed or insert anything new.
	require.NoError(t, e.runOnce(ctx))

	backend.mu.Lock()
	require.Equal(t, 1, backend.loadCalls, "model must only be loaded once")
	require.Equal(t, 2, backend.embedCalls, "no new embedding calls expected")
	backend.mu.Unlock()

	conn, release, err = db.Conn(ctx)
	require.NoError(t, err)
	require.Equal(t, afterTotal, countEmbeddings(t, conn))
	release()

	require.Len(t, tm.Tasks(), 0, "task must be deleted at the end of run")
}

func TestEmbedderRunOnce_RequiresDaemonActive(t *testing.T) {
	ctx := t.Context()

	db := storage.MakeTestMemoryDB(t)
	require.NoError(t, db.WithTx(ctx, func(conn *sqlite.Conn) error {
		return sqlitex.Exec(conn,
			`INSERT INTO fts(rowid, raw_content, type) VALUES (?, ?, ?);`,
			nil, int64(1), "hello world", "document",
		)
	}))

	// Default is State_STARTING; runOnce must refuse to run.
	tm := taskmanager.NewTaskManager()
	backend := &fakeEmbeddingBackend{contextSize: 10}

	e, err := NewEmbedder(
		db,
		backend,
		zap.NewNop(),
		tm,
		WithModel(DefaultEmbeddingModel),
		WithSleepPerPass(0*time.Millisecond),
	)
	require.NoError(t, err)

	err = e.runOnce(ctx)
	require.Error(t, err)
	require.Contains(t, err.Error(), "daemon must be fully active")
}

func TestEmbedderInit_StartsIndexingLoop(t *testing.T) {
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()

	// Use a small context size so chunking is exercised: floor(10*0.9)=9.
	mockServer := newMockOllamaServer(t, withMockOllamaContextSize(10))
	t.Cleanup(mockServer.server.Close)

	backend, err := NewOllamaClient(mockServer.server.URL, WithBatchSize(1000))
	require.NoError(t, err)

	db := storage.MakeTestMemoryDB(t)
	require.NoError(t, db.WithTx(ctx, func(conn *sqlite.Conn) error {
		return sqlitex.Exec(conn,
			`INSERT INTO fts(rowid, raw_content, type) VALUES (?, ?, ?);`,
			nil, int64(1), "this is a test document", "document",
		)
	}))

	tm := taskmanager.NewTaskManager()
	tm.UpdateGlobalState(daemonpb.State_ACTIVE)

	e, err := NewEmbedder(
		db,
		backend,
		zap.NewNop(),
		tm,
		WithModel(DefaultEmbeddingModel),
		WithIndexPassSize(100),
		WithSleepPerPass(0*time.Millisecond),
		WithInterval(minRunInterval),
	)
	require.NoError(t, err)

	e.Init(ctx)

	select {
	case <-mockServer.firstEmbedDone:
		// Wait for the run to finish inserting before canceling.
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for Init() to trigger embedding")
	}

	// With context size 10 -> max chunk len 9 -> 20 runes become 3 chunks.
	require.Eventually(t, func() bool {
		conn, release, err := db.Conn(t.Context())
		if err != nil {
			return false
		}
		defer release()
		return countEmbeddingsForFTSID(t, conn, 1) == 3
	}, 2*time.Second, 10*time.Millisecond)

	// Stop the loop quickly after the first run completes.
	cancel()

	// Wait for the runOnce deferred cleanup to run.
	require.Eventually(t, func() bool {
		return len(tm.Tasks()) == 0
	}, 2*time.Second, 10*time.Millisecond)

	mockServer.mu.Lock()
	require.GreaterOrEqual(t, mockServer.showRequests, 1)
	require.Equal(t, 1, mockServer.embedRequests)
	require.Len(t, mockServer.batchSizes, 1)
	require.Equal(t, 3, mockServer.batchSizes[0])
	mockServer.mu.Unlock()
}
