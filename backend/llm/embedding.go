package llm

import (
	"context"
	"errors"
	"fmt"
	"math"
	"strings"
	"sync"
	"time"

	"seed/backend/daemon/taskmanager"
	daemonpb "seed/backend/genproto/daemon/v1alpha"
	"seed/backend/llm/backends"
	"seed/backend/util/dqb"
	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"

	"go.uber.org/zap"
)

const (
	// DefaultIndexPassSize is the default number of FTS rows to keep in memory per pass.
	// After each pass, the embedder sleeps for a short time to avoid starving the CPU.
	// Adjust the sleep duration via WithSleepPerPass.
	DefaultEmbeddingIndexPassSize = 10

	// DefaultSleepBetweenPasses is the default sleep duration after each indexing pass.
	DefaultEmbeddingSleepBetweenPasses = time.Millisecond * 500 // to not starve the CPU.

	// DefaultRunInterval is the default wait time after a run finishes before starting the next one.
	DefaultEmbeddingRunInterval = 1 * time.Minute

	// DefaultEmbeddingModel is the default model name for embeddings.
	DefaultEmbeddingModel = "embeddinggemma"

	taskID              = "embedding_indexer"
	taskDescription     = "Indexing embeddings"
	embeddingColumnDims = 384
	pctOverlap          = 0.1
	minRunInterval      = 5 * time.Second

	kvEmbeddingModelChecksumKey = "embedding_model_checksum"
)

type Embedder struct {
	backend            backends.Backend
	pool               *sqlitex.Pool
	logger             *zap.Logger
	taskMgr            *taskmanager.TaskManager
	model              string
	indexPassSize      int
	interval           time.Duration
	SleepBetweenPasses time.Duration
	forceLoad          bool
	dimensions         int
	contextSize        int
	modelLoaded        bool
	initialized        bool
	documentPrefix     string
	queryPrefix        string
	maxChunkLength     int
	mu                 sync.Mutex
}

// EmbedderOption configures the embedder.
type EmbedderOption func(*Embedder) error

// WithIndexPassSize sets the number of FTS rows to embed per pass. Default is 100.
// It is not the same as the backend batch size. This controls how many rows are
// fetched from the database per run. Also, after each pass, the embedder sleeps
// for a short time to avoid starving the CPU. Set the sleep interval via WithSleepPerPass.
func WithIndexPassSize(size int) EmbedderOption {
	return func(embedder *Embedder) error {
		if size <= 0 {
			return errors.New("embedder pass size must be positive")
		}
		embedder.indexPassSize = size
		return nil
	}
}

// WithSleepPerPass sets the sleep duration after each indexing pass.
// Default is 10ms.
func WithSleepPerPass(duration time.Duration) EmbedderOption {
	return func(embedder *Embedder) error {
		embedder.SleepBetweenPasses = duration
		return nil
	}
}

// WithForceLoad makes LoadModel pull the model when it is missing on the backend.
func WithForceLoad(force bool) EmbedderOption {
	return func(embedder *Embedder) error {
		embedder.forceLoad = force
		return nil
	}
}

// WithInterval sets the default wait time after a run finishes before starting the next one.
func WithInterval(interval time.Duration) EmbedderOption {
	return func(embedder *Embedder) error {
		if interval < minRunInterval {
			return fmt.Errorf("embedder interval must be at least %s", minRunInterval)
		}
		embedder.interval = interval
		return nil
	}
}

// WithModel sets the model name used by the embedder.
func WithModel(model string) EmbedderOption {
	return func(embedder *Embedder) error {
		trimmed := strings.TrimSpace(model)
		if trimmed == "" {
			return errors.New("embedder model name is required")
		}
		embedder.model = trimmed
		return nil
	}
}

// WithDocumentPrefix sets the prefix to add to document texts before embedding.
func WithDocumentPrefix(prefix string) EmbedderOption {
	return func(embedder *Embedder) error {
		embedder.documentPrefix = prefix
		return nil
	}
}

// WithQueryPrefix sets the prefix to add to query texts before semantic searching.
func WithQueryPrefix(prefix string) EmbedderOption {
	return func(embedder *Embedder) error {
		embedder.queryPrefix = prefix
		return nil
	}
}

// NewEmbedder creates an embedder.
func NewEmbedder(
	pool *sqlitex.Pool,
	backend backends.Backend,
	logger *zap.Logger,
	taskMgr *taskmanager.TaskManager,
	opts ...EmbedderOption,
) (*Embedder, error) {
	if pool == nil {
		return nil, errors.New("embedder pool is required")
	}
	if backend == nil {
		return nil, errors.New("embedder backend is required")
	}
	if logger == nil {
		return nil, errors.New("embedder logger is required")
	}
	if taskMgr == nil {
		return nil, errors.New("embedder task manager is required")
	}

	embedder := &Embedder{
		backend:            backend,
		pool:               pool,
		logger:             logger,
		taskMgr:            taskMgr,
		indexPassSize:      DefaultEmbeddingIndexPassSize,
		SleepBetweenPasses: DefaultEmbeddingSleepBetweenPasses,
		interval:           DefaultEmbeddingRunInterval,
	}

	for _, opt := range opts {
		if err := opt(embedder); err != nil {
			return nil, err
		}
	}

	if strings.TrimSpace(embedder.model) == "" {
		return nil, errors.New("embedder model name is required")
	}

	return embedder, nil
}

// Init starts the indexing loop using the provided interval in the constructor.
// It runs through the database getting textx, chunk them, and generating embeddings.
// Calling Init multiple times has no effect.
// If the user just wants to embed textx on demand (For semantic search), it can call
// EmbedText directly.
func (e *Embedder) Init(ctx context.Context) {
	e.mu.Lock()
	if e.initialized {
		e.mu.Unlock()
		return
	}
	e.mu.Unlock()
	if err := e.ensureModel(ctx); err != nil {
		e.logger.Warn("Could not ensure LLM model", zap.Error(err))
		return
	}
	e.mu.Lock()
	e.initialized = true
	e.mu.Unlock()

	// Start the indexing loop only once
	go func() {
		for {
			if err := e.runOnce(ctx); err != nil && !errors.Is(err, context.Canceled) {
				e.logger.Warn("embedding indexing failed", zap.Error(err))
			}

			if e.interval <= 0 {
				e.logger.Info("embedding indexing completed, not restarting due to non-positive interval")
				return
			}

			select {
			case <-ctx.Done():
				e.logger.Info("embedding indexing stopped", zap.Error(ctx.Err()))
				return
			case <-time.After(e.interval):
			}
		}
	}()
}

// SemanticSearchResult represents a single result from semantic search.
type SemanticSearchResult struct {
	IRI           string
	BlobID        int64
	BlockID       string
	ContentType   string
	TextSnippet   string
	Version       string
	SemanticScore float64
	Timestamp     int64
	MainAuthor    []byte
}

// Allowed content types for semantic search (prevents SQL injection).
var allowedContentTypes = map[string]bool{
	"title":    true,
	"document": true,
	"comment":  true,
}

// SemanticSearch performs semantic search using sqlite-vec cosine similarity.
// contentTypes filters by FTS content types (e.g., "title", "document", "comment").
// If empty, defaults to ["title", "document", "comment"].
func (e *Embedder) SemanticSearch(ctx context.Context, query string, limit int, contentTypes []string) ([]SemanticSearchResult, error) {
	if limit <= 0 {
		limit = 20
	}
	if len(contentTypes) == 0 {
		contentTypes = []string{"title", "document", "comment"}
	}

	// Validate content types to prevent injection
	for _, ct := range contentTypes {
		if !allowedContentTypes[ct] {
			return nil, fmt.Errorf("invalid content type: %q (allowed: title, document, comment)", ct)
		}
	}

	e.mu.Lock()
	if !e.modelLoaded {
		e.mu.Unlock()
		return nil, fmt.Errorf("embedder model not loaded")
	}
	e.mu.Unlock()

	// Embed query with optional prefix
	queryText := query
	if e.queryPrefix != "" {
		queryText = e.queryPrefix + query
	}

	embeddings, err := e.backend.Embed(ctx, []string{queryText})
	if err != nil {
		return nil, fmt.Errorf("failed to embed query: %w", err)
	}
	if len(embeddings) != 1 {
		return nil, fmt.Errorf("embedding count mismatch: got %d want 1", len(embeddings))
	}
	if len(embeddings[0]) != e.dimensions {
		return nil, fmt.Errorf("embedding dimension mismatch: got %d want %d", len(embeddings[0]), e.dimensions)
	}

	queryEmbedding := quantizeEmbedding(embeddings[0])

	conn, release, err := e.pool.Conn(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to get database connection: %w", err)
	}
	defer release()

	// Build dynamic SQL with content type placeholders
	// Content types are validated above so this is safe
	placeholders := make([]string, len(contentTypes))
	for i := range contentTypes {
		placeholders[i] = "?"
	}

	sql := fmt.Sprintf(`
		SELECT
			v.rowid,
			v.distance,
			fi.blob_id,
			fi.block_id,
			fi.type AS content_type,
			fi.version,
			fi.ts,
			f.raw_content,
			COALESCE(r1.iri, r2.iri) as iri,
			pk.principal
		FROM embeddings v
		JOIN fts_index fi ON fi.rowid = v.fts_id
		JOIN fts f ON f.rowid = v.fts_id
		LEFT JOIN structural_blobs sb ON sb.id = fi.blob_id
		LEFT JOIN resources r1 ON r1.id = sb.resource
		LEFT JOIN blob_links bl ON bl.target = fi.blob_id AND bl.type = 'ref/head'
		LEFT JOIN structural_blobs sb_ref ON sb_ref.id = bl.source
		LEFT JOIN resources r2 ON r2.id = sb_ref.resource
		LEFT JOIN public_keys pk ON pk.id = sb.author
		WHERE v.multilingual_minilm_l12_v2 MATCH vec_int8(?)
		  AND k = ?
		  AND fi.type IN (%s)
		ORDER BY v.distance
	`, strings.Join(placeholders, ","))

	// Build args: embedding, limit, then content types
	args := make([]any, 0, 2+len(contentTypes))
	args = append(args, queryEmbedding, limit)
	for _, ct := range contentTypes {
		args = append(args, ct)
	}

	var results []SemanticSearchResult
	if err := sqlitex.Exec(conn, sql, func(stmt *sqlite.Stmt) error {
		distance := stmt.ColumnFloat(1)
		similarity := max(0, 1-distance)

		rawContent := stmt.ColumnText(7)
		snippet := rawContent
		if len(snippet) > 300 {
			snippet = snippet[:300]
		}

		results = append(results, SemanticSearchResult{
			IRI:           stmt.ColumnText(8),
			BlobID:        stmt.ColumnInt64(2),
			BlockID:       stmt.ColumnText(3),
			ContentType:   stmt.ColumnText(4),
			TextSnippet:   snippet,
			Version:       stmt.ColumnText(5),
			SemanticScore: similarity,
			Timestamp:     stmt.ColumnInt64(6),
			MainAuthor:    stmt.ColumnBytesUnsafe(9),
		})
		return nil
	}, args...); err != nil {
		return nil, fmt.Errorf("semantic search query failed: %w", err)
	}

	return results, nil
}
func (e *Embedder) embedText(ctx context.Context, text string) ([]int8, error) {
	e.mu.Lock()
	if !e.initialized {
		e.mu.Unlock()
		return nil, fmt.Errorf("embedder not initialized")
	}
	e.mu.Unlock()
	if len(text) > e.maxChunkLength {
		return nil, fmt.Errorf("input text length %d exceeds maximum chunk length %d", len([]rune(text)), e.maxChunkLength)
	}

	embeddings, err := e.backend.Embed(ctx, []string{text})
	if err != nil {
		return nil, err
	}
	if len(embeddings) != 1 {
		return nil, fmt.Errorf("embedding count mismatch: got %d want 1", len(embeddings))
	}
	if len(embeddings[0]) != e.dimensions {
		return nil, fmt.Errorf("embedding dimension mismatch: got %d want %d", len(embeddings[0]), e.dimensions)
	}
	return quantizeEmbedding(embeddings[0]), nil
}

func (e *Embedder) runOnce(ctx context.Context) error {
	/*
		e.logger.Info("starting embedding indexing run")
		startTime := time.Now()
		defer func() {
			e.logger.Info("embedding indexing run completed", zap.Duration("Elapsed time in seconds", time.Since(startTime)))
		}()
	*/

	conn, release, err := e.pool.Conn(ctx)
	if err != nil {
		return err
	}

	totalPending, err := countPending(conn)
	if err != nil {
		release()
		return err
	}
	release()
	if e.taskMgr.GlobalState() != daemonpb.State_ACTIVE {
		return fmt.Errorf("daemon must be fully active to run embedding indexing. Current state: %s", e.taskMgr.GlobalState().String())
	}
	if _, err := e.taskMgr.AddTask(taskID, daemonpb.TaskName_EMBEDDING, taskDescription, totalPending); err != nil {
		if errors.Is(err, taskmanager.ErrTaskExists) {
			return fmt.Errorf("another embedding indexing task is already running")
		} else {
			return err
		}
	}
	defer func() {
		if _, err := e.taskMgr.DeleteTask(taskID); err != nil && !errors.Is(err, taskmanager.ErrTaskMissing) {
			e.logger.Warn("failed to delete embedding task", zap.Error(err))
		}
	}()
	var processed int64
	for {
		conn, release, err := e.pool.Conn(ctx)
		if err != nil {
			return err
		}
		textsToEmbed, err := fetchPending(conn, e.indexPassSize)
		if err != nil {
			release()
			return err
		}
		release()
		if len(textsToEmbed) == 0 {
			break
		}
		processed += int64(len(textsToEmbed))
		embeddings, err := e.embedTexts(ctx, textsToEmbed, pctOverlap)
		if err != nil {
			return err
		}

		conn, release, err = e.pool.Conn(ctx)
		if err != nil {
			return err
		}
		if err := sqlitex.WithTx(conn, func() error {
			for _, embedding := range embeddings {
				if len(embedding.embeddingQuantized) != e.dimensions {
					return fmt.Errorf("embedding dimension mismatch: got %d want %d", len(embedding.embeddingQuantized), e.dimensions)
				}
				if err := sqlitex.Exec(conn, qEmbeddingsInsert(), nil, embedding.embeddingQuantized, embedding.ftsID); err != nil {
					return err
				}
			}
			return nil
		}); err != nil {
			release()
			return err
		}
		release()

		_, _ = e.taskMgr.UpdateProgress(taskID, totalPending, processed)
		time.Sleep(e.SleepBetweenPasses)
	}

	return nil
}

func (e *Embedder) ensureModel(ctx context.Context) error {
	e.mu.Lock()
	if e.modelLoaded {
		e.mu.Unlock()
		return nil
	}
	e.mu.Unlock()

	info, err := e.backend.LoadModel(ctx, e.model, e.forceLoad, e.taskMgr)
	if err != nil {
		return err
	}
	if info.Dimensions != embeddingColumnDims {
		return fmt.Errorf("embedding dimensions mismatch: got %d want %d", info.Dimensions, embeddingColumnDims)
	}
	if info.ContextSize <= 0 {
		return fmt.Errorf("embedding context size invalid: %d", info.ContextSize)
	}
	if info.Checksum == "" {
		return fmt.Errorf("embedding model checksum is empty")
	}
	checksum, err := sqlitex.GetKV(ctx, e.pool, kvEmbeddingModelChecksumKey)
	if err != nil || checksum == "" || checksum != info.Checksum {
		conn, release, err := e.pool.Conn(ctx)
		if err != nil {
			return fmt.Errorf("could not get database connection to store embedding model checksum: %v", err)
		}
		defer release()
		var tables []string
		if err := sqlitex.Exec(conn, "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'embeddings%'", func(stmt *sqlite.Stmt) error {
			tables = append(tables, stmt.ColumnText(0))
			return nil
		}); err != nil {
			return err
		}
		if err := sqlitex.WithTx(conn, func() error {
			if err := sqlitex.Exec(conn, "delete from embeddings;", nil); err != nil {
				return err
			}
			return nil
		}); err != nil {
			return fmt.Errorf("Could not delete old embeddings: %v", err)
		}
		/*

			// delete from each table
			for _, table := range tables {
				if err := sqlitex.Exec(conn, fmt.Sprintf("DELETE FROM %s", table), nil); err != nil {
					return fmt.Errorf("could not delete from table %s: %v", table, err)
				}
			}
		*/
		if err := sqlitex.SetKV(ctx, conn, kvEmbeddingModelChecksumKey, info.Checksum, true); err != nil {
			return fmt.Errorf("could not store embedding model checksum: %v", err)
		}

	}
	e.mu.Lock()
	e.dimensions = info.Dimensions
	e.contextSize = info.ContextSize
	e.modelLoaded = true
	chunkLen := int(math.Floor(float64(e.contextSize) * 0.9))
	if chunkLen < 1 {
		e.maxChunkLength = e.contextSize
	} else {
		e.maxChunkLength = chunkLen
	}

	e.mu.Unlock()

	return nil
}

type embeddingInput struct {
	ftsID int64
	text  string
}

type embeddingOutput struct {
	ftsID              int64
	embedding          []float32
	embeddingQuantized []int8
}

func (e *Embedder) embedTexts(ctx context.Context, inputs []embeddingInput, pctOverlap float32) ([]embeddingOutput, error) {
	chunkedInputs := []embeddingInput{}
	chunkedTexts := []string{}
	for _, input := range inputs {
		chunks := chunkText(input.text, e.maxChunkLength, pctOverlap)
		for _, chunk := range chunks {
			chunkedTexts = append(chunkedTexts, chunk)
			chunkedInputs = append(chunkedInputs, embeddingInput{
				ftsID: input.ftsID,
				text:  chunk,
			})
		}
	}

	response, err := e.backend.Embed(ctx, chunkedTexts)
	if err != nil {
		return nil, err
	}
	if len(response) != len(chunkedInputs) {
		return nil, fmt.Errorf("embedding count mismatch: got %d want %d", len(response), len(chunkedInputs))
	}
	outputs := make([]embeddingOutput, len(chunkedInputs))
	for i, embedding := range response {
		if len(embedding) != e.dimensions {
			return nil, fmt.Errorf("embedding dimension mismatch: got %d want %d", len(embedding), e.dimensions)
		}
		outputs[i] = embeddingOutput{
			ftsID:              chunkedInputs[i].ftsID,
			embedding:          embedding,
			embeddingQuantized: quantizeEmbedding(embedding),
		}
	}
	return outputs, nil
}

func countPending(conn *sqlite.Conn) (int64, error) {
	var total int64
	if err := sqlitex.Exec(conn, qEmbeddingsPendingCount(), func(stmt *sqlite.Stmt) error {
		total = stmt.ColumnInt64(0)
		return nil
	}); err != nil {
		return 0, err
	}

	return total, nil
}

func fetchPending(conn *sqlite.Conn, limit int) ([]embeddingInput, error) {
	rows := make([]embeddingInput, 0, limit)

	if err := sqlitex.Exec(conn, qEmbeddingsPending(), func(stmt *sqlite.Stmt) error {
		rows = append(rows, embeddingInput{
			ftsID: stmt.ColumnInt64(0),
			text:  stmt.ColumnText(1),
		})
		return nil
	}, limit); err != nil {
		return nil, err
	}

	return rows, nil
}

func chunkText(text string, maxLen int, overlappingPct float32) []string {
	if maxLen <= 0 {
		return []string{text}
	}
	if overlappingPct < 0 {
		overlappingPct = 0
	}
	if overlappingPct > 1 {
		overlappingPct = 1
	}

	overlap := int(math.Round(float64(overlappingPct) * float64(maxLen)))
	if overlap >= maxLen {
		overlap = maxLen - 1
	}
	step := maxLen - overlap
	if step <= 0 {
		step = 1
	}

	runes := []rune(text)
	if len(runes) <= maxLen {
		return []string{text}
	}

	chunks := make([]string, 0, (len(runes)/step)+1)
	for start := 0; start < len(runes); start += step {
		end := start + maxLen
		if end > len(runes) {
			end = len(runes)
		}
		chunks = append(chunks, string(runes[start:end]))
	}

	return chunks
}
func quantizeEmbedding(input []float32) []int8 {
	// Find max absolute value
	var maxAbs float32
	for _, v := range input {
		abs := v
		if abs < 0 {
			abs = -abs
		}
		if abs > maxAbs {
			maxAbs = abs
		}
	}

	// Quantize with scaling factor
	quantized := make([]int8, len(input))
	scale := float32(127.0)
	if maxAbs > 0 {
		scale = 127.0 / maxAbs
	}

	for i, v := range input {
		scaled := v * scale
		scaled = float32(math.Round(float64(scaled)))
		if scaled > 127 {
			quantized[i] = 127
		} else if scaled < -128 {
			quantized[i] = -128
		} else {
			quantized[i] = int8(scaled)
		}
	}
	return quantized

}

var qEmbeddingsPending = dqb.Str(`
	WITH pending AS (
		SELECT rowid
		FROM fts
		WHERE type IN ('title', 'document', 'comment')
			AND length(raw_content) > 3
		EXCEPT
		SELECT fts_id FROM embeddings
	)
	SELECT fts.rowid, fts.raw_content
	FROM fts
	JOIN pending ON pending.rowid = fts.rowid
	LIMIT ?;
`)

var qEmbeddingsPendingCount = dqb.Str(`
	WITH pending AS (
		SELECT rowid
		FROM fts
		WHERE type IN ('title', 'document', 'comment')
			AND length(raw_content) > 3
		EXCEPT
		SELECT fts_id FROM embeddings
	)
	SELECT COUNT(*) FROM pending;
`)

var qEmbeddingsInsert = dqb.Str(`
	INSERT INTO embeddings (multilingual_minilm_l12_v2, fts_id)
	VALUES (vec_int8(?), ?);
`)
