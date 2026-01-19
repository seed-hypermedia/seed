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
	server *httptest.Server

	mu sync.Mutex

	batchSizes     []int
	loadedModels   []string
	seenEmbeddings int
	showRequests   int
	embedRequests  int

	embeddingDims int
	contextSize   int

	firstEmbedOnce sync.Once
	firstEmbedDone chan struct{}
}

type mockOllamaServerOption func(*mockOllamaServer)

func withMockOllamaEmbeddingDims(dims int) mockOllamaServerOption {
	return func(s *mockOllamaServer) {
		if dims > 0 {
			s.embeddingDims = dims
		}
	}
}

func withMockOllamaContextSize(size int) mockOllamaServerOption {
	return func(s *mockOllamaServer) {
		if size > 0 {
			s.contextSize = size
		}
	}
}

func newMockOllamaServer(t *testing.T, opts ...mockOllamaServerOption) *mockOllamaServer {
	t.Helper()

	s := &mockOllamaServer{
		embeddingDims:  768,
		contextSize:    2048,
		firstEmbedDone: make(chan struct{}),
	}
	for _, opt := range opts {
		opt(s)
	}

	s.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/pull":
			var request mockPullRequest
			require.NoError(t, json.NewDecoder(r.Body).Decode(&request))
			require.NotEmpty(t, request.Model)
			require.NotNil(t, request.Stream)
			require.False(t, *request.Stream)

			s.mu.Lock()
			s.loadedModels = append(s.loadedModels, request.Model)
			s.mu.Unlock()

			w.Header().Set("Content-Type", "application/json")
			require.NoError(t, json.NewEncoder(w).Encode(map[string]string{"status": "success"}))
		case "/api/show":
			var request mockPullRequest
			require.NoError(t, json.NewDecoder(r.Body).Decode(&request))
			require.NotEmpty(t, request.Model)

			s.mu.Lock()
			s.showRequests++
			embeddingDims := s.embeddingDims
			contextSize := s.contextSize
			s.mu.Unlock()

			w.Header().Set("Content-Type", "application/json")
			require.NoError(t, json.NewEncoder(w).Encode(map[string]any{
				"model_info": map[string]any{
					"gemma3.embedding_length": embeddingDims,
					"gemma3.context_length":   contextSize,
				},
				"capabilities": []string{"embedding"},
			}))
		case "/api/embed":
			var request mockEmbedRequest
			require.NoError(t, json.NewDecoder(r.Body).Decode(&request))
			require.NotEmpty(t, request.Model)

			s.mu.Lock()
			s.embedRequests++
			s.batchSizes = append(s.batchSizes, len(request.Input))
			embeddingDims := s.embeddingDims
			s.mu.Unlock()

			response := make([][]float32, 0, len(request.Input))
			for _, input := range request.Input {
				vec := make([]float32, embeddingDims)
				if embeddingDims > 0 {
					vec[0] = float32(len(input))
				}
				response = append(response, vec)
			}

			s.mu.Lock()
			s.seenEmbeddings += len(response)
			s.mu.Unlock()

			w.Header().Set("Content-Type", "application/json")
			require.NoError(t, json.NewEncoder(w).Encode(map[string]any{"embeddings": response}))

			s.firstEmbedOnce.Do(func() {
				close(s.firstEmbedDone)
			})
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))

	return s
}
