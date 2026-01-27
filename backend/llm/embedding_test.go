package llm

import (
	"context"
	"fmt"
	"math"
	"net/url"
	"strings"
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

	loadCalls  int
	embedCalls int

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

// Thread-safe getters for test assertions
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
	backend, err := ollama.NewOllamaClient(*url, ollama.WithBatchSize(1000))
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

const testModelPath = "file:///home/julio/Documents/llama-go/models/paraphrase-multilingual-MiniLM-L12-118M-v2-Q8_0.gguf"

func TestEmbedder_SemanticSearch_Manual(t *testing.T) {
	testutil.Manual(t)
	ctx := t.Context()

	// Load real GGUF model
	fileURL, err := url.Parse(testModelPath)
	require.NoError(t, err)

	backend, err := llamacpp.NewLlamaCppClient(*fileURL, llamacpp.WithBatchSize(10))
	require.NoError(t, err)
	t.Cleanup(func() { _ = backend.CloseModel(ctx) })

	db := storage.MakeTestMemoryDB(t)

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
		{4, "Las redes neuronales profundas pueden reconocer patrones en datos", "document", "tech"},

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
		for _, s := range testSentences {
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
		results, err := e.SemanticSearch(ctx, "artificial intelligence and machine learning", 10, nil)
		require.NoError(t, err)
		require.NotEmpty(t, results)

		// Top results should be about technology
		t.Logf("Query: 'artificial intelligence and machine learning'")
		for i, r := range results {
			t.Logf("  %d. [%.4f] %s", i+1, r.SemanticScore, r.TextSnippet[:min(60, len(r.TextSnippet))])
		}

		// At least the top result should be tech-related
		topResult := results[0].TextSnippet
		isTech := strings.Contains(strings.ToLower(topResult), "learning") ||
			strings.Contains(strings.ToLower(topResult), "neural") ||
			strings.Contains(strings.ToLower(topResult), "aprendizaje") ||
			strings.Contains(strings.ToLower(topResult), "redes")
		require.True(t, isTech, "Top result should be about tech/ML, got: %s", topResult)
	})

	t.Run("Spanish ML query finds tech content", func(t *testing.T) {
		results, err := e.SemanticSearch(ctx, "inteligencia artificial y redes neuronales", 10, nil)
		require.NoError(t, err)
		require.NotEmpty(t, results)

		t.Logf("Query: 'inteligencia artificial y redes neuronales'")
		for i, r := range results {
			t.Logf("  %d. [%.4f] %s", i+1, r.SemanticScore, r.TextSnippet[:min(60, len(r.TextSnippet))])
		}

		// Top result should be tech-related (in any language)
		topResult := results[0].TextSnippet
		isTech := strings.Contains(strings.ToLower(topResult), "learning") ||
			strings.Contains(strings.ToLower(topResult), "neural") ||
			strings.Contains(strings.ToLower(topResult), "aprendizaje") ||
			strings.Contains(strings.ToLower(topResult), "redes")
		require.True(t, isTech, "Top result should be about tech/ML, got: %s", topResult)
	})

	t.Run("Food query finds cooking content", func(t *testing.T) {
		results, err := e.SemanticSearch(ctx, "how to cook Italian food with pasta", 10, nil)
		require.NoError(t, err)
		require.NotEmpty(t, results)

		t.Logf("Query: 'how to cook Italian food with pasta'")
		for i, r := range results {
			t.Logf("  %d. [%.4f] %s", i+1, r.SemanticScore, r.TextSnippet[:min(60, len(r.TextSnippet))])
		}

		// Top result should be about food
		topResult := results[0].TextSnippet
		isFood := strings.Contains(strings.ToLower(topResult), "pasta") ||
			strings.Contains(strings.ToLower(topResult), "cook") ||
			strings.Contains(strings.ToLower(topResult), "italian") ||
			strings.Contains(strings.ToLower(topResult), "cocina") ||
			strings.Contains(strings.ToLower(topResult), "tomate")
		require.True(t, isFood, "Top result should be about food, got: %s", topResult)
	})

	t.Run("Spanish food query finds cooking content", func(t *testing.T) {
		results, err := e.SemanticSearch(ctx, "recetas de comida italiana con aceite", 10, nil)
		require.NoError(t, err)
		require.NotEmpty(t, results)

		t.Logf("Query: 'recetas de comida italiana con aceite'")
		for i, r := range results {
			t.Logf("  %d. [%.4f] %s", i+1, r.SemanticScore, r.TextSnippet[:min(60, len(r.TextSnippet))])
		}

		// Top result should be about food
		topResult := results[0].TextSnippet
		isFood := strings.Contains(strings.ToLower(topResult), "pasta") ||
			strings.Contains(strings.ToLower(topResult), "cook") ||
			strings.Contains(strings.ToLower(topResult), "italian") ||
			strings.Contains(strings.ToLower(topResult), "cocina") ||
			strings.Contains(strings.ToLower(topResult), "tomate") ||
			strings.Contains(strings.ToLower(topResult), "aceite")
		require.True(t, isFood, "Top result should be about food, got: %s", topResult)
	})

	t.Run("Pets query finds animal content", func(t *testing.T) {
		results, err := e.SemanticSearch(ctx, "pets and domestic animals", 10, nil)
		require.NoError(t, err)
		require.NotEmpty(t, results)

		t.Logf("Query: 'pets and domestic animals'")
		for i, r := range results {
			t.Logf("  %d. [%.4f] %s", i+1, r.SemanticScore, r.TextSnippet[:min(60, len(r.TextSnippet))])
		}

		// Top result should be about animals
		topResult := results[0].TextSnippet
		isAnimals := strings.Contains(strings.ToLower(topResult), "dog") ||
			strings.Contains(strings.ToLower(topResult), "cat") ||
			strings.Contains(strings.ToLower(topResult), "perro") ||
			strings.Contains(strings.ToLower(topResult), "gato")
		require.True(t, isAnimals, "Top result should be about animals, got: %s", topResult)
	})

	t.Run("Cross-language similarity works", func(t *testing.T) {
		// Query in English about dogs
		resultsEn, err := e.SemanticSearch(ctx, "dogs playing and having fun", 10, nil)
		require.NoError(t, err)
		require.NotEmpty(t, resultsEn)

		// Query in Spanish about dogs
		resultsEs, err := e.SemanticSearch(ctx, "perros jugando y divirtiéndose", 10, nil)
		require.NoError(t, err)
		require.NotEmpty(t, resultsEs)

		t.Logf("English query 'dogs playing and having fun':")
		for i, r := range resultsEn {
			t.Logf("  %d. [%.4f] %s", i+1, r.SemanticScore, r.TextSnippet[:min(60, len(r.TextSnippet))])
		}
		t.Logf("Spanish query 'perros jugando y divirtiéndose':")
		for i, r := range resultsEs {
			t.Logf("  %d. [%.4f] %s", i+1, r.SemanticScore, r.TextSnippet[:min(60, len(r.TextSnippet))])
		}

		// Both should return dog-related content as top result
		isDogRelatedEn := strings.Contains(strings.ToLower(resultsEn[0].TextSnippet), "dog") ||
			strings.Contains(strings.ToLower(resultsEn[0].TextSnippet), "perro")
		isDogRelatedEs := strings.Contains(strings.ToLower(resultsEs[0].TextSnippet), "dog") ||
			strings.Contains(strings.ToLower(resultsEs[0].TextSnippet), "perro")

		require.True(t, isDogRelatedEn, "English query top result should be about dogs")
		require.True(t, isDogRelatedEs, "Spanish query top result should be about dogs")
	})

	t.Run("Content type filtering works with real embeddings", func(t *testing.T) {
		// Only comments (animals topic)
		results, err := e.SemanticSearch(ctx, "domestic pets", 10, []string{"comment"})
		require.NoError(t, err)

		t.Logf("Query 'domestic pets' filtered to comments only:")
		for i, r := range results {
			t.Logf("  %d. [%.4f] [%s] %s", i+1, r.SemanticScore, r.ContentType, r.TextSnippet[:min(60, len(r.TextSnippet))])
			require.Equal(t, "comment", r.ContentType)
		}
	})

	t.Run("Scores are ordered correctly", func(t *testing.T) {
		results, err := e.SemanticSearch(ctx, "software development", 10, nil)
		require.NoError(t, err)
		require.NotEmpty(t, results)

		// Verify scores are in descending order
		for i := 1; i < len(results); i++ {
			require.GreaterOrEqual(t, results[i-1].SemanticScore, results[i].SemanticScore,
				"Results should be ordered by score descending")
		}

		// All scores should be between 0 and 1
		for _, r := range results {
			require.GreaterOrEqual(t, r.SemanticScore, 0.0)
			require.LessOrEqual(t, r.SemanticScore, 1.0)
		}
	})
}

func TestEmbedder_SemanticSearch(t *testing.T) {
	ctx := t.Context()

	db := storage.MakeTestMemoryDB(t)

	// Insert test data: FTS entries with corresponding embeddings
	require.NoError(t, db.WithTx(ctx, func(conn *sqlite.Conn) error {
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
		results, err := e.SemanticSearch(ctx, "artificial intelligence", 10, nil)
		require.NoError(t, err)
		require.NotEmpty(t, results)

		// Should have called embed for the query
		require.GreaterOrEqual(t, backend.getEmbedCalls(), 1)
	})

	t.Run("search with content type filter", func(t *testing.T) {
		results, err := e.SemanticSearch(ctx, "test query", 10, []string{"document"})
		require.NoError(t, err)

		// All results should be documents
		for _, r := range results {
			require.Equal(t, "document", r.ContentType)
		}
	})

	t.Run("search with title filter", func(t *testing.T) {
		results, err := e.SemanticSearch(ctx, "test query", 10, []string{"title"})
		require.NoError(t, err)

		// All results should be titles
		for _, r := range results {
			require.Equal(t, "title", r.ContentType)
		}
	})

	t.Run("search respects limit", func(t *testing.T) {
		results, err := e.SemanticSearch(ctx, "test", 1, nil)
		require.NoError(t, err)
		require.LessOrEqual(t, len(results), 1)
	})

	t.Run("results have required fields", func(t *testing.T) {
		results, err := e.SemanticSearch(ctx, "machine learning", 10, nil)
		require.NoError(t, err)
		require.NotEmpty(t, results)

		for _, r := range results {
			require.NotZero(t, r.BlobID)
			require.NotEmpty(t, r.BlockID)
			require.NotEmpty(t, r.ContentType)
			require.NotEmpty(t, r.TextSnippet)
			require.Greater(t, r.SemanticScore, 0.0)
			require.LessOrEqual(t, r.SemanticScore, 1.0)
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

		_, err = uninitialized.SemanticSearch(ctx, "test", 10, nil)
		require.Error(t, err)
		require.Contains(t, err.Error(), "model not loaded")
	})

	t.Run("rejects invalid content types", func(t *testing.T) {
		_, err := e.SemanticSearch(ctx, "test", 10, []string{"malicious'; DROP TABLE embeddings; --"})
		require.Error(t, err)
		require.Contains(t, err.Error(), "invalid content type")
	})

	t.Run("rejects unknown content types", func(t *testing.T) {
		_, err := e.SemanticSearch(ctx, "test", 10, []string{"unknown_type"})
		require.Error(t, err)
		require.Contains(t, err.Error(), "invalid content type")
	})
}
