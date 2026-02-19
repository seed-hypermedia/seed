package ollama

import (
	"context"
	"net/url"
	"seed/backend/testutil"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestOllamaClientEmbeddings(t *testing.T) {
	ctx := t.Context()
	const model = "embeddinggemma"
	mockServer := testutil.NewMockOllamaServer(t)
	t.Cleanup(mockServer.Server.Close)
	url, err := url.Parse(mockServer.Server.URL)
	require.NoError(t, err)
	client, err := NewClient(*url, WithBatchSize(2))
	require.NoError(t, err)

	info, err := client.LoadModel(ctx, model, true, nil)
	require.NoError(t, err)
	require.Equal(t, 384, info.Dimensions)
	require.Equal(t, 2048, info.ContextSize)

	inputs := []string{"alpha", "bravo", "charlie", "delta", "echo"}
	embeddings, err := client.Embed(ctx, inputs)
	require.NoError(t, err)
	require.Len(t, embeddings, len(inputs))

	for index, embedding := range embeddings {
		require.Len(t, embedding, 384)
		require.Equal(t, float32(len(inputs[index])), embedding[0])
	}

	mockServer.Mu.Lock()
	defer mockServer.Mu.Unlock()

	require.Empty(t, mockServer.LoadedModels)
	require.Equal(t, []int{2, 2, 1}, mockServer.BatchSizes)
	require.Equal(t, len(inputs), mockServer.SeenEmbeddings)
	require.Equal(t, 1, mockServer.ShowRequests)
}

func TestOllamaClientEmbedEmptyInput(t *testing.T) {
	ctx := t.Context()
	const model = "embeddinggemma"

	mockServer := testutil.NewMockOllamaServer(t)
	t.Cleanup(mockServer.Server.Close)

	url, err := url.Parse(mockServer.Server.URL)
	require.NoError(t, err)
	client, err := NewClient(*url)
	require.NoError(t, err)

	_, err = client.LoadModel(ctx, model, true, nil)
	require.NoError(t, err)
	embeddings, err := client.Embed(ctx, nil)
	require.NoError(t, err)
	require.Empty(t, embeddings)
}

func TestOllamaClientEmbedRequiresModel(t *testing.T) {
	ctx := t.Context()

	url, err := url.Parse("http://example.com")
	require.NoError(t, err)
	client, err := NewClient(*url)
	//client, err := NewClient("file:///home/julio/Documents/seed/backend/llm/backends/ollama/ollama.go")
	require.NoError(t, err)

	_, err = client.Embed(ctx, []string{"alpha"})
	require.Error(t, err)
	require.Contains(t, err.Error(), "LoadModel")
}

func TestOllamaClientEmbed_WaitsBetweenFullBatches(t *testing.T) {
	ctx, cancel := context.WithTimeout(t.Context(), 50*time.Millisecond)
	defer cancel()

	const model = "embeddinggemma"
	mockServer := testutil.NewMockOllamaServer(t)
	t.Cleanup(mockServer.Server.Close)

	url, err := url.Parse(mockServer.Server.URL)
	require.NoError(t, err)
	client, err := NewClient(
		*url,
		WithBatchSize(2),
		WithWaitBetweenBatches(5*time.Second),
	)
	require.NoError(t, err)

	_, err = client.LoadModel(ctx, model, true, nil)
	require.NoError(t, err)

	// Two full batches (2 + 2). The client must wait before the 2nd batch.
	_, err = client.Embed(ctx, []string{"a", "b", "c", "d"})
	require.Error(t, err)
	require.ErrorIs(t, err, context.DeadlineExceeded)

	mockServer.Mu.Lock()
	defer mockServer.Mu.Unlock()
	require.Equal(t, 1, mockServer.EmbedRequests, "second embed request must not be sent once ctx expires during wait")
}
