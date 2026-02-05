package llamacpp

import (
	"context"
	"math"
	"net/url"
	"seed/backend/daemon/taskmanager"
	"seed/backend/testutil"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestLlamaCppClientEmbeddings(t *testing.T) {
	testutil.Manual(t)
	ctx := t.Context()
	client, err := NewClient(url.URL{}, WithBatchSize(2))
	require.NoError(t, err)
	t.Cleanup(func() { _ = client.CloseModel(ctx) })

	info, err := client.LoadModel(ctx, "", false, taskmanager.NewTaskManager())
	require.NoError(t, err)
	require.Greater(t, info.Dimensions, 0)
	require.Greater(t, info.ContextSize, 0)

	inputs := []string{"alpha", "bravo", "charlie", "delta", "echo"}
	embeddings, err := client.Embed(ctx, inputs)
	require.NoError(t, err)
	require.Len(t, embeddings, len(inputs))
	require.Len(t, embeddings, len(inputs))

	for i, embedding := range embeddings {
		require.Len(t, embedding, info.Dimensions)
		// Calculate L2 norm (magnitude)
		var magnitude float32
		for _, val := range embedding {
			magnitude += val * val
		}
		norm := float32(math.Sqrt(float64(magnitude)))

		// Post-normalization L2 norm should be ~1.0
		require.InDelta(t, 1.0, norm, 0.0001, "embedding %d should have L2 norm of 1.0, got %.6f", i, norm)
	}
}

func TestLlamaCppClientEmbedEmptyInput(t *testing.T) {
	testutil.Manual(t)
	ctx := t.Context()
	client, err := NewClient(url.URL{})
	require.NoError(t, err)
	t.Cleanup(func() { _ = client.CloseModel(ctx) })

	_, err = client.LoadModel(ctx, "", false, taskmanager.NewTaskManager())
	require.NoError(t, err)
	embeddings, err := client.Embed(ctx, nil)
	require.NoError(t, err)
	require.Empty(t, embeddings)
}

func TestLlamaCppClientRequiresFileScheme(t *testing.T) {
	httpURL, err := url.Parse("http://example.com")
	require.NoError(t, err)
	_, err = NewClient(*httpURL)
	require.Error(t, err)
	require.Contains(t, err.Error(), "file")
}

func TestLlamaCppClientBatchSizeMustBePositive(t *testing.T) {
	_, err := NewClient(url.URL{}, WithBatchSize(0))
	require.Error(t, err)
	require.Contains(t, err.Error(), "positive")
}

func TestLlamaCppClientEmbed_WaitsBetweenFullBatches(t *testing.T) {
	testutil.Manual(t)
	ctx, cancel := context.WithTimeout(t.Context(), 50*time.Millisecond)
	defer cancel()

	client, err := NewClient(
		url.URL{},
		WithBatchSize(2),
		WithWaitBetweenBatches(5*time.Second),
	)
	require.NoError(t, err)
	t.Cleanup(func() { _ = client.CloseModel(context.Background()) })

	_, err = client.LoadModel(ctx, "", false, taskmanager.NewTaskManager())
	require.NoError(t, err)

	// Two full batches (2 + 2). The client must wait before the 2nd batch.
	_, err = client.Embed(ctx, []string{"a", "b", "c", "d"})
	require.Error(t, err)
	require.ErrorIs(t, err, context.DeadlineExceeded)
}

func TestNormalizeFunction(t *testing.T) {
	// Test the normalize function directly with known values
	vectors := [][]float32{
		{3.0, 4.0},      // norm = 5, normalized = {0.6, 0.8}
		{1.0, 0.0, 0.0}, // norm = 1, normalized = {1, 0, 0}
		{2.0, 2.0, 1.0}, // norm = 3, normalized = {2/3, 2/3, 1/3}
	}

	result := normalize(vectors)

	// First vector: [3,4] -> norm=5 -> [0.6, 0.8]
	require.InDelta(t, 0.6, result[0][0], 0.0001)
	require.InDelta(t, 0.8, result[0][1], 0.0001)

	// Second vector: [1,0,0] -> norm=1 -> [1, 0, 0]
	require.InDelta(t, 1.0, result[1][0], 0.0001)
	require.InDelta(t, 0.0, result[1][1], 0.0001)
	require.InDelta(t, 0.0, result[1][2], 0.0001)

	// Third vector: [2,2,1] -> norm=3 -> [2/3, 2/3, 1/3]
	require.InDelta(t, 2.0/3.0, result[2][0], 0.0001)
	require.InDelta(t, 2.0/3.0, result[2][1], 0.0001)
	require.InDelta(t, 1.0/3.0, result[2][2], 0.0001)

	// Verify all vectors now have L2 norm of 1.0
	for i, vec := range result {
		var magnitude float32
		for _, val := range vec {
			magnitude += val * val
		}
		norm := float32(math.Sqrt(float64(magnitude)))
		require.InDelta(t, 1.0, norm, 0.0001, "vector %d should have L2 norm of 1.0", i)
	}
}

func TestNormalizeZeroVector(t *testing.T) {
	// Zero vectors should remain zero (avoid division by zero)
	vectors := [][]float32{{0.0, 0.0, 0.0}}
	result := normalize(vectors)

	require.Equal(t, float32(0.0), result[0][0])
	require.Equal(t, float32(0.0), result[0][1])
	require.Equal(t, float32(0.0), result[0][2])
}
