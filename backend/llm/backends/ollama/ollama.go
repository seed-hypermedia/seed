package ollama

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"seed/backend/llm/backends"
	"strconv"
	"strings"
	"time"

	"github.com/ollama/ollama/api"
	"github.com/ollama/ollama/types/model"
)

const (
	defaultBatchSize   = 10
	defaultHTTPTimeout = 5 * time.Minute
)

type OllamaClient struct {
	cfg    backends.ClientCfg
	http   *http.Client
	client *api.Client
}

type OllamaOption func(*OllamaClient) error

// NewOllamaClient creates a new Ollama client bound to the provided base URL.
func NewOllamaClient(baseURL url.URL, opts ...OllamaOption) (*OllamaClient, error) {
	client := &OllamaClient{
		http: &http.Client{Timeout: defaultHTTPTimeout},
		cfg:  backends.ClientCfg{BatchSize: defaultBatchSize, URL: baseURL},
	}

	for _, opt := range opts {
		if err := opt(client); err != nil {
			return nil, err
		}
	}

	if client.cfg.BatchSize <= 0 {
		return nil, errors.New("ollama batch size must be positive")
	}

	client.client = api.NewClient(&client.cfg.URL, client.http)

	return client, nil
}

// WithHTTPTransport overrides the HTTP client used for Ollama requests.
func WithHTTPTransport(httpClient *http.Client) OllamaOption {
	return func(client *OllamaClient) error {
		if httpClient == nil {
			return errors.New("ollama http client is required")
		}

		client.http = httpClient
		return nil
	}
}

// WithBatchSize sets the batch size for embedding requests.
func WithBatchSize(size int) OllamaOption {
	return func(client *OllamaClient) error {
		client.cfg.BatchSize = size
		return nil
	}
}

// WithWaitBetweenBatches waits duration between a full batch size and
// the next full batch size when embedding.
func WithWaitBetweenBatches(duration time.Duration) OllamaOption {
	return func(client *OllamaClient) error {
		client.cfg.WaitBetweenBatches = duration
		return nil
	}
}

// WithHTTPTimeout sets the HTTP client timeout used for Ollama requests.
// This covers the entire request (connect + send + wait for headers/body).
func WithHTTPTimeout(timeout time.Duration) OllamaOption {
	return func(client *OllamaClient) error {
		if timeout <= 0 {
			return errors.New("ollama http timeout must be positive")
		}
		if client.http == nil {
			client.http = &http.Client{}
		}
		client.http.Timeout = timeout
		return nil
	}
}

func (client *OllamaClient) CloseModel(_ context.Context) error {
	return nil
}

// LoadModel ensures a model is available; when force is true it pulls it.
// It returns the embedding dimensions and context size from the model metadata.
func (client *OllamaClient) LoadModel(ctx context.Context, model string, force bool) (backends.ModelInfo, error) {
	model = strings.TrimSpace(model)
	ret := backends.ModelInfo{}
	if model == "" {
		return ret, errors.New("ollama model name is required")
	}

	showResponse, err := client.client.Show(ctx, &api.ShowRequest{Model: model})
	if err == nil {
		ret, parseErr := parseModelInfo(model, showResponse)
		if parseErr != nil {
			return ret, parseErr
		}
		client.cfg.Model = model

		return ret, nil
	} else if !force {
		var statusError api.StatusError
		if errors.As(err, &statusError) && statusError.StatusCode == http.StatusNotFound {
			return ret, fmt.Errorf("ollama model not found: %s", model)
		}

		return ret, err
	}

	stream := false
	request := &api.PullRequest{
		Model:  model,
		Stream: &stream,
	}

	if err := client.client.Pull(ctx, request, func(api.ProgressResponse) error {
		return nil
	}); err != nil {
		return backends.ModelInfo{}, err
	}

	showResponse, err = client.client.Show(ctx, &api.ShowRequest{Model: model})
	if err != nil {
		return backends.ModelInfo{}, err
	}

	info, err := parseModelInfo(model, showResponse)
	if err != nil {
		return backends.ModelInfo{}, err
	}

	client.cfg.Model = model
	return info, nil
}

// Embed returns embeddings for inputs in batches sized by the client.
// The model must be loaded via LoadModel before calling Embed.
func (client *OllamaClient) Embed(ctx context.Context, inputs []string) ([][]float32, error) {
	model := strings.TrimSpace(client.cfg.Model)
	if model == "" {
		return nil, errors.New("ollama model not loaded; call LoadModel first")
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
}

func parseModelInfo(model string, response *api.ShowResponse) (backends.ModelInfo, error) {
	if response == nil {
		return backends.ModelInfo{}, fmt.Errorf("ollama model info missing: %s", model)
	}

	if !hasEmbeddingCapability(response.Capabilities) {
		return backends.ModelInfo{}, fmt.Errorf("ollama model does not support embeddings: %s", model)
	}

	dimensions := readIntFromInfo(response.ModelInfo, embeddingDimensionKeys)
	if dimensions == 0 {
		dimensions = readIntFromInfo(response.ProjectorInfo, embeddingDimensionKeys)
	}
	if dimensions == 0 {
		return backends.ModelInfo{}, fmt.Errorf("ollama model embedding dimensions missing: %s", model)
	}

	contextSize := readIntFromInfo(response.ModelInfo, contextSizeKeys)
	if contextSize == 0 {
		contextSize = readIntFromInfo(response.ProjectorInfo, contextSizeKeys)
	}
	if contextSize == 0 {
		return backends.ModelInfo{}, fmt.Errorf("ollama model context size missing: %s", model)
	}
	data, err := json.Marshal(response)
	if err != nil {
		return backends.ModelInfo{}, fmt.Errorf("ollama model info marshal error: %v", err)
	}

	localHash := sha256.Sum256(data)
	checksum := hex.EncodeToString(localHash[:])
	return backends.ModelInfo{Dimensions: dimensions, ContextSize: contextSize, Checksum: checksum}, nil
}

func readIntFromInfo(info map[string]any, keys []string) int {
	if len(info) == 0 {
		return 0
	}

	for infoKey, value := range info {
		lowerKey := strings.ToLower(infoKey)
		if !matchesAnyKey(lowerKey, keys) {
			continue
		}

		switch typed := value.(type) {
		case int:
			return typed
		case int32:
			return int(typed)
		case int64:
			return int(typed)
		case float32:
			return int(typed)
		case float64:
			return int(typed)
		case string:
			parsed, err := strconv.Atoi(typed)
			if err == nil {
				return parsed
			}
		}
	}

	return 0
}

func matchesAnyKey(infoKey string, keys []string) bool {
	for _, key := range keys {
		if strings.Contains(infoKey, key) {
			return true
		}
	}

	return false
}

func hasEmbeddingCapability(capabilities []model.Capability) bool {
	for _, capability := range capabilities {
		if capability.String() == "embedding" || capability.String() == "embeddings" {
			return true
		}
	}

	return false
}

var embeddingDimensionKeys = []string{
	"embedding_length",
	"embedding_size",
	"embedding_dim",
	"embedding_dimension",
	"n_embd",
	"hidden_size",
}

var contextSizeKeys = []string{
	"context_length",
	"max_context_length",
	"max_sequence_length",
	"context_size",
	"n_ctx",
	"n_ctx_train",
}

// Version returns the Ollama server version string.
func (client *OllamaClient) Version(ctx context.Context) (string, error) {
	return client.client.Version(ctx)
}
