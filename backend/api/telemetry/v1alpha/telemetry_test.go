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

// TestRecordAndJoinAcrossProcesses verifies that a single key can carry
// checkpoints from multiple processes (backend + renderer) and seal as
// complete when the renderer paints.
func TestRecordAndJoinAcrossProcesses(t *testing.T) {
	s, clk := newTestServer(t, 100)
	key := "hm://abc/doc"

	// User clicks a link (renderer).
	s.RecordCheckpoint(key, StageLinkClick, clk.Now())
	clk.Advance(5 * time.Millisecond)

	// Daemon fields the GetDocument RPC.
	s.RecordCheckpoint(key, StageGRPCRequestReceived, clk.Now())
	clk.Advance(20 * time.Millisecond)
	s.RecordCheckpoint(key, StageGRPCResponseSent, clk.Now())
	clk.Advance(4 * time.Millisecond)

	// Renderer paints.
	s.RecordCheckpoint(key, StageComponentRendered, clk.Now())

	snap := s.Snapshot()
	require.Len(t, snap, 1)
	tr := snap[0]
	require.Equal(t, key, tr.Key)
	require.Equal(t, 1, tr.Gen)
	require.Equal(t, StatusComplete, tr.Status)
	require.Len(t, tr.Checkpoints, 4)
	require.Equal(t, StageLinkClick, tr.Checkpoints[0].Stage)
	require.Equal(t, StageComponentRendered, tr.Checkpoints[len(tr.Checkpoints)-1].Stage)
}

// TestRetryOpensNewGeneration verifies that a second initiating stamp
// (e.g. the user clicks the same link again) seals the previous live
// generation as abandoned and starts gen 2.
func TestRetryOpensNewGeneration(t *testing.T) {
	s, clk := newTestServer(t, 100)
	key := "hm://abc/doc"

	// First attempt dies after backend responds — renderer never paints.
	s.RecordCheckpoint(key, StageLinkClick, clk.Now())
	clk.Advance(5 * time.Millisecond)
	s.RecordCheckpoint(key, StageGRPCRequestReceived, clk.Now())
	clk.Advance(20 * time.Millisecond)
	s.RecordCheckpoint(key, StageGRPCResponseSent, clk.Now())

	// User clicks again before the abandon timeout. A fresh link_click is
	// an initiating stamp and must open gen 2 without polluting gen 1.
	clk.Advance(1 * time.Second)
	s.RecordCheckpoint(key, StageLinkClick, clk.Now())
	clk.Advance(3 * time.Millisecond)
	s.RecordCheckpoint(key, StageComponentRendered, clk.Now())

	snap := s.Snapshot()
	require.Len(t, snap, 2)

	byGen := map[int]Trace{}
	for _, tr := range snap {
		byGen[tr.Gen] = tr
	}

	// Gen 1 is sealed as abandoned (initiating stamp arrived before timeout).
	require.Equal(t, StatusAbandoned, byGen[1].Status)
	require.Len(t, byGen[1].Checkpoints, 3)
	require.Equal(t, StageGRPCResponseSent, byGen[1].Checkpoints[len(byGen[1].Checkpoints)-1].Stage)

	// Gen 2 completes normally.
	require.Equal(t, StatusComplete, byGen[2].Status)
	require.Equal(t, StageComponentRendered, byGen[2].Checkpoints[len(byGen[2].Checkpoints)-1].Stage)
}

// TestLinkClickOpensNewGeneration verifies the simple click→render path
// works repeatedly for the same key.
func TestLinkClickOpensNewGeneration(t *testing.T) {
	s, clk := newTestServer(t, 100)
	key := "hm://abc/doc"

	s.RecordCheckpoint(key, StageLinkClick, clk.Now())
	clk.Advance(5 * time.Millisecond)
	s.RecordCheckpoint(key, StageComponentRendered, clk.Now())

	clk.Advance(250 * time.Millisecond)
	s.RecordCheckpoint(key, StageLinkClick, clk.Now())
	clk.Advance(10 * time.Millisecond)
	s.RecordCheckpoint(key, StageComponentRendered, clk.Now())

	snap := s.Snapshot()
	require.Len(t, snap, 2)

	byGen := map[int]Trace{}
	for _, tr := range snap {
		byGen[tr.Gen] = tr
	}

	require.Equal(t, StatusComplete, byGen[1].Status)
	require.Equal(t, StageLinkClick, byGen[1].Checkpoints[0].Stage)
	require.Equal(t, StatusComplete, byGen[2].Status)
	require.Equal(t, StageLinkClick, byGen[2].Checkpoints[0].Stage)
}

// TestPrefetchThenClickAppendsToSameGen verifies that an initiating
// stamp (link_click) arriving on a live trace that has only backend
// stages merges into that trace instead of opening gen 2. This models
// the common case where a sidebar or hover preview pre-fetches a
// document before the user clicks the link.
func TestPrefetchThenClickAppendsToSameGen(t *testing.T) {
	s, clk := newTestServer(t, 100)
	key := "hm://abc/doc"

	// Background prefetch.
	s.RecordCheckpoint(key, StageGRPCRequestReceived, clk.Now())
	clk.Advance(8 * time.Millisecond)
	s.RecordCheckpoint(key, StageGRPCResponseSent, clk.Now())

	// User clicks shortly after; this is the SAME journey, not a new attempt.
	clk.Advance(120 * time.Millisecond)
	s.RecordCheckpoint(key, StageLinkClick, clk.Now())
	clk.Advance(40 * time.Millisecond)
	s.RecordCheckpoint(key, StageComponentRendered, clk.Now())

	snap := s.Snapshot()
	require.Len(t, snap, 1, "prefetch and click should merge into one generation")
	tr := snap[0]
	require.Equal(t, 1, tr.Gen)
	require.Equal(t, StatusComplete, tr.Status)
	require.Len(t, tr.Checkpoints, 4)
	require.Equal(t, StageGRPCRequestReceived, tr.Checkpoints[0].Stage)
	require.Equal(t, StageGRPCResponseSent, tr.Checkpoints[1].Stage)
	require.Equal(t, StageLinkClick, tr.Checkpoints[2].Stage)
	require.Equal(t, StageComponentRendered, tr.Checkpoints[3].Stage)
}

// TestOrphanRenderWithoutCause verifies that a trace built solely from
// renderer.component_rendered (e.g. window restore or React Query cache
// hit) seals as StatusOrphan rather than StatusComplete, so the page
// doesn't dishonestly claim an end-to-end journey was observed.
func TestOrphanRenderWithoutCause(t *testing.T) {
	s, clk := newTestServer(t, 100)
	key := "hm://abc/doc"

	s.RecordCheckpoint(key, StageComponentRendered, clk.Now())

	snap := s.Snapshot()
	require.Len(t, snap, 1)
	tr := snap[0]
	require.Equal(t, StatusOrphan, tr.Status)
	require.Len(t, tr.Checkpoints, 1)
	require.Equal(t, StageComponentRendered, tr.Checkpoints[0].Stage)
}

// TestAbandonTimeoutClassification verifies that a trace which never
// progresses past its first stage gets reclassified as abandoned at
// Snapshot read time after AbandonTimeout.
func TestAbandonTimeoutClassification(t *testing.T) {
	s, clk := newTestServer(t, 100)
	key := "hm://abc/doc"

	s.RecordCheckpoint(key, StageFeedEmitted, clk.Now())

	// Advance past the abandon timeout without further stamps.
	clk.Advance(AbandonTimeout + time.Second)

	snap := s.Snapshot()
	require.Len(t, snap, 1)
	require.Equal(t, StatusAbandoned, snap[0].Status)
}

// TestLRUEviction verifies the ring buffer drops the oldest entries
// once capacity is reached.
func TestLRUEviction(t *testing.T) {
	s, _ := newTestServer(t, 5)

	for i := 0; i < 20; i++ {
		key := "hm://acc/p" + itoa(i)
		s.RecordCheckpoint(key, StageFeedEmitted, time.Unix(int64(i), 0))
	}

	snap := s.Snapshot()
	require.Len(t, snap, 5, "ring buffer must cap at maxTraces")

	// The most recently written 5 keys should be the survivors.
	got := map[string]bool{}
	for _, tr := range snap {
		got[tr.Key] = true
	}
	for i := 15; i < 20; i++ {
		key := "hm://acc/p" + itoa(i)
		require.True(t, got[key], "expected recent key %s to survive eviction", key)
	}
}

// TestRecordCheckpointsRPC verifies the gRPC entry point passes through
// to RecordCheckpoint and silently drops malformed entries.
func TestRecordCheckpointsRPC(t *testing.T) {
	s, _ := newTestServer(t, 100)

	req := &telemetrypb.RecordCheckpointsRequest{
		Source: "renderer:1",
		Checkpoints: []*telemetrypb.Checkpoint{
			{Key: "hm://abc/x", Stage: StageLinkClick, TsUnixNanos: 1_000_000},
			{Key: "hm://abc/x", Stage: StageComponentRendered, TsUnixNanos: 2_000_000},
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

// TestConcurrentRecord exercises the mutex under heavy parallel write
// load to catch races and lost updates.
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
				key := "hm://w" + itoa(w) + "/p" + itoa(i)
				s.RecordCheckpoint(key, StageFeedEmitted, time.Unix(int64(i), 0))
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
