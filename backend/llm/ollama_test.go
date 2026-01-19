package llm
package llm

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

type mockOllamaServer struct {
	server         *httptest.Server
	mu             sync.Mutex
	batchSizes     []int
	loadedModels   []string
	seenEmbeddings int
	showRequests   int
}

func newMockOllamaServer(t *testing.T) *mockOllamaServer {
	t.Helper()

	mockServer := &mockOllamaServer{}
	mockServer.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/pull":
			var request mockPullRequest
			require.NoError(t, json.NewDecoder(r.Body).Decode(&request))
			require.NotEmpty(t, request.Model)
			require.NotNil(t, request.Stream)
			require.False(t, *request.Stream)

			mockServer.mu.Lock()
			mockServer.loadedModels = append(mockServer.loadedModels, request.Model)
			mockServer.mu.Unlock()

			w.Header().Set("Content-Type", "application/json")
			require.NoError(t, json.NewEncoder(w).Encode(map[string]string{"status": "success"}))
		case "/api/show":
			var request mockPullRequest
			require.NoError(t, json.NewDecoder(r.Body).Decode(&request))
			require.NotEmpty(t, request.Model)

			mockServer.mu.Lock()
			mockServer.showRequests++
			mockServer.mu.Unlock()

			w.Header().Set("Content-Type", "application/json")
			require.NoError(t, json.NewEncoder(w).Encode(map[string]any{
				"model_info": map[string]any{
					"gemma3.embedding_length": 768,
					"gemma3.context_length":   2048,
				},
				"capabilities": []string{"embedding"},
			}))
		case "/api/embed":
			var request mockEmbedRequest
			require.NoError(t, json.NewDecoder(r.Body).Decode(&request))
			require.NotEmpty(t, request.Model)

			mockServer.mu.Lock()
			mockServer.batchSizes = append(mockServer.batchSizes, len(request.Input))
			mockServer.mu.Unlock()

			response := make([][]float32, 0, len(request.Input))
			for _, input := range request.Input {
				response = append(response, []float32{float32(len(input))})
			}

			mockServer.mu.Lock()
			mockServer.seenEmbeddings += len(response)
			mockServer.mu.Unlock()

			w.Header().Set("Content-Type", "application/json")
			require.NoError(t, json.NewEncoder(w).Encode(map[string]any{"embeddings": response}))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))

	return mockServer
}

func TestOllamaClientEmbeddings(t *testing.T) {
	ctx := t.Context()
	const model = "embeddinggemma"
	mockServer := newMockOllamaServer(t)
	t.Cleanup(mockServer.server.Close)

	client, err := NewOllamaClient(mockServer.server.URL, WithBatchSize(2))
	require.NoError(t, err)

	dimensions, contextSize, err := client.LoadModel(ctx, model, true)
	require.NoError(t, err)
	require.Equal(t, 768, dimensions)
	require.Equal(t, 2048, contextSize)

	inputs := []string{"alpha", "bravo", "charlie", "delta", "echo"}
	embeddings, err := client.Embed(ctx, inputs)
	require.NoError(t, err)
	require.Len(t, embeddings, len(inputs))

	for index, embedding := range embeddings {
		require.Equal(t, []float32{float32(len(inputs[index]))}, embedding)
	}

	mockServer.mu.Lock()
	defer mockServer.mu.Unlock()

	require.Empty(t, mockServer.loadedModels)
	require.Equal(t, []int{2, 2, 1}, mockServer.batchSizes)
	require.Equal(t, len(inputs), mockServer.seenEmbeddings)
	require.Equal(t, 1, mockServer.showRequests)
}

func TestOllamaClientEmbedEmptyInput(t *testing.T) {
	ctx := t.Context()
	const model = "embeddinggemma"

	mockServer := newMockOllamaServer(t)
	t.Cleanup(mockServer.server.Close)

	client, err := NewOllamaClient(mockServer.server.URL)
	require.NoError(t, err)

	_, _, err = client.LoadModel(ctx, model, true)
	require.NoError(t, err)

	embeddings, err := client.Embed(ctx, nil)
	require.NoError(t, err)
	require.Empty(t, embeddings)
}

func TestOllamaClientEmbedRequiresModel(t *testing.T) {
	ctx := t.Context()

	client, err := NewOllamaClient("http://example.com")
	require.NoError(t, err)

	_, err = client.Embed(ctx, []string{"alpha"})
	require.Error(t, err)
	require.Contains(t, err.Error(), "LoadModel")
}