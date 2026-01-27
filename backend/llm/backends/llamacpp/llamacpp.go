package llamacpp

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"math"
	"net/url"
	"os"
	"runtime"
	"seed/backend/daemon/taskmanager"
	daemonpb "seed/backend/genproto/daemon/v1alpha"
	"seed/backend/llm/backends"
	"strings"
	"sync"
	"time"

	llama "github.com/seed-hypermedia/llama-go"
)

type LlamaCppClient struct {
	model            *llama.Model
	embeddingContext *llama.Context // For generating embeddings
	muEmbed          sync.Mutex     // protects embeddingContext from concurrent access
	retrievalContext *llama.Context // For retrieving similar embeddings
	muRetrieval      sync.Mutex     // protects retrievalContext from concurrent access
	cfg              backends.ClientCfg
}

type LlamaCppOption func(*LlamaCppClient) error

const (
	defaultBatchSize    = 10
	maxParallelContexts = 16
	taskID              = "llamacpp-load-model-task"
	taskDescription     = "Loading LlamaCpp model"
)

// NewLlamaCppClient creates a new LlamaCpp client bound to the provided base URL.
func NewLlamaCppClient(fileURL url.URL, opts ...LlamaCppOption) (*LlamaCppClient, error) {
	if fileURL.Scheme != "file" {
		return nil, fmt.Errorf("llamacpp file URL scheme must be file:///path/to-model, got schema: %s", fileURL.Scheme)
	}
	client := &LlamaCppClient{cfg: backends.ClientCfg{BatchSize: defaultBatchSize, URL: fileURL}}

	for _, opt := range opts {
		if err := opt(client); err != nil {
			return nil, err
		}
	}

	if client.cfg.BatchSize <= 0 {
		return nil, errors.New("llamacpp batch size must be positive")
	}

	return client, nil
}

// WithBatchSize sets the batch size for embedding requests.
func WithBatchSize(size int) LlamaCppOption {
	return func(client *LlamaCppClient) error {
		client.cfg.BatchSize = size
		return nil
	}
}

// WithWaitBetweenBatches waits duration between a full batch size and
// the next full batch size when embedding.
func WithWaitBetweenBatches(duration time.Duration) LlamaCppOption {
	return func(client *LlamaCppClient) error {
		client.cfg.WaitBetweenBatches = duration
		return nil
	}
}

// LoadModel loads a model from the gguf espeficied when initializing the client.
func (client *LlamaCppClient) LoadModel(ctx context.Context, _ string, _ bool, taskMgr *taskmanager.TaskManager) (backends.ModelInfo, error) {
	path := strings.TrimSpace(client.cfg.URL.Path)
	//TODO read gguf model to compute checksum
	data, err := os.ReadFile(path)
	if err != nil {
		return backends.ModelInfo{}, fmt.Errorf("error reading model file: %w", err)
	}
	localHash := sha256.Sum256(data)
	checksum := hex.EncodeToString(localHash[:])
	ret := backends.ModelInfo{Checksum: checksum}
	if path == "" {
		return ret, errors.New("gguf model name is required")
	}
	if taskMgr != nil {
		if _, err := taskMgr.AddTask(taskID, daemonpb.TaskName_LOADING_MODEL, taskDescription, 100); err != nil {
			if errors.Is(err, taskmanager.ErrTaskExists) {
				return ret, fmt.Errorf("Another model is being loaded. Please wait until it ends before loading a new one: %w", err)
			} else {
				return ret, err
			}
		}
		defer func() {
			_, _ = taskMgr.DeleteTask(taskID)
		}()
	}

	client.model, err = llama.LoadModel(path,
		llama.WithGPULayers(-1), // Load all layer to GPU
		llama.WithMMap(true),
		llama.WithSilentLoading(),
		llama.WithProgressCallback(func(progress float32) bool {
			if taskMgr != nil {
				_, _ = taskMgr.UpdateProgress(taskID, 100, int64(progress*100))
			}
			return true
		}),
	)
	if err != nil {
		return ret, fmt.Errorf("error loading model: %w", err)
	}

	client.embeddingContext, err = client.model.NewContext(
		llama.WithThreads(runtime.NumCPU()),
		llama.WithEmbeddings(),
		llama.WithF16Memory(),
		llama.WithParallel(min(maxParallelContexts, client.cfg.BatchSize)),
	)
	if err != nil {
		return ret, fmt.Errorf("Could not create embedding context: %v\n", err)
	}
	_, err = client.model.Stats()
	if err != nil {
		return ret, fmt.Errorf("Could not get model stats: %v\n", err)
	}

	client.retrievalContext, err = client.model.NewContext(
		llama.WithThreads(runtime.NumCPU()),
		llama.WithF16Memory(),
		llama.WithParallel(min(maxParallelContexts, client.cfg.BatchSize)),
		llama.WithEmbeddings(),
	)
	if err != nil {
		return ret, fmt.Errorf("Could not create retrieval context: %v\n", err)
	}
	ret.Dimensions = 384  // Hardcoded for now as llama-go does not expose embedding length yet
	ret.ContextSize = 512 // Hardcoded for now as llama-go does not expose context size yet

	return ret, nil
}

// RetrieveSingle returns the embedding for a single input string.
// The model must be loaded via LoadModel before calling RetrieveSingle.
// Thread-safe: uses mutex to prevent concurrent access to retrievalContext.
func (client *LlamaCppClient) RetrieveSingle(ctx context.Context, input string) ([]float32, error) {
	client.muRetrieval.Lock()
	defer client.muRetrieval.Unlock()
	if client.retrievalContext == nil {
		return nil, errors.New("llamacpp embedding model is not loaded")
	}
	embed, err := client.retrievalContext.GetEmbeddings(input)
	if err != nil {
		return nil, fmt.Errorf("Error generating embeddings: %v\n", err)
	}
	if len(embed) != 1 {
		return nil, fmt.Errorf("llama embeddings count mismatch: got %d want %d", len(embed), 1)
	}
	norm := normalize([][]float32{embed})
	return norm[0], nil
}

// Embed returns embeddings for inputs in batches sized by the client.
// The model must be loaded via LoadModel before calling Embed.
// Thread-safe: uses mutex to prevent concurrent access to embeddingContext.
func (client *LlamaCppClient) Embed(ctx context.Context, inputs []string) ([][]float32, error) {
	client.muEmbed.Lock()
	defer client.muEmbed.Unlock()
	if client.embeddingContext == nil {
		return nil, errors.New("llamacpp embedding model is not loaded")
	}
	out := make([][]float32, 0, len(inputs))
	var wasPreviousBatchFull bool
	for start := 0; start < len(inputs); start += client.cfg.BatchSize {
		end := start + client.cfg.BatchSize
		if end > len(inputs) {
			end = len(inputs)
		}

		batch := inputs[start:end]
		isBatchFull := len(batch) == client.cfg.BatchSize
		if client.cfg.WaitBetweenBatches > 0 && wasPreviousBatchFull && isBatchFull {
			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			case <-time.After(client.cfg.WaitBetweenBatches):
			}
		}
		wasPreviousBatchFull = isBatchFull

		res, err := client.embeddingContext.GetEmbeddingsBatch(batch)
		if err != nil {
			return nil, fmt.Errorf("Error generating embeddings: %v\n", err)
		}

		if len(res) != len(batch) {
			return nil, fmt.Errorf("llama embeddings count mismatch: got %d want %d", len(res), len(batch))
		}
		norm := normalize(res)
		out = append(out, norm...)
	}

	stats, err := client.model.Stats()
	if err != nil {
		return nil, fmt.Errorf("Could not get model stats: %v\n", err)
	}
	_ = stats
	return out, nil
}

func normalize(vectors [][]float32) [][]float32 {
	for _, batch := range vectors {
		magnitude := float32(0.0)
		for _, val := range batch {
			magnitude += val * val
		}
		norm := float32(math.Sqrt(float64(magnitude)))
		if norm > 0 {
			for i := range batch {
				batch[i] /= norm
			}
		}
	}
	return vectors
}

// Version returns the Ollama server version string.
func (client *LlamaCppClient) Version(ctx context.Context) (string, error) {
	stats, err := client.model.Stats()
	if err != nil {
		return "", err
	}
	return strings.Join([]string{stats.Metadata.Name,
		stats.Metadata.Architecture,
		stats.Metadata.QuantizedBy,
		stats.Metadata.SizeLabel}, "_"), nil
}

// TokenLength returns the number of tokens in the input string.
func (client *LlamaCppClient) TokenLength(ctx context.Context, input string) (int, error) {
	tokens, err := client.embeddingContext.Tokenize(input)
	if err != nil {
		return 0, err
	}
	return len(tokens), nil
}

func (client *LlamaCppClient) CloseModel(_ context.Context) error {
	if client.embeddingContext != nil {
		client.embeddingContext.Close()
	}
	if client.model != nil {
		client.model.Close()
	}
	return nil
}
