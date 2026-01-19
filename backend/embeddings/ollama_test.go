package embeddings

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"

	"github.com/stretchr/testify/require"
)

type mockEmbedRequest struct {
	Model string   `json:"model"`
	Input []string `json:"input"`
}

type mockPullRequest struct {
	Model  string `json:"model"`
	Stream *bool  `json:"stream"`
}

func TestOllamaClientEmbeddings(t *testing.T) {
	ctx := t.Context()

	var (
		mu             sync.Mutex
		batchSizes     []int
		loadedModels   []string
		seenEmbeddings int
	)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/pull":
			var request mockPullRequest
			require.NoError(t, json.NewDecoder(r.Body).Decode(&request))
			require.NotEmpty(t, request.Model)
			require.NotNil(t, request.Stream)
			require.False(t, *request.Stream)

			mu.Lock()
			loadedModels = append(loadedModels, request.Model)
			mu.Unlock()

			w.Header().Set("Content-Type", "application/json")
			require.NoError(t, json.NewEncoder(w).Encode(map[string]string{"status": "success"}))
		case "/api/embed":
			var request mockEmbedRequest
			require.NoError(t, json.NewDecoder(r.Body).Decode(&request))
			require.NotEmpty(t, request.Model)

			mu.Lock()
			batchSizes = append(batchSizes, len(request.Input))
			mu.Unlock()

			response := make([][]float32, 0, len(request.Input))
			for _, input := range request.Input {
				response = append(response, []float32{float32(len(input))})
			}

			mu.Lock()
			seenEmbeddings += len(response)
			mu.Unlock()

			w.Header().Set("Content-Type", "application/json")
			require.NoError(t, json.NewEncoder(w).Encode(map[string]any{"embeddings": response}))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(server.Close)

	client, err := NewOllamaClient(server.URL, WithBatchSize(2))
	require.NoError(t, err)

	require.NoError(t, client.LoadModel(ctx, "nomic-embed-text", true))

	inputs := []string{"alpha", "bravo", "charlie", "delta", "echo"}
	embeddings, err := client.Embed(ctx, "nomic-embed-text", inputs)
	require.NoError(t, err)
	require.Len(t, embeddings, len(inputs))

	for index, embedding := range embeddings {
		require.Equal(t, []float32{float32(len(inputs[index]))}, embedding)
	}

	mu.Lock()
	defer mu.Unlock()

	require.Equal(t, []string{"nomic-embed-text"}, loadedModels)
	require.Equal(t, []int{2, 2, 1}, batchSizes)
	require.Equal(t, len(inputs), seenEmbeddings)
}

func TestOllamaClientEmbedEmptyInput(t *testing.T) {
	ctx := t.Context()

	client, err := NewOllamaClient("http://example.com")
	require.NoError(t, err)

	embeddings, err := client.Embed(ctx, "nomic-embed-text", nil)
	require.NoError(t, err)
	require.Empty(t, embeddings)
}
