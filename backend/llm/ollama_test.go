package llm

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestOllamaClientEmbeddings(t *testing.T) {
	ctx := t.Context()
	const model = "embeddinggemma"
	mockServer := newMockOllamaServer(t)
	t.Cleanup(mockServer.server.Close)

	client, err := NewOllamaClient(mockServer.server.URL, WithBatchSize(2))
	require.NoError(t, err)

	info, err := client.LoadModel(ctx, model, true)
	require.NoError(t, err)
	require.Equal(t, 768, info.Dimensions)
	require.Equal(t, 2048, info.ContextSize)

	inputs := []string{"alpha", "bravo", "charlie", "delta", "echo"}
	embeddings, err := client.Embed(ctx, inputs)
	require.NoError(t, err)
	require.Len(t, embeddings, len(inputs))

	for index, embedding := range embeddings {
		require.Len(t, embedding, 768)
		require.Equal(t, float32(len(inputs[index])), embedding[0])
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

	_, err = client.LoadModel(ctx, model, true)
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
