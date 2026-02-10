// Package llm provides embedding generation and semantic search.
package llm

import (
	"context"
	"errors"
	"fmt"
	"math"
	"slices"
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
	// DefaultEmbeddingIndexPassSize is the default number of FTS rows to keep in memory per pass.
	// After each pass, the embedder sleeps for a short time to avoid starving the CPU.
	// Adjust the sleep duration via WithSleepPerPass.
	DefaultEmbeddingIndexPassSize = 10

	// DefaultEmbeddingSleepBetweenPasses is the default sleep duration after each indexing pass.
	DefaultEmbeddingSleepBetweenPasses = time.Millisecond * 500 // to not starve the CPU.

	// DefaultEmbeddingRunInterval is the default wait time after a run finishes before starting the next one.
	DefaultEmbeddingRunInterval = 1 * time.Minute

	// DefaultEmbeddingModel is the default model name for embeddings.
	DefaultEmbeddingModel = "embeddinggemma"

	taskID              = "embedding_indexer"
	taskDescription     = "Indexing embeddings"
	embeddingColumnDims = 384
	pctOverlap          = 0.1
	minRunInterval      = 5 * time.Second

	kvEmbeddingModelChecksumKey = "embedding_model_checksum"

	// unreliableEmbeddingThreshold is the cosine similarity threshold above which a query
	// embedding is considered unreliable (too similar to gibberish).
	// The granite-embedding-107m-multilingual model produces higher base similarities across
	// all queries (~0.55-0.70), so 0.85 catches only true nonsense strings.
	unreliableEmbeddingThreshold = 0.85
)

// ErrUnreliableEmbedding is returned when the query embedding is detected as unreliable.
// This happens when rare/unknown single words produce embeddings highly similar to gibberish,
// making semantic search results meaningless. Callers should fall back to keyword search.
var ErrUnreliableEmbedding = errors.New("query embedding is unreliable for semantic search")

// gibberishEmbedding is a precomputed quantized embedding for the nonsense string "asdadadsasda"
// using the granite-embedding-107m-multilingual model. This embedding is used to detect queries
// that produce unreliable embeddings (too similar to gibberish). When detected, semantic search
// results should be skipped in favor of keyword search.
// WARNING: This embedding is model-specific and MUST be recomputed if the embedding model changes.
var gibberishEmbedding = []int8{
	23, -5, 15, 26, 11, 4, 16, 20, 31, -11, -23, 15, 10, 17, 5, -2,
	-2, 7, 37, -11, -2, -4, 35, 45, -67, 19, 1, 17, 18, 5, -1, 24,
	18, -47, -16, 33, 44, 22, 10, 12, 2, 32, 22, 16, -8, 9, 9, 12,
	8, -48, -1, 11, 2, 0, -10, 21, 2, 22, -2, -7, 4, 22, 17, 61,
	8, -41, -2, 1, 22, -15, 24, 1, 15, 19, 6, 51, -5, 15, 16, 34,
	6, -8, 0, 9, 45, 64, 13, 3, 31, 15, 27, -40, 1, 7, -3, 1,
	-104, 19, 5, 15, 4, 4, 7, 24, 12, 8, 48, 25, 16, 11, 50, -11,
	25, -8, -3, 32, 12, 36, 11, -22, 20, 15, 2, 28, -6, 6, -2, 36,
	-11, 10, -9, 18, 26, -5, 8, -15, 27, -2, -127, -20, 1, 12, 31, 28,
	-42, 36, 17, 30, 12, -19, 22, 19, 12, 9, 19, -1, 39, 16, 10, 10,
	-7, 1, 10, 8, 9, -11, 7, 50, -7, 12, 0, 21, 7, 13, 2, 38,
	3, 13, 33, 31, -25, 1, 18, -21, -39, 16, -28, -57, 28, 31, 7, 41,
	11, 30, 2, 3, 26, 82, 10, 4, 1, 2, 7, 5, 5, 24, 31, 20,
	2, 11, 18, 15, 1, 0, -3, 4, 8, 9, 33, -16, 19, 13, 24, 11,
	30, 9, 7, -15, 23, -27, 7, 23, 6, -12, -2, -67, 20, 29, 4, 23,
	15, -11, 18, 10, 15, -2, 22, 10, 15, 21, 29, -3, 28, -30, 12, 54,
	34, -4, 20, -1, 9, 7, 6, 40, 33, -4, 39, 6, -5, 0, 5, -4,
	-3, 35, 22, 4, 64, 19, -6, 33, 12, -23, 14, 3, 22, 15, -3, 14,
	32, -26, -12, -2, 3, 22, 28, 16, 31, 17, 26, 18, 23, -9, 20, 42,
	123, 25, -2, 2, 31, -13, -5, 0, 6, 2, 32, 8, -43, 10, 20, 24,
	8, 37, 30, -1, -16, 16, -28, 11, 18, 6, -1, -18, -31, 27, -27, 26,
	-22, 35, -15, 22, 26, 13, 4, 12, 12, 31, -60, 14, 13, 20, -3, 17,
	39, -81, 12, 13, 2, -31, 37, 22, -48, -6, 23, 8, 15, -5, 20, -16,
	-3, 4, 52, -54, 19, 2, -11, 37, -8, 3, 26, 25, 10, 14, -41, 33,
}

// LightEmbedder defines a minimal interface for semantic search.
// Returns the top limit results matching the query.
// Threshold is the minimum similarity score (0.0 to 1.0) to include in results.
type LightEmbedder interface {
	SemanticSearch(ctx context.Context, query string, limit int, contentTypes map[string]bool, iriGlob string, threshold float32) (SearchResultMap, error)
}

// Embedder handles embedding generation and indexing.
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

// SearchResultMap represents a minimal search result from semantic or keyword search.
// The key is the rowID of the FTS entry, and the value is the score.
// In the case of semantic search, the score is the similarity (0.0 to 1.0).
// The higher the score, the more relevant.
// In the case of keyword search, the score is the FTS rank. Usually the more
// negative, the more relevant.
type SearchResultMap map[int64]float32

// SearchResult is a single search result with a row ID and score.
type SearchResult struct {
	// RowID is the FTS row ID.
	RowID int64
	// Score is the relevance score. Depending on the search type, higher or lower is better.
	Score float32
}

// Keys returns a sorted list of rowIDs in the SearchResultMap for deterministic ordering.
func (sr SearchResultMap) Keys() []int64 {
	keys := make([]int64, 0, len(sr))
	for k := range sr {
		keys = append(keys, k)
	}
	slices.Sort(keys)
	return keys
}

// Values returns an unordered list of scores in the SearchResultMap.
func (sr SearchResultMap) Values() []float32 {
	values := []float32{}
	for _, score := range sr {
		values = append(values, score)
	}
	return values
}

// Max returns the fts rowID if the maximum score found in the result set.
func (sr SearchResultMap) Max() SearchResult {
	var maxScore float32
	first := true
	var maxID int64
	for id, score := range sr {
		if first || score > maxScore {
			maxScore = score
			maxID = id
			first = false
		}
	}
	return SearchResult{RowID: maxID, Score: maxScore}
}

// Min returns the fts rowID of the minimum score found in the result set.
func (sr SearchResultMap) Min() SearchResult {
	var minScore float32
	first := true
	var minID int64
	for id, score := range sr {
		if first || score < minScore {
			minScore = score
			minID = id
			first = false
		}
	}
	return SearchResult{RowID: minID, Score: minScore}
}

// ToList converts the SearchResultMap to a sorted list of SearchResult.
// If desc is true, the list is sorted in descending order of Score.
// Uses RowID as tie-breaker for deterministic ordering when scores are equal.
func (sr SearchResultMap) ToList(desc bool) SearchResultList {
	results := make([]SearchResult, 0, len(sr))
	for id, score := range sr {
		results = append(results, SearchResult{RowID: id, Score: score})
	}
	slices.SortFunc(results, func(a, b SearchResult) int {
		if desc {
			switch {
			case a.Score > b.Score:
				return -1
			case a.Score < b.Score:
				return 1
			default:
				// Tie-breaker: sort by RowID for deterministic ordering.
				switch {
				case a.RowID < b.RowID:
					return -1
				case a.RowID > b.RowID:
					return 1
				default:
					return 0
				}
			}
		}
		switch {
		case a.Score < b.Score:
			return -1
		case a.Score > b.Score:
			return 1
		default:
			// Tie-breaker: sort by RowID for deterministic ordering.
			switch {
			case a.RowID < b.RowID:
				return -1
			case a.RowID > b.RowID:
				return 1
			default:
				return 0
			}
		}
	})
	return results
}

// SearchResultList is an ordered list of SearchResult.
type SearchResultList []SearchResult

// ToMap converts the SearchResultList to a SearchResultMap.
func (srList SearchResultList) ToMap() SearchResultMap {
	resultMap := make(SearchResultMap)
	for _, sr := range srList {
		resultMap[sr.RowID] = sr.Score
	}
	return resultMap
}

// SemanticSearch performs semantic search using sqlite-vec cosine similarity.
// contentTypes filters by FTS content types (e.g., "title", "document", "comment").
// If empty, defaults to ["title", "document", "comment"].
// iriGlob filters results by IRI pattern. If empty, defaults to "*" (all).
// Threshold filters results by minimum similarity score (0.0 to 1.0). Default is 0.0 (no filtering).
func (e *Embedder) SemanticSearch(ctx context.Context, query string, limit int, contentTypes map[string]bool, iriGlob string, threshold float32) (SearchResultMap, error) {
	if limit <= 0 {
		limit = 20
	}

	if iriGlob == "" {
		iriGlob = "*"
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
	embedding, err := e.backend.RetrieveSingle(ctx, queryText)
	if err != nil {
		return nil, fmt.Errorf("failed to embed query: %w", err)
	}
	if len(embedding) != e.dimensions {
		return nil, fmt.Errorf("embedding dimension mismatch: got %d want %d", len(embedding), e.dimensions)
	}
	queryEmbedding := quantizeEmbedding(embedding)

	// Detect unreliable embeddings by checking similarity to gibberish.
	// Rare/unknown single words produce degenerate embeddings that are highly similar to nonsense.
	if sim := cosineSimilarityInt8(queryEmbedding, gibberishEmbedding); sim > unreliableEmbeddingThreshold {
		return nil, ErrUnreliableEmbedding
	}

	var entityTypeTitle, entityTypeContact, entityTypeDoc, entityTypeComment interface{}
	supportedType := false
	if ok, val := contentTypes["title"]; ok && val {
		entityTypeTitle = "title"
		supportedType = true
	}
	if ok, val := contentTypes["contact"]; ok && val {
		entityTypeContact = "contact"
		supportedType = true
	}
	if ok, val := contentTypes["document"]; ok && val {
		entityTypeDoc = "document"
		supportedType = true
	}
	if ok, val := contentTypes["comment"]; ok && val {
		entityTypeComment = "comment"
		supportedType = true
	}
	if !supportedType {
		return nil, fmt.Errorf("invalid content type filter: at least one of title, contact, document, comment must be specified")
	}
	conn, release, err := e.pool.Conn(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to get database connection: %w", err)
	}
	defer release()
	// Convert threshold from similarity to distance
	if threshold <= 0 {
		threshold = -0.1 // there could be distances slightly above 1.0 due to quantization errors
	}
	maxDistance := 1 - float64(threshold)
	ret := make(map[int64]float32)

	// Determine if we need IRI pre-filtering.
	// Generic patterns like "*" or "hm://*" don't need filtering.
	needsIriFilter := iriGlob != "*" && iriGlob != "hm://*"

	resultHandler := func(stmt *sqlite.Stmt) error {
		distance := stmt.ColumnFloat(1)
		similarity := max(0, 1-distance)
		ret[stmt.ColumnInt64(0)] = float32(similarity)
		return nil
	}

	if needsIriFilter {
		// Use pre-filtered query with fts_id IN (subquery).
		// The subquery parameters are duplicated for both UNION branches.
		if err := sqlitex.Exec(conn, qEmbeddingsSearchFiltered(), resultHandler,
			queryEmbedding, maxDistance, limit,
			entityTypeTitle, entityTypeContact, entityTypeDoc, entityTypeComment, iriGlob,
			entityTypeTitle, entityTypeContact, entityTypeDoc, entityTypeComment, iriGlob,
		); err != nil {
			return nil, fmt.Errorf("semantic search query failed: %w", err)
		}
	} else {
		// Use unfiltered query for generic IRI patterns.
		if err := sqlitex.Exec(conn, qEmbeddingsSearchUnfiltered(), resultHandler,
			queryEmbedding, maxDistance, limit,
			entityTypeTitle, entityTypeContact, entityTypeDoc, entityTypeComment,
		); err != nil {
			return nil, fmt.Errorf("semantic search query failed: %w", err)
		}
	}

	return ret, nil
}

func (e *Embedder) runOnce(ctx context.Context) error {
	conn, release, err := e.pool.Conn(ctx)
	if err != nil {
		return err
	}

	totalEmbeddable, err := countTotalEmbeddable(conn)
	if err != nil {
		release()
		return err
	}

	alreadyEmbedded, err := countAlreadyEmbedded(conn)
	if err != nil {
		release()
		return err
	}
	release()

	if e.taskMgr.GlobalState() != daemonpb.State_ACTIVE {
		return fmt.Errorf("daemon must be fully active to run embedding indexing. Current state: %s", e.taskMgr.GlobalState().String())
	}
	if _, err := e.taskMgr.AddTask(taskID, daemonpb.TaskName_EMBEDDING, taskDescription, totalEmbeddable); err != nil {
		if errors.Is(err, taskmanager.ErrTaskExists) {
			return fmt.Errorf("another embedding indexing task is already running")
		}
		return err
	}
	defer func() {
		if _, err := e.taskMgr.DeleteTask(taskID); err != nil && !errors.Is(err, taskmanager.ErrTaskMissing) {
			e.logger.Warn("failed to delete embedding task", zap.Error(err))
		}
	}()

	processed := alreadyEmbedded
	_, _ = e.taskMgr.UpdateProgress(taskID, totalEmbeddable, processed)
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

		_, _ = e.taskMgr.UpdateProgress(taskID, totalEmbeddable, processed)
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
			return fmt.Errorf("could not get database connection to store embedding model checksum: %w", err)
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
			return fmt.Errorf("could not delete old embeddings: %w", err)
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
			return fmt.Errorf("could not store embedding model checksum: %w", err)
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

func countTotalEmbeddable(conn *sqlite.Conn) (int64, error) {
	var total int64
	if err := sqlitex.Exec(conn, qEmbeddableTotalCount(), func(stmt *sqlite.Stmt) error {
		total = stmt.ColumnInt64(0)
		return nil
	}); err != nil {
		return 0, err
	}
	return total, nil
}

func countAlreadyEmbedded(conn *sqlite.Conn) (int64, error) {
	var count int64
	if err := sqlitex.Exec(conn, qAlreadyEmbeddedCount(), func(stmt *sqlite.Stmt) error {
		count = stmt.ColumnInt64(0)
		return nil
	}); err != nil {
		return 0, err
	}
	return count, nil
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

// cosineSimilarityInt8 computes cosine similarity between two int8 vectors.
// Returns a value in [-1, 1], with 1 being identical direction.
func cosineSimilarityInt8(a, b []int8) float32 {
	if len(a) != len(b) || len(a) == 0 {
		return 0
	}
	var dot, normA, normB int64
	for i := range a {
		ai, bi := int64(a[i]), int64(b[i])
		dot += ai * bi
		normA += ai * ai
		normB += bi * bi
	}
	if normA == 0 || normB == 0 {
		return 0
	}
	return float32(float64(dot) / (math.Sqrt(float64(normA)) * math.Sqrt(float64(normB))))
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

var qEmbeddableTotalCount = dqb.Str(`
	SELECT COUNT(*) FROM fts
	WHERE type IN ('title', 'document', 'comment')
		AND length(raw_content) > 3;
`)

var qAlreadyEmbeddedCount = dqb.Str(`
	SELECT COUNT(DISTINCT fts_id) FROM embeddings;
`)

var qEmbeddingsInsert = dqb.Str(`
	INSERT INTO embeddings (multilingual_minilm_l12_v2, fts_id)
	VALUES (vec_int8(?), ?);
`)

// qEmbeddingsSearchUnfiltered searches embeddings without IRI filtering.
// Used when iriGlob is generic (e.g., "*" or "hm://*").
var qEmbeddingsSearchUnfiltered = dqb.Str(`
SELECT
	v.fts_id,
	v.distance
FROM embeddings v
JOIN fts_index fi ON fi.rowid = v.fts_id
WHERE v.multilingual_minilm_l12_v2 MATCH vec_int8(?)
  AND v.distance < ?
  AND k = ?
  AND fi.type IN (?, ?, ?, ?)
ORDER BY v.distance
`)

// qEmbeddingsSearchFiltered searches embeddings with IRI pre-filtering.
// Uses fts_id IN (subquery) to leverage sqlite-vec's metadata pre-filtering,
// which filters vectors BEFORE distance calculation for better performance.
// The subquery finds fts entries matching the IRI pattern via two paths:
// 1. Direct: fts_index -> structural_blobs -> resources (for documents/titles)
// 2. Indirect: fts_index -> blob_links -> structural_blobs -> resources (for comments).
var qEmbeddingsSearchFiltered = dqb.Str(`
SELECT
	v.fts_id,
	v.distance
FROM embeddings v
WHERE v.multilingual_minilm_l12_v2 MATCH vec_int8(?)
  AND v.distance < ?
  AND k = ?
  AND v.fts_id IN (
    SELECT fi.rowid FROM fts_index fi
    JOIN structural_blobs sb ON sb.id = fi.blob_id
    JOIN resources r ON r.id = sb.resource
    WHERE fi.type IN (?, ?, ?, ?)
      AND r.iri GLOB ?
    UNION
    SELECT fi.rowid FROM fts_index fi
    JOIN blob_links bl ON bl.target = fi.blob_id AND bl.type = 'ref/head'
    JOIN structural_blobs sb ON sb.id = bl.source
    JOIN resources r ON r.id = sb.resource
    WHERE fi.type IN (?, ?, ?, ?)
      AND r.iri GLOB ?
  )
ORDER BY v.distance
`)
