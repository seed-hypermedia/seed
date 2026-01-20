package llm

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
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
	baseURL            *url.URL
	http               *http.Client
	client             *api.Client
	batchSize          int
	waitBetweenBatches time.Duration
	model              string
}

type OllamaOption func(*OllamaClient) error

// NewOllamaClient creates a new Ollama client bound to the provided base URL.
func NewOllamaClient(baseURL string, opts ...OllamaOption) (*OllamaClient, error) {
	trimmed := strings.TrimSpace(baseURL)
	if trimmed == "" {
		return nil, errors.New("ollama base URL is required")
	}

	parsedURL, err := url.Parse(trimmed)
	if err != nil {
		return nil, fmt.Errorf("ollama base URL is invalid: %w", err)
	}

	client := &OllamaClient{
		baseURL:   parsedURL,
		http:      &http.Client{Timeout: defaultHTTPTimeout},
		batchSize: defaultBatchSize,
	}

	for _, opt := range opts {
		if err := opt(client); err != nil {
			return nil, err
		}
	}

	if client.batchSize <= 0 {
		return nil, errors.New("ollama batch size must be positive")
	}

	client.client = api.NewClient(client.baseURL, client.http)

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
		client.batchSize = size
		return nil
	}
}

// WithWaitBetweenBatches waits duration between a full batch size and
// the next full batch size when embedding.
func WithWaitBetweenBatches(duration time.Duration) OllamaOption {
	return func(client *OllamaClient) error {
		client.waitBetweenBatches = duration
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

// LoadModel ensures a model is available; when force is true it pulls it.
// It returns the embedding dimensions and context size from the model metadata.
func (client *OllamaClient) LoadModel(ctx context.Context, model string, force bool) (ModelInfo, error) {
	model = strings.TrimSpace(model)
	ret := ModelInfo{}
	if model == "" {
		return ret, errors.New("ollama model name is required")
	}

	showResponse, err := client.client.Show(ctx, &api.ShowRequest{Model: model})
	if err == nil {
		ret, parseErr := parseModelInfo(model, showResponse)
		if parseErr != nil {
			return ret, parseErr
		}
		client.model = model

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
		return ModelInfo{}, err
	}

	showResponse, err = client.client.Show(ctx, &api.ShowRequest{Model: model})
	if err != nil {
		return ModelInfo{}, err
	}

	info, err := parseModelInfo(model, showResponse)
	if err != nil {
		return ModelInfo{}, err
	}

	client.model = model
	return info, nil
}

// Embed returns embeddings for inputs in batches sized by the client.
// The model must be loaded via LoadModel before calling Embed.
func (client *OllamaClient) Embed(ctx context.Context, inputs []string) ([][]float32, error) {
	model := strings.TrimSpace(client.model)
	if model == "" {
		return nil, errors.New("ollama model not loaded; call LoadModel first")
	}
	if len(inputs) == 0 {
		return [][]float32{}, nil
	}

	embeddings := make([][]float32, 0, len(inputs))
	var wasPreviousBatchFull bool
	for start := 0; start < len(inputs); start += client.batchSize {
		end := start + client.batchSize
		if end > len(inputs) {
			end = len(inputs)
		}

		batch := inputs[start:end]
		isBatchFull := len(batch) == client.batchSize
		if client.waitBetweenBatches > 0 && wasPreviousBatchFull && isBatchFull {
			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			case <-time.After(client.waitBetweenBatches):
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

func parseModelInfo(model string, response *api.ShowResponse) (ModelInfo, error) {
	if response == nil {
		return ModelInfo{}, fmt.Errorf("ollama model info missing: %s", model)
	}

	if !hasEmbeddingCapability(response.Capabilities) {
		return ModelInfo{}, fmt.Errorf("ollama model does not support embeddings: %s", model)
	}

	dimensions := readIntFromInfo(response.ModelInfo, embeddingDimensionKeys)
	if dimensions == 0 {
		dimensions = readIntFromInfo(response.ProjectorInfo, embeddingDimensionKeys)
	}
	if dimensions == 0 {
		return ModelInfo{}, fmt.Errorf("ollama model embedding dimensions missing: %s", model)
	}

	contextSize := readIntFromInfo(response.ModelInfo, contextSizeKeys)
	if contextSize == 0 {
		contextSize = readIntFromInfo(response.ProjectorInfo, contextSizeKeys)
	}
	if contextSize == 0 {
		return ModelInfo{}, fmt.Errorf("ollama model context size missing: %s", model)
	}

	return ModelInfo{Dimensions: dimensions, ContextSize: contextSize}, nil
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
