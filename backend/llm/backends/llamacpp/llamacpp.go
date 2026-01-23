package llamacpp

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"flag"
	"fmt"
	"math"
	"net/url"
	"os"
	"runtime"
	"seed/backend/llm/backends"
	"strings"
	"time"

	llama "github.com/tcpipuk/llama-go"
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
func (client *LlamaCppClient) LoadModel(ctx context.Context, _ string, _ bool) (backends.ModelInfo, error) {
	path := client.cfg.URL.Path
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

	client.model, err = llama.LoadModel(path,
		llama.WithGPULayers(-1),
		llama.WithMMap(true),
		llama.WithSilentLoading(),
	)
	if err != nil {
		return ret, fmt.Errorf("error loading model: %w", err)
	}
	info, err := client.model.Stats()
	if err != nil {
		return ret, fmt.Errorf("Could not get model stats: %v\n", err)
	}
	client.embeddingContext, err = client.model.NewContext(
		llama.WithThreads(runtime.NumCPU()),
		llama.WithEmbeddings(),
		llama.WithF16Memory(),
	)
	if err != nil {
		return ret, fmt.Errorf("Could not create embedding context: %v\n", err)
	}
	ret.Dimensions = 384 // Hardcoded for now as llama-go does not expose embedding length yet
	ret.ContextSize = info.Runtime.ContextSize

	return ret, nil
}

// Embed returns embeddings for inputs in batches sized by the client.
// The model must be loaded via LoadModel before calling Embed.
func (client *LlamaCppClient) Embed(ctx context.Context, inputs []string) ([][]float32, error) {
	return nil, fmt.Errorf("not implemented")
	/*
		model := strings.TrimSpace(client.cfg.Model)
		if model == "" {
			return nil, errors.New("llamacpp model not loaded; call LoadModel first")
		}
		if len(inputs) == 0 {
			return [][]float32{}, nil
		}

		embeddings := make([][]float32, 0, len(inputs))
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

			request := &api.EmbedRequest{
				Model: model,
				Input: batch,
			}
			response, err := client.client.Embed(ctx, request)
			if err != nil {
				return nil, err
			}

			if len(response.Embeddings) != len(batch) {
				return nil, fmt.Errorf("ollama embeddings count mismatch: got %d want %d", len(response.Embeddings), len(batch))
			}

			embeddings = append(embeddings, response.Embeddings...)
		}

		return embeddings, nil
	*/
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

func (client *LlamaCppClient) CloseModel(_ context.Context) error {
	if client.embeddingContext != nil {
		client.embeddingContext.Close()
	}
	if client.model != nil {
		client.model.Close()
	}
	return nil
}

func main() {
	var (
		modelPath = flag.String("m", "embedding-model.gguf", "path to embedding model")
		text      = flag.String("t", "Hello world", "text to get embeddings for")
		gpuLayers = flag.Int("ngl", -1, "number of GPU layers (-1 for all)")
		context   = flag.Int("c", 128, "context size")
	)
	flag.Parse()

	// Load model with embeddings enabled
	fmt.Printf("Loading embedded model: %s\n", *modelPath)
	model, err := llama.LoadModel(*modelPath,
		llama.WithGPULayers(*gpuLayers),
		llama.WithMMap(true),
		llama.WithSilentLoading(),
	)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error loading model: %v\n", err)
		os.Exit(1)
	}
	defer model.Close()

	// Create context with embedding support
	ctx, err := model.NewContext(
		llama.WithContext(*context),
		llama.WithThreads(runtime.NumCPU()),
		llama.WithEmbeddings(),
		llama.WithF16Memory(),
	)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error creating context: %v\n", err)
		os.Exit(1)
	}
	defer ctx.Close()

	fmt.Printf("Model loaded successfully.\n")
	fmt.Printf("Getting embeddings for: %s\n", *text)

	// Generate embeddings
	embeddingStart := time.Now()
	embeddings, err := ctx.GetEmbeddings(*text)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error generating embeddings: %v\n", err)
		os.Exit(1)
	}
	embeddingElapsed := time.Since(embeddingStart)

	fmt.Printf("\nEmbeddings generated successfully!\n")
	fmt.Printf("Vector dimension: %d\n", len(embeddings))

	postStart := time.Now()
	magnitude := float32(0.0)
	for _, val := range embeddings {
		magnitude += val * val
	}

	norm := float32(math.Sqrt(float64(magnitude)))
	if norm > 0 {
		for i := range embeddings {
			embeddings[i] /= norm
		}
	}

	meanSquared := magnitude / float32(len(embeddings)) // Mean squared (pre-normalization)
	fmt.Printf("Mean squared magnitude: %.6f\n", meanSquared)
	fmt.Printf("L2 norm (pre-normalization): %.6f\n", norm)
	magnitude = 0.0
	fmt.Printf("Embeddings:[")
	for _, val := range embeddings {
		fmt.Printf("%.8f, ", val)
		magnitude += val * val
	}
	fmt.Printf("]\n")
	norm = float32(math.Sqrt(float64(magnitude)))
	fmt.Printf("L2 norm (post-normalization): %.6f\n", norm)
	postElapsed := time.Since(postStart)

	fmt.Printf("\nTiming:\n")
	fmt.Printf("  Embedding generation: %s\n", embeddingElapsed)
	fmt.Printf("  Post-processing: %s\n", postElapsed)
}

const (
	defaultBatchSize   = 10
	defaultHTTPTimeout = 5 * time.Minute
)

type LlamaCppClient struct {
	model            *llama.Model
	embeddingContext *llama.Context // not same meaning as context.Context
	cfg              backends.ClientCfg
}
type LlamaCppOption func(*LlamaCppClient) error
