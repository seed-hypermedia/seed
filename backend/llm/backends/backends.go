// Package backends defines the embedding backend interface and types.
package backends

import (
	"context"
	"net/url"
	"seed/backend/daemon/taskmanager"
	"time"
)

// BackendType identifies an embedding backend implementation.
type BackendType int

// Backend type constants.
const (
	Ollama BackendType = iota
	LlamaCpp
)

// ModelInfo contains information about an embedding model.
type ModelInfo struct {
	// Dimensions is the dimensions of the embedding vector.
	Dimensions int

	// ContextSize is the context size of the model.
	ContextSize int

	// Checksum is the unique identifier of the model. No other model
	// or the same model with different quantization should have the same checksum.
	// If the model is updated in any form this value must change.
	Checksum string
}

// ClientCfg contains configuration for an embedding backend client.
type ClientCfg struct {
	// URL is the base URL of the embedding backend service.
	// It could be an HTTP URL or a file URL depending on the backend.
	URL url.URL
	//BatchSize is the number of inputs to process in a single batch.
	BatchSize int
	// WaitBetweenBatches is the duration to wait between processing batches.
	WaitBetweenBatches time.Duration
	// Model is the name of the model to use.
	Model string
}

// Backend is the interface for embedding model backends.
type Backend interface {
	// LoadModel loads the specified model. If force is true, it
	// downloads the necesseary files to load the model when not present.
	LoadModel(ctx context.Context, model string, force bool, taskMgr *taskmanager.TaskManager) (ModelInfo, error)
	// Embed generates embeddings for the given inputs.
	// LoadModel must be called before calling Embed.
	// Results are normalized.
	Embed(ctx context.Context, inputs []string) ([][]float32, error)
	// RetrieveSingle generates a single embedding for the given input.
	// LoadModel must be called before calling RetrieveSingle.
	// Result is normalized.
	RetrieveSingle(ctx context.Context, input string) ([]float32, error)
	// CloseModel closes the currently active model so no resources are used.
	CloseModel(ctx context.Context) error
	// Version returns the version of the backend.
	Version(ctx context.Context) (string, error)
	// TokenLength returns the number of tokens in the input string.
	TokenLength(ctx context.Context, input string) (int, error)
}
