package telemetry

import (
	"context"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	telemetrypb "seed/backend/genproto/telemetry/v1alpha"

	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
)

func newTestServer(t *testing.T, capacity int) (*Server, *fakeClock) {
	t.Helper()
	clk := &fakeClock{t: time.Unix(1_700_000_000, 0)}
	s := NewServerWithCapacity(zap.NewNop(), capacity)
	s.Now = clk.Now
	return s, clk
}

type fakeClock struct {
	mu sync.Mutex
	t  time.Time
}

func (c *fakeClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.t
}

func (c *fakeClock) Advance(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.t = c.t.Add(d)
}

func TestRecordAndJoinAcrossProcesses(t *testing.T) {
	s, clk := newTestServer(t, 100)
	key := "hm://abc/doc?v=cidA"

	// Backend stamps.
	s.RecordCheckpoint(key, StageBlobIndexed, clk.Now())
	clk.Advance(5 * time.Millisecond)
	s.RecordCheckpoint(key, StageFeedEmitted, clk.Now())

	// Main process stamps.
	clk.Advance(10 * time.Millisecond)
	s.RecordCheckpoint(key, StageFeedEventReceived, clk.Now())
	clk.Advance(2 * time.Millisecond)
	s.RecordCheckpoint(key, StageInvalidationBroadcast, clk.Now())

	// Renderer stamps.
	clk.Advance(3 * time.Millisecond)
	s.RecordCheckpoint(key, StageInvalidationReceived, clk.Now())
	clk.Advance(8 * time.Millisecond)
	s.RecordCheckpoint(key, StageRefetchStart, clk.Now())
	clk.Advance(20 * time.Millisecond)
	s.RecordCheckpoint(key, StageCacheUpdated, clk.Now())
	clk.Advance(4 * time.Millisecond)
	s.RecordCheckpoint(key, StageComponentRendered, clk.Now())

	snap := s.Snapshot()
	require.Len(t, snap, 1)
	tr := snap[0]
	require.Equal(t, key, tr.Key)
	require.Equal(t, 1, tr.Gen)
	require.Equal(t, StatusComplete, tr.Status)
	require.Len(t, tr.Checkpoints, 8)
	require.Equal(t, StageBlobIndexed, tr.Checkpoints[0].Stage)
	require.Equal(t, StageComponentRendered, tr.Checkpoints[len(tr.Checkpoints)-1].Stage)
}

func TestRetryOpensNewGeneration(t *testing.T) {
	s, clk := newTestServer(t, 100)
	key := "hm://abc/doc?v=cid1"

	// First attempt dies after refetch_start.
	s.RecordCheckpoint(key, StageGRPCCallStart, clk.Now())
	clk.Advance(5 * time.Millisecond)
	s.RecordCheckpoint(key, StageRefetchStart, clk.Now())

	// Retry: a fresh grpc_call_start is an initiating stage and must open
	// gen 2 without polluting gen 1.
	clk.Advance(1 * time.Second)
	s.RecordCheckpoint(key, StageGRPCCallStart, clk.Now())
	clk.Advance(3 * time.Millisecond)
	s.RecordCheckpoint(key, StageGRPCCallEnd, clk.Now())
	clk.Advance(1 * time.Millisecond)
	s.RecordCheckpoint(key, StageCacheUpdated, clk.Now())
	clk.Advance(1 * time.Millisecond)
	s.RecordCheckpoint(key, StageComponentRendered, clk.Now())

	snap := s.Snapshot()
	require.Len(t, snap, 2)

	byGen := map[int]Trace{}
	for _, tr := range snap {
		byGen[tr.Gen] = tr
	}

	// Gen 1 is sealed as abandoned (initiating stamp arrived before timeout).
	require.Equal(t, StatusAbandoned, byGen[1].Status)
	require.Len(t, byGen[1].Checkpoints, 2)
	require.Equal(t, StageRefetchStart, byGen[1].Checkpoints[len(byGen[1].Checkpoints)-1].Stage)

	// Gen 2 completes normally.
	require.Equal(t, StatusComplete, byGen[2].Status)
	require.Equal(t, StageComponentRendered, byGen[2].Checkpoints[len(byGen[2].Checkpoints)-1].Stage)
}

func TestAbandonTimeoutClassification(t *testing.T) {
	s, clk := newTestServer(t, 100)
	key := "hm://abc/doc?v=cidT"

	s.RecordCheckpoint(key, StageBlobIndexed, clk.Now())
	clk.Advance(50 * time.Millisecond)
	s.RecordCheckpoint(key, StageFeedEmitted, clk.Now())

	// Advance past the abandon timeout without further stamps.
	clk.Advance(AbandonTimeout + time.Second)

	snap := s.Snapshot()
	require.Len(t, snap, 1)
	require.Equal(t, StatusAbandoned, snap[0].Status)
}

func TestSupersededBy(t *testing.T) {
	s, clk := newTestServer(t, 100)
	key := "hm://abc/doc?v=cidS"

	s.RecordCheckpoint(key, StageFeedEventReceived, clk.Now())
	clk.Advance(1 * time.Millisecond)
	s.RecordCheckpoint(key, StageInvalidationBroadcast, clk.Now())

	// Another change for the same resource arrives; the older gen is
	// explicitly superseded.
	clk.Advance(2 * time.Millisecond)
	s.RecordCheckpoint(key, StageSupersededBy, clk.Now())

	snap := s.Snapshot()
	require.Len(t, snap, 1)
	require.Equal(t, StatusCoalesced, snap[0].Status)
	// superseded_by is consumed, not appended.
	require.Len(t, snap[0].Checkpoints, 2)
}

func TestLRUEviction(t *testing.T) {
	s, _ := newTestServer(t, 5)

	for i := 0; i < 20; i++ {
		key := "hm://acc/p" + itoa(i) + "?v=cidX"
		s.RecordCheckpoint(key, StageBlobIndexed, time.Unix(int64(i), 0))
	}

	snap := s.Snapshot()
	require.Len(t, snap, 5, "ring buffer must cap at maxTraces")

	// The most recently written 5 keys should be the survivors.
	got := map[string]bool{}
	for _, tr := range snap {
		got[tr.Key] = true
	}
	for i := 15; i < 20; i++ {
		key := "hm://acc/p" + itoa(i) + "?v=cidX"
		require.True(t, got[key], "expected recent key %s to survive eviction", key)
	}
}

func TestRecordCheckpointsRPC(t *testing.T) {
	s, _ := newTestServer(t, 100)

	req := &telemetrypb.RecordCheckpointsRequest{
		Source: "renderer:1",
		Checkpoints: []*telemetrypb.Checkpoint{
			{Key: "hm://abc/x?v=c1", Stage: StageGRPCCallStart, TsUnixNanos: 1_000_000},
			{Key: "hm://abc/x?v=c1", Stage: StageGRPCCallEnd, TsUnixNanos: 2_000_000},
			// Empty entries are silently dropped.
			nil,
			{Key: "", Stage: "x", TsUnixNanos: 3},
			{Key: "k", Stage: "", TsUnixNanos: 4},
		},
	}

	resp, err := s.RecordCheckpoints(context.Background(), req)
	require.NoError(t, err)
	require.NotNil(t, resp)

	snap := s.Snapshot()
	require.Len(t, snap, 1)
	require.Len(t, snap[0].Checkpoints, 2)
}

func TestConcurrentRecord(t *testing.T) {
	s, _ := newTestServer(t, 1000)
	const workers = 16
	const perWorker = 200

	var wg sync.WaitGroup
	wg.Add(workers)
	var written int64
	for w := 0; w < workers; w++ {
		w := w
		go func() {
			defer wg.Done()
			for i := 0; i < perWorker; i++ {
				key := "hm://w" + itoa(w) + "/p?v=c" + itoa(i)
				s.RecordCheckpoint(key, StageBlobIndexed, time.Unix(int64(i), 0))
				atomic.AddInt64(&written, 1)
			}
		}()
	}
	wg.Wait()

	snap := s.Snapshot()
	require.LessOrEqual(t, len(snap), 1000)
	require.Greater(t, len(snap), 0)
	require.EqualValues(t, workers*perWorker, written)
}
