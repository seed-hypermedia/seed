package llm

import (
	"context"
	"fmt"
	"math"
	"net/url"
	"sync"
	"testing"
	"time"

	"seed/backend/daemon/taskmanager"
	daemonpb "seed/backend/genproto/daemon/v1alpha"
	"seed/backend/llm/backends"
	"seed/backend/llm/backends/llamacpp"
	"seed/backend/llm/backends/ollama"
	"seed/backend/storage"
	"seed/backend/testutil"
	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"

	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
)

type fakeEmbeddingBackend struct {
	mu sync.Mutex

	loadCalls           int
	embedCalls          int
	retrieveSingleCalls int

	embedInputs [][]string

	contextSize int
}

func (b *fakeEmbeddingBackend) CloseModel(ctx context.Context) error {
	_ = ctx
	return nil
}

func (b *fakeEmbeddingBackend) TokenLength(ctx context.Context, input string) (int, error) {
	_ = ctx
	return len([]rune(input)), nil
}

func (b *fakeEmbeddingBackend) LoadModel(ctx context.Context, model string, force bool, taskMgr *taskmanager.TaskManager) (backends.ModelInfo, error) {
	_ = ctx
	_ = model
	_ = force
	_ = taskMgr

	b.mu.Lock()
	defer b.mu.Unlock()

	b.loadCalls++
	return backends.ModelInfo{Dimensions: 384, ContextSize: b.contextSize, Checksum: "fake-checksum"}, nil
}

func (b *fakeEmbeddingBackend) RetrieveSingle(ctx context.Context, input string) ([]float32, error) {
	_ = ctx
	b.mu.Lock()
	b.retrieveSingleCalls++
	b.mu.Unlock()
	embedding := make([]float32, 384)
	embedding[0] = float32(len([]rune(input)))
	return embedding, nil
}

func (b *fakeEmbeddingBackend) Embed(ctx context.Context, inputs []string) ([][]float32, error) {
	_ = ctx

	b.mu.Lock()
	b.embedCalls++
	b.embedInputs = append(b.embedInputs, append([]string(nil), inputs...))
	b.mu.Unlock()

	out := make([][]float32, len(inputs))
	for i := range inputs {
		embedding := make([]float32, 384)
		embedding[0] = float32(len([]rune(inputs[i])))
		out[i] = embedding
	}
	return out, nil
}

func (b *fakeEmbeddingBackend) Version(ctx context.Context) (string, error) {
	_ = ctx
	return "fake", nil
}

// Thread-safe getters for test assertions.
func (b *fakeEmbeddingBackend) getLoadCalls() int {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.loadCalls
}

func (b *fakeEmbeddingBackend) getEmbedCalls() int {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.embedCalls
}

func (b *fakeEmbeddingBackend) getRetrieveSingleCalls() int {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.retrieveSingleCalls
}

func (b *fakeEmbeddingBackend) getEmbedInputs() [][]string {
	b.mu.Lock()
	defer b.mu.Unlock()
	// Return a copy to avoid races after releasing the lock
	result := make([][]string, len(b.embedInputs))
	for i, inputs := range b.embedInputs {
		result[i] = append([]string(nil), inputs...)
	}
	return result
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
		if err := sqlitex.SetKV(ctx, conn, kvEmbeddingModelChecksumKey, "fake-checksum", true); err != nil {
			return err
		}
		// Mark fts2 as already embedded so it must be skipped by pending query.
		return sqlitex.Exec(conn,
			`INSERT INTO embeddings (multilingual_minilm_l12_v2, fts_id) VALUES (vec_int8(?), ?);`,
			nil, make([]int8, 384), fts2,
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
		WithInterval(10*time.Minute), // disable automatic runs
		WithIndexPassSize(1),         // force multiple passes
		WithSleepPerPass(0*time.Millisecond),
	)
	require.NoError(t, err)

	conn, release, err := db.Conn(ctx)
	require.NoError(t, err)
	beforeTotal := countEmbeddings(t, conn)
	beforeFTS2 := countEmbeddingsForFTSID(t, conn, 2)
	release()

	require.Equal(t, int64(1), beforeFTS2)
	e.Init(t.Context())

	//require.NoError(t, e.runOnce(ctx))

	require.Equal(t, 1, backend.getLoadCalls())
	require.Eventually(t, func() bool { return backend.getEmbedCalls() == 2 },
		200*time.Second, 10*time.Millisecond, "expected 2 embed call after init run")
	embedInputs := backend.getEmbedInputs()
	firstPassInputs := embedInputs[0]
	secondPassInputs := embedInputs[1]

	expectedChunks := chunkText("01234567890123456789", 9, pctOverlap)
	require.Equal(t, expectedChunks, firstPassInputs)

	expectedOverlap := int(math.Round(float64(pctOverlap) * float64(9)))
	if expectedOverlap >= 9 {
		expectedOverlap = 8
	}
	for i := 0; i+1 < len(expectedChunks); i++ {
		prev := []rune(expectedChunks[i])
		next := []rune(expectedChunks[i+1])
		if expectedOverlap == 0 {
			continue
		}
		require.GreaterOrEqual(t, len(prev), expectedOverlap)
		require.GreaterOrEqual(t, len(next), expectedOverlap)
		require.Equal(t, prev[len(prev)-expectedOverlap:], next[:expectedOverlap])
	}
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

	require.Equal(t, 1, backend.getLoadCalls(), "model must only be loaded once")
	require.Equal(t, 2, backend.getEmbedCalls(), "no new embedding calls expected")

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
	mockServer := testutil.NewMockOllamaServer(t, testutil.WithMockOllamaContextSize(10))
	t.Cleanup(mockServer.Server.Close)
	url, err := url.Parse(mockServer.Server.URL)
	require.NoError(t, err)
	backend, err := ollama.NewClient(*url, ollama.WithBatchSize(1000))
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
	case <-mockServer.FirstEmbedDone:
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

	mockServer.Mu.Lock()
	require.GreaterOrEqual(t, mockServer.ShowRequests, 1)
	require.Equal(t, 1, mockServer.EmbedRequests)
	require.Len(t, mockServer.BatchSizes, 1)
	require.Equal(t, 3, mockServer.BatchSizes[0])
	mockServer.Mu.Unlock()
}

func TestEmbedder_SemanticSearch_Manual(t *testing.T) {
	// Quality checks are tight to detect any regressions on embedding model.
	ctx := t.Context()

	// Use embedded GGUF model (empty URL = embedded)
	backend, err := llamacpp.NewClient(url.URL{}, llamacpp.WithBatchSize(10))
	require.NoError(t, err)
	t.Cleanup(func() { _ = backend.CloseModel(ctx) })

	db := storage.MakeTestDB(t)
	var allTypes = map[string]bool{"title": true, "document": true, "comment": true, "contact": true}
	// Test sentences: semantically related in different languages
	testSentences := []struct {
		id          int64
		text        string
		contentType string
		topic       string // for verification
	}{
		// Technology/AI topic - English and Spanish
		{1, "Machine learning is transforming how we build software", "document", "tech"},
		{2, "El aprendizaje automático está transformando cómo construimos software", "document", "tech"},
		{3, "Deep neural networks can recognize patterns in data", "document", "tech"},
		{4, "Las redes neuronales profundas pueden reconocer patrones en datos", "document", "tech"}, //nolint:misspell // "patrones" is Spanish for "patterns"

		// Food/cooking topic - English and Spanish
		{5, "The best way to cook pasta is in salted boiling water", "document", "food"},
		{6, "La mejor forma de cocinar pasta es en agua hirviendo con sal", "document", "food"},
		{7, "Italian cuisine uses fresh tomatoes and olive oil", "title", "food"},
		{8, "La cocina italiana usa tomates frescos y aceite de oliva", "title", "food"},

		// Nature/animals topic - English and Spanish
		{9, "Dogs are loyal companions and love to play", "comment", "animals"},
		{10, "Los perros son compañeros leales y les encanta jugar", "comment", "animals"},
		{11, "Cats are independent animals that enjoy sleeping", "comment", "animals"},
		{12, "Los gatos son animales independientes que disfrutan dormir", "comment", "animals"},
	}

	tm := taskmanager.NewTaskManager()
	tm.UpdateGlobalState(daemonpb.State_ACTIVE)

	e, err := NewEmbedder(
		db,
		backend,
		zap.NewNop(),
		tm,
		WithModel(DefaultEmbeddingModel),
		WithInterval(10*time.Minute),
		WithSleepPerPass(0),
	)
	require.NoError(t, err)

	// Insert test data and generate real embeddings
	require.NoError(t, db.WithTx(ctx, func(conn *sqlite.Conn) error {
		// Insert public_key for author (shared by all entries)
		if err := sqlitex.Exec(conn,
			`INSERT INTO public_keys(id, principal) VALUES (?, ?);`,
			nil, int64(1), "test-author",
		); err != nil {
			return err
		}

		for _, s := range testSentences {
			// Insert blob
			if err := sqlitex.Exec(conn,
				`INSERT INTO blobs(id, multihash, codec, size) VALUES (?, ?, ?, ?);`,
				nil, s.id*100, []byte(fmt.Sprintf("hash-%d", s.id)), 0x55, len(s.text),
			); err != nil {
				return err
			}
			// Insert resource with IRI
			if err := sqlitex.Exec(conn,
				`INSERT INTO resources(id, iri) VALUES (?, ?);`,
				nil, s.id, fmt.Sprintf("hm://test/doc-%d", s.id),
			); err != nil {
				return err
			}
			// Insert structural_blob linking blob to resource
			if err := sqlitex.Exec(conn,
				`INSERT INTO structural_blobs(id, type, resource, author) VALUES (?, ?, ?, ?);`,
				nil, s.id*100, "Change", s.id, int64(1),
			); err != nil {
				return err
			}
			// Insert FTS entry
			if err := sqlitex.Exec(conn,
				`INSERT INTO fts(rowid, raw_content, type, blob_id, block_id, version) VALUES (?, ?, ?, ?, ?, ?);`,
				nil, s.id, s.text, s.contentType, s.id*100, fmt.Sprintf("block%d", s.id), fmt.Sprintf("v%d", s.id),
			); err != nil {
				return err
			}
			// Insert fts_index entry
			if err := sqlitex.Exec(conn,
				`INSERT INTO fts_index(rowid, blob_id, block_id, version, type, ts) VALUES (?, ?, ?, ?, ?, ?);`,
				nil, s.id, s.id*100, fmt.Sprintf("block%d", s.id), fmt.Sprintf("v%d", s.id), s.contentType, s.id*1000,
			); err != nil {
				return err
			}
		}
		return nil
	}))

	e.Init(t.Context())
	require.Eventually(t, func() bool {
		e.mu.Lock()
		defer e.mu.Unlock()
		return e.modelLoaded
	}, 2*time.Second, 10*time.Millisecond)

	// Generate and store embeddings for all sentences
	allTexts := make([]string, len(testSentences))
	for i, s := range testSentences {
		allTexts[i] = s.text
	}

	embeddings, err := backend.Embed(ctx, allTexts)
	require.NoError(t, err)
	require.Len(t, embeddings, len(testSentences))

	// Wait for any indexing tasks to finish (The one produced by the initial indexing pass).
	require.Eventually(t, func() bool {
		return len(tm.Tasks()) == 0
	}, 30*time.Second, 100*time.Millisecond, "indexing tasks should complete")

	t.Run("English ML query finds tech content first", func(t *testing.T) {
		results, err := e.SemanticSearch(ctx, "artificial intelligence and machine learning", 10, allTypes, "*", 0.0)
		require.NoError(t, err)
		require.NotEmpty(t, results)

		// Top results should be about technology
		t.Logf("Query: 'artificial intelligence and machine learning'")
		for ftsRowid, score := range results {
			t.Logf("  %d. [%.4f] %s", ftsRowid, score, "")
		}

		// At least the top result should be tech-related (IDs 1-4)
		topResult := results.Max()
		require.GreaterOrEqual(t, topResult.RowID, int64(1), "Top result should be in the AI/Tech bucket: %d", topResult.RowID)
		require.LessOrEqual(t, topResult.RowID, int64(4), "Top result should be in the AI/Tech bucket: %d", topResult.RowID)

		// Tech content (IDs 1-4) should rank higher than non-tech content (IDs 5-12)
		sortedResults := results.ToList(true)
		techScores := make([]float32, 0)
		nonTechScores := make([]float32, 0)
		for _, r := range sortedResults {
			if r.RowID >= 1 && r.RowID <= 4 {
				techScores = append(techScores, r.Score)
			} else {
				nonTechScores = append(nonTechScores, r.Score)
			}
		}
		require.NotEmpty(t, techScores, "Should have tech results")
		require.NotEmpty(t, nonTechScores, "Should have non-tech results")
		require.Greater(t, techScores[0], nonTechScores[0], "Best tech result should beat best non-tech result")
	})

	t.Run("Spanish ML query finds tech content", func(t *testing.T) {
		results, err := e.SemanticSearch(ctx, "inteligencia artificial y redes neuronales", 10, allTypes, "*", 0.0)
		require.NoError(t, err)
		require.NotEmpty(t, results)

		t.Logf("Query: 'inteligencia artificial y redes neuronales'")
		for ftsRowid, score := range results {
			t.Logf("  %d. [%.4f] %s", ftsRowid, score, "")
		}

		// At least the top result should be tech-related (IDs 1-4)
		topResult := results.Max()
		require.GreaterOrEqual(t, topResult.RowID, int64(1), "Top result should be in the AI/Tech bucket: %d", topResult.RowID)
		require.LessOrEqual(t, topResult.RowID, int64(4), "Top result should be in the AI/Tech bucket: %d", topResult.RowID)
	})

	t.Run("Food query finds cooking content", func(t *testing.T) {
		results, err := e.SemanticSearch(ctx, "how to cook Italian food with pasta", 10, allTypes, "*", 0.0)
		require.NoError(t, err)
		require.NotEmpty(t, results)

		t.Logf("Query: 'how to cook Italian food with pasta'")
		for ftsRowid, score := range results {
			t.Logf("  %d. [%.4f] %s", ftsRowid, score, "")
		}

		// Top result should be about food (IDs 5-8)
		topResult := results.Max()
		require.GreaterOrEqual(t, topResult.RowID, int64(5), "Top result should be in the food bucket: %d", topResult.RowID)
		require.LessOrEqual(t, topResult.RowID, int64(8), "Top result should be in the food bucket: %d", topResult.RowID)
	})

	t.Run("Spanish food query finds cooking content", func(t *testing.T) {
		results, err := e.SemanticSearch(ctx, "recetas de comida italiana con aceite", 10, allTypes, "*", 0.0)
		require.NoError(t, err)
		require.NotEmpty(t, results)

		t.Logf("Query: 'recetas de comida italiana con aceite'")
		for ftsRowid, score := range results {
			t.Logf("  %d. [%.4f] %s", ftsRowid, score, "")
		}

		// Top result should be about food (IDs 5-8)
		topResult := results.Max()
		require.GreaterOrEqual(t, topResult.RowID, int64(5), "Top result should be in the food bucket: %d", topResult.RowID)
		require.LessOrEqual(t, topResult.RowID, int64(8), "Top result should be in the food bucket: %d", topResult.RowID)
	})

	t.Run("Pets query finds animal content", func(t *testing.T) {
		results, err := e.SemanticSearch(ctx, "pets and domestic animals", 10, allTypes, "*", 0.0)
		require.NoError(t, err)
		require.NotEmpty(t, results)

		t.Logf("Query: 'pets and domestic animals'")
		for ftsRowid, score := range results {
			t.Logf("  %d. [%.4f] %s", ftsRowid, score, "")
		}

		// Top result should be about animals (IDs 9-12)
		topResult := results.Max()
		require.GreaterOrEqual(t, topResult.RowID, int64(9), "Top result should be in the animals bucket: %d", topResult.RowID)
		require.LessOrEqual(t, topResult.RowID, int64(12), "Top result should be in the animals bucket: %d", topResult.RowID)
	})

	t.Run("Cross-language similarity works", func(t *testing.T) {
		// Query in English about dogs
		resultsEn, err := e.SemanticSearch(ctx, "dogs playing and having fun", 10, allTypes, "*", 0.0)
		require.NoError(t, err)
		require.NotEmpty(t, resultsEn)

		// Query in Spanish about dogs
		resultsEs, err := e.SemanticSearch(ctx, "perros jugando y divirtiéndose", 10, allTypes, "*", 0.0)
		require.NoError(t, err)
		require.NotEmpty(t, resultsEs)

		t.Logf("English query 'dogs playing and having fun':")
		for ftsRowid, score := range resultsEn {
			t.Logf("  %d. [%.4f] %s", ftsRowid, score, "")
		}
		t.Logf("Spanish query 'perros jugando y divirtiéndose':")
		for ftsRowid, score := range resultsEs {
			t.Logf("  %d. [%.4f] %s", ftsRowid, score, "")
		}

		// Both should return dog-related content as top result (IDs 9 or 10)
		topResultEn := resultsEn.Max()
		topResultEs := resultsEs.Max()

		// Dogs are in IDs 9-10, so top result should be in animals bucket (9-12)
		require.GreaterOrEqual(t, topResultEn.RowID, int64(9), "English query top result should be about animals")
		require.LessOrEqual(t, topResultEn.RowID, int64(12), "English query top result should be about animals")
		require.GreaterOrEqual(t, topResultEs.RowID, int64(9), "Spanish query top result should be about animals")
		require.LessOrEqual(t, topResultEs.RowID, int64(12), "Spanish query top result should be about animals")

		// Both should have decent scores (above 0.6)
		require.Greater(t, topResultEn.Score, float32(0.6), "English query should have decent score")
		require.Greater(t, topResultEs.Score, float32(0.6), "Spanish query should have decent score")
	})

	t.Run("Content type filtering works with real embeddings", func(t *testing.T) {
		// Only comments (animals topic)
		results, err := e.SemanticSearch(ctx, "domestic pets", 10, map[string]bool{"comment": true}, "*", 0.0)
		require.NoError(t, err)
		require.NotEmpty(t, results)

		t.Logf("Query 'domestic pets' filtered to comments only:")
		for ftsRowid, score := range results {
			t.Logf("  %d. [%.4f]", ftsRowid, score)
		}

		// Comments are IDs 9-12, so all results should be in that range
		for rowID := range results {
			require.GreaterOrEqual(t, rowID, int64(9), "Filtered result should be comment type (IDs 9-12)")
			require.LessOrEqual(t, rowID, int64(12), "Filtered result should be comment type (IDs 9-12)")
		}
	})

	t.Run("Scores are ordered correctly", func(t *testing.T) {
		resultsMap, err := e.SemanticSearch(ctx, "software development", 10, allTypes, "*", 0.0)
		require.NoError(t, err)
		require.NotEmpty(t, resultsMap)

		// All scores should be between 0 and 1
		maxScore := resultsMap.ToList(true)[2]
		minScore := resultsMap.ToList(false)[1]

		require.GreaterOrEqual(t, maxScore.Score, float32(0.0), "Max score should be >= 0")
		require.LessOrEqual(t, maxScore.Score, float32(1.0), "Max score should be <= 1")
		require.GreaterOrEqual(t, minScore.Score, float32(0.0), "Min score should be >= 0")
		require.LessOrEqual(t, minScore.Score, float32(1.0), "Min score should be <= 1")
		require.GreaterOrEqual(t, maxScore.Score, minScore.Score, "Max score should be >= min score")

		t.Logf("Query 'software development' - max score: %.4f (rowID: %d), min score: %.4f (rowID: %d)",
			maxScore.Score, maxScore.RowID, minScore.Score, minScore.RowID)
	})
}

func TestEmbedder_SemanticSearch(t *testing.T) {
	ctx := t.Context()

	db := storage.MakeTestMemoryDB(t)
	allTypes := map[string]bool{"title": true, "document": true, "comment": true, "contact": true}
	// Insert test data: FTS entries with corresponding embeddings
	require.NoError(t, db.WithTx(ctx, func(conn *sqlite.Conn) error {
		// Insert blobs (required for structural_blobs FK)
		for _, blobID := range []int64{100, 101, 102} {
			if err := sqlitex.Exec(conn,
				`INSERT INTO blobs(id, multihash, codec, size) VALUES (?, ?, ?, ?);`,
				nil, blobID, []byte(fmt.Sprintf("hash-%d", blobID)), 0x55, 0,
			); err != nil {
				return err
			}
		}

		// Insert resources with non-null IRI
		for i, resID := range []int64{1, 2, 3} {
			if err := sqlitex.Exec(conn,
				`INSERT INTO resources(id, iri) VALUES (?, ?);`,
				nil, resID, fmt.Sprintf("hm://test/resource-%d", i+1),
			); err != nil {
				return err
			}
		}

		// Insert public_key for author
		if err := sqlitex.Exec(conn,
			`INSERT INTO public_keys(id, principal) VALUES (?, ?);`,
			nil, int64(1), "test-author",
		); err != nil {
			return err
		}

		// Insert structural_blobs linking blob_id to resources
		for i, blobID := range []int64{100, 101, 102} {
			if err := sqlitex.Exec(conn,
				`INSERT INTO structural_blobs(id, type, resource, author) VALUES (?, ?, ?, ?);`,
				nil, blobID, "Change", int64(i+1), int64(1),
			); err != nil {
				return err
			}
		}

		// Insert FTS entries
		if err := sqlitex.Exec(conn,
			`INSERT INTO fts(rowid, raw_content, type, blob_id, block_id, version) VALUES (?, ?, ?, ?, ?, ?);`,
			nil, int64(1), "machine learning algorithms", "document", 100, "block1", "v1",
		); err != nil {
			return err
		}
		if err := sqlitex.Exec(conn,
			`INSERT INTO fts(rowid, raw_content, type, blob_id, block_id, version) VALUES (?, ?, ?, ?, ?, ?);`,
			nil, int64(2), "deep neural networks", "document", 101, "block2", "v2",
		); err != nil {
			return err
		}
		if err := sqlitex.Exec(conn,
			`INSERT INTO fts(rowid, raw_content, type, blob_id, block_id, version) VALUES (?, ?, ?, ?, ?, ?);`,
			nil, int64(3), "cooking recipes for beginners", "title", 102, "block3", "v3",
		); err != nil {
			return err
		}

		// Insert fts_index entries (required for join)
		if err := sqlitex.Exec(conn,
			`INSERT INTO fts_index(rowid, blob_id, block_id, version, type, ts) VALUES (?, ?, ?, ?, ?, ?);`,
			nil, int64(1), 100, "block1", "v1", "document", 1000,
		); err != nil {
			return err
		}
		if err := sqlitex.Exec(conn,
			`INSERT INTO fts_index(rowid, blob_id, block_id, version, type, ts) VALUES (?, ?, ?, ?, ?, ?);`,
			nil, int64(2), 101, "block2", "v2", "document", 2000,
		); err != nil {
			return err
		}
		if err := sqlitex.Exec(conn,
			`INSERT INTO fts_index(rowid, blob_id, block_id, version, type, ts) VALUES (?, ?, ?, ?, ?, ?);`,
			nil, int64(3), 102, "block3", "v3", "title", 3000,
		); err != nil {
			return err
		}

		// Insert embeddings - fake backend produces embedding[0] = len(input)
		// "machine learning algorithms" = 28 chars
		// "deep neural networks" = 20 chars
		// "cooking recipes for beginners" = 29 chars
		emb1 := make([]int8, 384)
		emb1[0] = 28 // similar to ML query
		emb2 := make([]int8, 384)
		emb2[0] = 20 // similar to ML query
		emb3 := make([]int8, 384)
		emb3[0] = 29 // different topic

		if err := sqlitex.Exec(conn,
			`INSERT INTO embeddings (multilingual_minilm_l12_v2, fts_id) VALUES (vec_int8(?), ?);`,
			nil, emb1, int64(1),
		); err != nil {
			return err
		}
		if err := sqlitex.Exec(conn,
			`INSERT INTO embeddings (multilingual_minilm_l12_v2, fts_id) VALUES (vec_int8(?), ?);`,
			nil, emb2, int64(2),
		); err != nil {
			return err
		}
		if err := sqlitex.Exec(conn,
			`INSERT INTO embeddings (multilingual_minilm_l12_v2, fts_id) VALUES (vec_int8(?), ?);`,
			nil, emb3, int64(3),
		); err != nil {
			return err
		}

		return sqlitex.SetKV(ctx, conn, kvEmbeddingModelChecksumKey, "fake-checksum", true)
	}))

	tm := taskmanager.NewTaskManager()
	tm.UpdateGlobalState(daemonpb.State_ACTIVE)

	backend := &fakeEmbeddingBackend{contextSize: 1000}

	e, err := NewEmbedder(
		db,
		backend,
		zap.NewNop(),
		tm,
		WithModel(DefaultEmbeddingModel),
	)
	require.NoError(t, err)

	// Load model to enable semantic search
	e.Init(ctx)
	require.Eventually(t, func() bool {
		e.mu.Lock()
		defer e.mu.Unlock()
		return e.modelLoaded
	}, 2*time.Second, 10*time.Millisecond)

	t.Run("basic search returns results", func(t *testing.T) {
		results, err := e.SemanticSearch(ctx, "artificial intelligence", 10, allTypes, "*", 0.0)
		require.NoError(t, err)
		require.NotEmpty(t, results)

		// Should have called RetrieveSingle for the query
		require.GreaterOrEqual(t, backend.getRetrieveSingleCalls(), 1)
	})

	t.Run("search with content type filter", func(t *testing.T) {
		results, err := e.SemanticSearch(ctx, "test query", 10, map[string]bool{"document": true}, "*", 0.0)
		require.NoError(t, err)
		require.NotEmpty(t, results)

		// Results should only include document fts rowids (1, 2 based on test data)
		for rowID := range results {
			require.Contains(t, []int64{1, 2}, rowID, "Filtered results should only include documents")
		}
	})

	t.Run("search with title filter", func(t *testing.T) {
		results, err := e.SemanticSearch(ctx, "test query", 10, map[string]bool{"title": true}, "*", 0.0)
		require.NoError(t, err)
		require.NotEmpty(t, results)

		// Results should only include title fts rowid (3 based on test data)
		for rowID := range results {
			require.Equal(t, int64(3), rowID, "Filtered results should only include title")
		}
	})

	t.Run("search respects limit", func(t *testing.T) {
		results, err := e.SemanticSearch(ctx, "test", 1, allTypes, "*", 0.0)
		require.NoError(t, err)
		require.LessOrEqual(t, len(results), 1)
	})

	t.Run("results have valid scores", func(t *testing.T) {
		results, err := e.SemanticSearch(ctx, "machine learning", 10, allTypes, "*", 0.0)
		require.NoError(t, err)
		require.NotEmpty(t, results)

		// All scores should be between 0 and 1
		for _, score := range results {
			require.GreaterOrEqual(t, score, float32(0.0))
			require.LessOrEqual(t, score, float32(1.0))
		}
	})

	t.Run("search fails if model not loaded", func(t *testing.T) {
		uninitialized, err := NewEmbedder(
			db,
			backend,
			zap.NewNop(),
			tm,
			WithModel(DefaultEmbeddingModel),
		)
		require.NoError(t, err)
		// Don't call Init

		_, err = uninitialized.SemanticSearch(ctx, "test", 10, allTypes, "*", 0.0)
		require.Error(t, err)
		require.Contains(t, err.Error(), "model not loaded")
	})

	t.Run("rejects invalid content types", func(t *testing.T) {
		_, err := e.SemanticSearch(ctx, "test", 10, map[string]bool{"malicious'; DROP TABLE embeddings; --": true}, "*", 0.0)
		require.Error(t, err)
		require.Contains(t, err.Error(), "invalid content type")
	})

	t.Run("rejects unknown content types", func(t *testing.T) {
		_, err := e.SemanticSearch(ctx, "test", 10, map[string]bool{"unknown_type": true}, "*", 0.0)
		require.Error(t, err)
		require.Contains(t, err.Error(), "invalid content type")
	})

	t.Run("threshold filters out low similarity results", func(t *testing.T) {
		// Get all results without threshold
		allResults, err := e.SemanticSearch(ctx, "machine learning", 10, allTypes, "*", 0.0)
		require.NoError(t, err)
		require.NotEmpty(t, allResults, "Should have results with no threshold")

		// Find a reasonable threshold value between min and max scores
		minScore := allResults.Min().Score
		maxScore := allResults.Max().Score
		threshold := (minScore + maxScore) / 2

		t.Logf("All results range: min=%.4f, max=%.4f, threshold=%.4f", minScore, maxScore, threshold)

		// Search with threshold - should only get results >= threshold
		filteredResults, err := e.SemanticSearch(ctx, "machine learning", 10, allTypes, "*", threshold)
		require.NoError(t, err)

		// Verify all filtered results have scores >= threshold
		for rowID, score := range filteredResults {
			require.GreaterOrEqual(t, score, threshold,
				"Result rowID %d has score %.4f which is below threshold %.4f",
				rowID, score, threshold)
		}

		// Filtered results should be fewer than or equal to all results
		require.LessOrEqual(t, len(filteredResults), len(allResults),
			"Filtered results (%d) should be <= all results (%d)",
			len(filteredResults), len(allResults))

		// If threshold is above min, we should filter out at least one result
		if threshold > minScore {
			require.Less(t, len(filteredResults), len(allResults),
				"With threshold %.4f > min score %.4f, should filter out some results",
				threshold, minScore)
		}

		t.Logf("Filtered %d results out of %d total (%.1f%% passed threshold)",
			len(allResults)-len(filteredResults),
			len(allResults),
			float32(len(filteredResults))/float32(len(allResults))*100)
	})

	t.Run("high threshold returns only top results", func(t *testing.T) {
		// Set a high threshold - should only get very similar results
		highThreshold := float32(0.95)

		results, err := e.SemanticSearch(ctx, "machine learning", 10, allTypes, "*", highThreshold)
		require.NoError(t, err)

		// All results must meet the threshold
		for rowID, score := range results {
			require.GreaterOrEqual(t, score, highThreshold,
				"Result rowID %d has score %.4f which is below high threshold %.4f",
				rowID, score, highThreshold)
		}

		t.Logf("High threshold (%.2f) returned %d results", highThreshold, len(results))
	})

	t.Run("threshold of 1.0 returns only perfect matches", func(t *testing.T) {
		// Threshold of 1.0 should only return exact matches (if any)
		results, err := e.SemanticSearch(ctx, "machine learning", 10, allTypes, "*", 1.0)
		require.NoError(t, err)

		// All results must have score == 1.0
		for rowID, score := range results {
			require.Equal(t, float32(1.0), score,
				"Result rowID %d has score %.4f but threshold is 1.0",
				rowID, score)
		}

		t.Logf("Perfect match threshold (1.0) returned %d results", len(results))
	})
}

func TestEmbedder_SemanticRanking(t *testing.T) {
	// This test verifies that the embedding model correctly ranks relevant content
	// higher than irrelevant content for various query types including tricky words
	// like gendered terms and rare proper nouns.
	ctx := t.Context()

	backend, err := llamacpp.NewClient(url.URL{}, llamacpp.WithBatchSize(10))
	require.NoError(t, err)
	t.Cleanup(func() { _ = backend.CloseModel(ctx) })

	// Load the model before running tests.
	_, err = backend.LoadModel(ctx, "embedded", false, nil)
	require.NoError(t, err)

	// cosineSimilarity computes similarity between two float32 vectors.
	cosineSimilarity := func(a, b []float32) float32 {
		if len(a) != len(b) || len(a) == 0 {
			return 0
		}
		var dot, normA, normB float64
		for i := range a {
			dot += float64(a[i]) * float64(b[i])
			normA += float64(a[i]) * float64(a[i])
			normB += float64(b[i]) * float64(b[i])
		}
		if normA == 0 || normB == 0 {
			return 0
		}
		return float32(dot / (math.Sqrt(normA) * math.Sqrt(normB)))
	}

	// rankingTest defines a test case for semantic ranking.
	type rankingTest struct {
		query      string
		relevant   string
		irrelevant string
	}

	// English semantic ranking tests - includes tricky gendered terms and rare proper nouns.
	englishTests := []rankingTest{
		// Gendered terms - these were broken in the old model.
		{"male", "Male and female differences in biology", "Software development practices"},
		{"female", "Female athletes compete in sports", "Bitcoin cryptocurrency trading"},
		{"sex", "Sexual reproduction in mammals", "Cloud computing infrastructure"},
		{"gender", "Gender studies and social research", "Machine learning algorithms"},
		{"man", "The man walked to the store", "Quantum physics theories"},
		{"woman", "The woman won the competition", "Database optimization techniques"},
		// Rare proper nouns.
		{"engelbart", "Douglas Engelbart invented the computer mouse", "Italian pizza recipes"},
		{"dijkstra", "Dijkstra's algorithm finds shortest paths", "French cooking techniques"},
		{"turing", "Alan Turing was a brilliant mathematician", "Spanish guitar music"},
		// Common words (baseline).
		{"bitcoin", "Bitcoin is a decentralized digital currency", "Dogs are loyal companions"},
		{"music", "Classical music and jazz compositions", "Software development practices"},
		{"technology", "Technology is advancing rapidly in AI", "Italian cooking recipes"},
		{"dogs", "Dogs are loyal and friendly pets", "Quantum physics theories"},
	}

	// Spanish semantic ranking tests.
	spanishTests := []rankingTest{
		// Gendered terms in Spanish.
		{"masculino", "Diferencias entre masculino y femenino en biología", "Desarrollo de software"},
		{"femenino", "Atletas femeninas compiten en deportes", "Comercio de criptomonedas"},
		{"sexo", "Reproducción sexual en mamíferos", "Infraestructura de computación"},
		{"género", "Estudios de género e investigación social", "Algoritmos de aprendizaje"},
		{"hombre", "El hombre caminó a la tienda", "Teorías de física cuántica"},
		{"mujer", "La mujer ganó la competencia", "Técnicas de optimización"},
		// Common words in Spanish.
		{"bitcoin", "Bitcoin es una moneda digital descentralizada", "Los perros son compañeros leales"},
		{"música", "Música clásica y composiciones de jazz", "Prácticas de desarrollo de software"},
		{"tecnología", "La tecnología avanza rápidamente en IA", "Recetas de cocina italiana"},
		{"perros", "Los perros son mascotas leales y amigables", "Teorías de física cuántica"},
	}

	// Cross-language tests: English query -> Spanish content.
	crossLangEnEsTests := []rankingTest{
		{"male", "Diferencias entre masculino y femenino", "Recetas de cocina italiana"},
		{"female", "Atletas femeninas en competición", "Bitcoin y criptomonedas"},
		{"music", "La música clásica es hermosa", "Desarrollo de software moderno"},
		{"technology", "La tecnología está avanzando rápidamente", "Recetas de pasta italiana"},
		{"dogs", "Los perros son compañeros leales", "Algoritmos de inteligencia artificial"},
		{"bitcoin", "Bitcoin es una moneda digital", "La música clásica es relajante"},
	}

	// Cross-language tests: Spanish query -> English content.
	crossLangEsEnTests := []rankingTest{
		{"masculino", "Male and female biological differences", "Italian cooking recipes"},
		{"femenino", "Female athletes in competition", "Bitcoin cryptocurrency"},
		{"música", "Classical music is beautiful", "Software development practices"},
		{"tecnología", "Technology is advancing rapidly", "Italian pasta recipes"},
		{"perros", "Dogs are loyal companions", "Artificial intelligence algorithms"},
	}

	runRankingTests := func(t *testing.T, tests []rankingTest) {
		t.Helper()
		for _, tc := range tests {
			tc := tc
			t.Run(tc.query, func(t *testing.T) {
				queryEmb, err := backend.RetrieveSingle(ctx, tc.query)
				require.NoError(t, err, "failed to embed query")

				relEmb, err := backend.RetrieveSingle(ctx, tc.relevant)
				require.NoError(t, err, "failed to embed relevant content")

				irrEmb, err := backend.RetrieveSingle(ctx, tc.irrelevant)
				require.NoError(t, err, "failed to embed irrelevant content")

				relSim := cosineSimilarity(queryEmb, relEmb)
				irrSim := cosineSimilarity(queryEmb, irrEmb)

				t.Logf("query=%q relevant=%.4f irrelevant=%.4f", tc.query, relSim, irrSim)
				require.Greater(t, relSim, irrSim,
					"relevant content must rank higher than irrelevant: rel=%.4f, irr=%.4f",
					relSim, irrSim)
			})
		}
	}

	t.Run("English semantic ranking", func(t *testing.T) {
		runRankingTests(t, englishTests)
	})

	t.Run("Spanish semantic ranking", func(t *testing.T) {
		runRankingTests(t, spanishTests)
	})

	t.Run("Cross-language EN->ES ranking", func(t *testing.T) {
		runRankingTests(t, crossLangEnEsTests)
	})

	t.Run("Cross-language ES->EN ranking", func(t *testing.T) {
		runRankingTests(t, crossLangEsEnTests)
	})
}

func TestCosineSimilarityInt8(t *testing.T) {
	t.Run("identical vectors have similarity 1", func(t *testing.T) {
		v := []int8{10, 20, 30, 40, 50}
		sim := cosineSimilarityInt8(v, v)
		require.InDelta(t, 1.0, sim, 0.0001)
	})

	t.Run("opposite vectors have similarity -1", func(t *testing.T) {
		v1 := []int8{10, 20, 30}
		v2 := []int8{-10, -20, -30}
		sim := cosineSimilarityInt8(v1, v2)
		require.InDelta(t, -1.0, sim, 0.0001)
	})

	t.Run("orthogonal vectors have similarity 0", func(t *testing.T) {
		v1 := []int8{10, 0, 0}
		v2 := []int8{0, 10, 0}
		sim := cosineSimilarityInt8(v1, v2)
		require.InDelta(t, 0.0, sim, 0.0001)
	})

	t.Run("different length vectors return 0", func(t *testing.T) {
		v1 := []int8{10, 20, 30}
		v2 := []int8{10, 20}
		sim := cosineSimilarityInt8(v1, v2)
		require.Equal(t, float32(0), sim)
	})

	t.Run("empty vectors return 0", func(t *testing.T) {
		sim := cosineSimilarityInt8([]int8{}, []int8{})
		require.Equal(t, float32(0), sim)
	})

	t.Run("zero vector returns 0", func(t *testing.T) {
		v1 := []int8{0, 0, 0}
		v2 := []int8{10, 20, 30}
		sim := cosineSimilarityInt8(v1, v2)
		require.Equal(t, float32(0), sim)
	})
}
