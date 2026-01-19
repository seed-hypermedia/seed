package embeddings

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/ollama/ollama/api"
)

const defaultBatchSize = 32

type OllamaClient struct {
	baseURL   *url.URL
	http      *http.Client
	client    *api.Client
	batchSize int
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
		http:      &http.Client{Timeout: 30 * time.Second},
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

func WithBatchSize(size int) OllamaOption {
	return func(client *OllamaClient) error {
		client.batchSize = size
		return nil
	}
}

// LoadModel ensures a model is available; when force is true it pulls it.
func (client *OllamaClient) LoadModel(ctx context.Context, model string, force bool) error {
	model = strings.TrimSpace(model)
	if model == "" {
		return errors.New("ollama model name is required")
	}

	if !force {
		_, err := client.client.Show(ctx, &api.ShowRequest{Model: model})
		if err == nil {
			return nil
		}

		var statusError api.StatusError
		if errors.As(err, &statusError) && statusError.StatusCode == http.StatusNotFound {
			return fmt.Errorf("ollama model not found: %s", model)
		}

		return err
	}

	stream := false
	request := &api.PullRequest{
		Model:  model,
		Stream: &stream,
	}

	return client.client.Pull(ctx, request, func(api.ProgressResponse) error {
		return nil
	})
}

// Embed returns embeddings for inputs in batches sized by the client.
func (client *OllamaClient) Embed(ctx context.Context, model string, inputs []string) ([][]float32, error) {
	model = strings.TrimSpace(model)
	if model == "" {
		return nil, errors.New("ollama model name is required")
	}
	if len(inputs) == 0 {
		return [][]float32{}, nil
	}

	embeddings := make([][]float32, 0, len(inputs))
	for start := 0; start < len(inputs); start += client.batchSize {
		end := start + client.batchSize
		if end > len(inputs) {
			end = len(inputs)
		}

		batch := inputs[start:end]
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

// Version returns the Ollama server version string.
func (client *OllamaClient) Version(ctx context.Context) (string, error) {
	return client.client.Version(ctx)
}
