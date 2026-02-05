// Package llamacpp provides an embedding backend using llama.cpp.
package llamacpp

import (
	"context"
	"crypto/sha256"
	"embed"
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

//go:embed models/*.gguf
var embeddedModels embed.FS

const embeddedModelPath = "models/paraphrase-multilingual-MiniLM-L12-118M-v2-Q8_0.gguf"

// writeEmbeddedModelToTempFile extracts the embedded GGUF model to a temp file
// and returns its path. Caller is responsible for cleanup.
func writeEmbeddedModelToTempFile() (string, error) {
	data, err := embeddedModels.ReadFile(embeddedModelPath)
	if err != nil {
		return "", fmt.Errorf("reading embedded model: %w", err)
	}
	f, err := os.CreateTemp("", "seed-embed-*.gguf")
	if err != nil {
		return "", fmt.Errorf("creating temp file for model: %w", err)
	}
	if _, err := f.Write(data); err != nil {
		_ = f.Close()
		_ = os.Remove(f.Name())
		return "", fmt.Errorf("writing embedded model to temp file: %w", err)
	}
	if err := f.Close(); err != nil {
		_ = os.Remove(f.Name())
		return "", err
	}
	return f.Name(), nil
}

// Client is an embedding client backed by llama.cpp.
type Client struct {
	model            *llama.Model
	embeddingContext *llama.Context // For generating embeddings
	muEmbed          sync.Mutex     // protects embeddingContext from concurrent access
	retrievalContext *llama.Context // For retrieving similar embeddings
	muRetrieval      sync.Mutex     // protects retrievalContext from concurrent access
	cfg              backends.ClientCfg
}

// Option configures the Client.
type Option func(*Client) error

const (
	defaultBatchSize    = 10
	maxParallelContexts = 16
	taskID              = "llamacpp-load-model-task"
	taskDescription     = "Loading LlamaCpp model"
)

// NewClient creates a new LlamaCpp client.
// If fileURL is zero-value (empty scheme), the embedded model is extracted to a temp file.
// If fileURL has scheme "file", the model at that path is used directly.
func NewClient(fileURL url.URL, opts ...Option) (*Client, error) {
	if fileURL.Scheme == "" {
		// Use embedded model.
		tmpPath, err := writeEmbeddedModelToTempFile()
		if err != nil {
			return nil, fmt.Errorf("extracting embedded model: %w", err)
		}
		fileURL = url.URL{Scheme: "file", Path: tmpPath}
	}
	if fileURL.Scheme != "file" {
		return nil, fmt.Errorf("llamacpp file URL scheme must be file:///path/to-model, got scheme: %s", fileURL.Scheme)
	}
	client := &Client{cfg: backends.ClientCfg{BatchSize: defaultBatchSize, URL: fileURL}}

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
func WithBatchSize(size int) Option {
	return func(client *Client) error {
		client.cfg.BatchSize = size
		return nil
	}
}

// WithWaitBetweenBatches waits duration between a full batch size and
// the next full batch size when embedding.
func WithWaitBetweenBatches(duration time.Duration) Option {
	return func(client *Client) error {
		client.cfg.WaitBetweenBatches = duration
		return nil
	}
}

// LoadModel loads a model from the gguf espeficied when initializing the client.
func (client *Client) LoadModel(_ context.Context, _ string, _ bool, taskMgr *taskmanager.TaskManager) (backends.ModelInfo, error) {
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
				return ret, fmt.Errorf("another model is being loaded, please wait until it ends before loading a new one: %w", err)
			}
			return ret, err
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
		return ret, fmt.Errorf("could not create embedding context: %w", err)
	}
	_, err = client.model.Stats()
	if err != nil {
		return ret, fmt.Errorf("could not get model stats: %w", err)
	}

	client.retrievalContext, err = client.model.NewContext(
		llama.WithThreads(runtime.NumCPU()),
		llama.WithF16Memory(),
		llama.WithParallel(min(maxParallelContexts, client.cfg.BatchSize)),
		llama.WithEmbeddings(),
	)
	if err != nil {
		return ret, fmt.Errorf("could not create retrieval context: %w", err)
	}
	ret.Dimensions = 384  // Hardcoded for now as llama-go does not expose embedding length yet
	ret.ContextSize = 512 // Hardcoded for now as llama-go does not expose context size yet

	// Warm up both contexts to avoid cold-start latency on first real call.
	// Yes, this is an ancient hack, ... but it works.
	if _, err := client.embeddingContext.GetEmbeddingsBatch([]string{"warmup"}); err != nil {
		return ret, fmt.Errorf("failed to warm up embedding context: %w", err)
	}
	if _, err := client.retrievalContext.GetEmbeddings("warmup"); err != nil {
		return ret, fmt.Errorf("failed to warm up retrieval context: %w", err)
	}

	return ret, nil
}

// RetrieveSingle returns the embedding for a single input string.
// The model must be loaded via LoadModel before calling RetrieveSingle.
// Thread-safe: uses mutex to prevent concurrent access to retrievalContext.
func (client *Client) RetrieveSingle(_ context.Context, input string) ([]float32, error) {
	client.muRetrieval.Lock()
	defer client.muRetrieval.Unlock()
	if client.retrievalContext == nil {
		return nil, errors.New("llamacpp embedding model is not loaded")
	}
	embed, err := client.retrievalContext.GetEmbeddings(input)
	if err != nil {
		return nil, fmt.Errorf("error generating embeddings: %w", err)
	}
	norm := normalize([][]float32{embed})
	return norm[0], nil
}

// Embed returns embeddings for inputs in batches sized by the client.
// The model must be loaded via LoadModel before calling Embed.
// Thread-safe: uses mutex to prevent concurrent access to embeddingContext.
func (client *Client) Embed(ctx context.Context, inputs []string) ([][]float32, error) {
	client.muEmbed.Lock() // We can't use the same context concurrently
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
			return nil, fmt.Errorf("error generating embeddings: %w", err)
		}

		if len(res) != len(batch) {
			return nil, fmt.Errorf("llama embeddings count mismatch: got %d want %d", len(res), len(batch))
		}
		norm := normalize(res)
		out = append(out, norm...)
	}
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
// Version returns the model version string.
func (client *Client) Version(_ context.Context) (string, error) {
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
func (client *Client) TokenLength(_ context.Context, input string) (int, error) {
	tokens, err := client.embeddingContext.Tokenize(input)
	if err != nil {
		return 0, err
	}
	return len(tokens), nil
}

// CloseModel releases the model and its contexts.
func (client *Client) CloseModel(_ context.Context) error {
	var errs []error
	if client.embeddingContext != nil {
		errs = append(errs, client.embeddingContext.Close())
	}
	if client.model != nil {
		errs = append(errs, client.model.Close())
	}
	return errors.Join(errs...)
}
