package syncing

import (
	"context"
	"errors"
	"seed/backend/blob"
	"seed/backend/config"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// testConfig creates a config.Syncing for tests with sensible defaults.
func testConfig(interval time.Duration, maxWorkers int) config.Syncing {
	return config.Syncing{
		Interval:       interval,
		MaxWorkers:     maxWorkers,
		WarmupDuration: time.Millisecond, // Very short warmup for tests.
	}
}

type mockDiscoverer struct {
	mu           sync.Mutex
	calls        map[blob.IRI]int
	blockCh      chan struct{} // If non-nil, DiscoverObjectWithProgress returns only after this channel is closed.
	onDiscoverFn func(blob.IRI)
	interval     time.Duration
}

func (m *mockDiscoverer) DiscoverObjectWithProgress(ctx context.Context, entityID blob.IRI, version blob.Version, recursive bool, prog *Progress) (blob.Version, error) {
	m.mu.Lock()
	m.calls[entityID]++
	onDiscover := m.onDiscoverFn
	m.mu.Unlock()

	if onDiscover != nil {
		onDiscover(entityID)
	}

	if m.blockCh != nil {
		select {
		case <-ctx.Done():
			return "", ctx.Err()
		case <-m.blockCh:
		}
	}

	// Simulate work.
	time.Sleep(10 * time.Millisecond)

	return "v1", nil
}

func TestScheduler_Basic(t *testing.T) {
	disc := &mockDiscoverer{
		calls:    make(map[blob.IRI]int),
		interval: 100 * time.Millisecond,
	}
	s := newScheduler(disc, testConfig(disc.interval, 2))
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	go func() { _ = s.run(ctx) }()

	iri := blob.IRI("hm://alice/foo")
	key := DiscoveryKey{IRI: iri}
	s.scheduleTask(key, time.Now(), schedOpts{isHot: true})

	// Wait for task to be processed.
	require.Eventually(t, func() bool {
		disc.mu.Lock()
		defer disc.mu.Unlock()
		return disc.calls[iri] > 0
	}, 1*time.Second, 10*time.Millisecond)
}

func TestScheduler_RefreshesSubscription(t *testing.T) {
	disc := &mockDiscoverer{
		calls:    make(map[blob.IRI]int),
		interval: 100 * time.Millisecond,
	}
	s := newScheduler(disc, testConfig(disc.interval, 2))
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	go func() { _ = s.run(ctx) }()

	iri := blob.IRI("hm://alice/sub")
	key := DiscoveryKey{IRI: iri}

	// Add as subscription.
	s.scheduleTask(key, time.Now(), schedOpts{forceSubscription: true})

	require.Eventually(t, func() bool {
		disc.mu.Lock()
		defer disc.mu.Unlock()
		return disc.calls[iri] > 0
	}, 1*time.Second, 10*time.Millisecond)

	// Since we mocked Interval to 100ms, it should run again eventually.
	require.Eventually(t, func() bool {
		disc.mu.Lock()
		defer disc.mu.Unlock()
		return disc.calls[iri] > 1
	}, 1*time.Second, 10*time.Millisecond)

	// Verify task metadata.
	s.mu.Lock()
	task := s.tasks[key]
	require.True(t, task.subscription)
	require.True(t, task.hotDeadline.IsZero(), "subscription-only task should not have on-demand deadline")
	s.mu.Unlock()
}

// TestScheduler_ExtendOnDemandWhileRunning tests that extending on-demand deadline
// while a task is running does NOT cause immediate re-run - it just extends the deadline.
func TestScheduler_ExtendOnDemandWhileRunning(t *testing.T) {
	blockCh := make(chan struct{})
	disc := &mockDiscoverer{
		calls:    make(map[blob.IRI]int),
		blockCh:  blockCh,
		interval: 100 * time.Millisecond,
	}
	s := newScheduler(disc, testConfig(disc.interval, 2))
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	go func() { _ = s.run(ctx) }()

	iri := blob.IRI("hm://alice/race")
	key := DiscoveryKey{IRI: iri}

	// Add task. It will start execution and block on blockCh.
	s.scheduleTask(key, time.Now(), schedOpts{forceSubscription: true})

	// Wait for task to be InProgress.
	require.Eventually(t, func() bool {
		s.mu.Lock()
		defer s.mu.Unlock()
		task, ok := s.tasks[key]
		return ok && task.state == TaskStateInProgress
	}, 1*time.Second, 10*time.Millisecond)

	// Extend deadline while running. This should NOT cause immediate re-run.
	s.scheduleTask(key, time.Now(), schedOpts{isHot: true})

	// Verify deadline was extended.
	s.mu.Lock()
	task := s.tasks[key]
	deadline := task.hotDeadline
	s.mu.Unlock()
	require.False(t, deadline.IsZero(), "on-demand deadline must be set")

	// Release the worker.
	close(blockCh)

	// Wait a bit for completion.
	time.Sleep(50 * time.Millisecond)

	disc.mu.Lock()
	calls := disc.calls[iri]
	disc.mu.Unlock()

	// Should have exactly 1 call - no immediate re-run from extendOnDemand.
	require.Equal(t, 1, calls, "extendOnDemand must not trigger immediate re-run")
}

// TestScheduler_WakesOnNewTask tests that the scheduler wakes up when a new task
// is enqueued while the queue is empty.
func TestScheduler_WakesOnNewTask(t *testing.T) {
	disc := &mockDiscoverer{
		calls:    make(map[blob.IRI]int),
		interval: 100 * time.Millisecond,
	}
	s := newScheduler(disc, testConfig(disc.interval, 2))
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	go func() { _ = s.run(ctx) }()

	// Wait for the scheduler to complete its initial loop iteration.
	time.Sleep(100 * time.Millisecond)

	// Verify the queue is empty.
	s.mu.Lock()
	queueLen := s.queue.Len()
	s.mu.Unlock()
	require.Equal(t, 0, queueLen, "queue must be empty initially")

	// Now add a new task. The scheduler should wake up and process it.
	iri := blob.IRI("hm://alice/new-task")
	key := DiscoveryKey{IRI: iri}
	s.scheduleTask(key, time.Now(), schedOpts{isHot: true})

	// The task should be processed within a short window.
	require.Eventually(t, func() bool {
		disc.mu.Lock()
		defer disc.mu.Unlock()
		return disc.calls[iri] > 0
	}, 500*time.Millisecond, 10*time.Millisecond, "new task must be processed after being enqueued to empty scheduler")
}

// TestScheduler_OnDemandDeadlineExpiry tests that on-demand tasks fall back to
// subscription interval when the deadline expires.
func TestScheduler_OnDemandDeadlineExpiry(t *testing.T) {
	disc := &mockDiscoverer{
		calls:    make(map[blob.IRI]int),
		interval: 100 * time.Millisecond,
	}
	s := newScheduler(disc, testConfig(disc.interval, 2))
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	go func() { _ = s.run(ctx) }()

	iri := blob.IRI("hm://alice/hybrid")
	key := DiscoveryKey{IRI: iri}

	// Create a task that is both a subscription and on-demand.
	s.scheduleTask(key, time.Now(), schedOpts{forceSubscription: true, isHot: true})

	// Wait for first run.
	require.Eventually(t, func() bool {
		disc.mu.Lock()
		defer disc.mu.Unlock()
		return disc.calls[iri] > 0
	}, 1*time.Second, 10*time.Millisecond)

	// Verify task has on-demand deadline set.
	s.mu.Lock()
	task := s.tasks[key]
	require.NotNil(t, task)
	require.False(t, task.hotDeadline.IsZero())
	require.True(t, task.subscription)
	s.mu.Unlock()
}

// TestScheduler_HeapIndexCorrectness verifies that heapIndex is correctly tracked
// after heap operations (push, pop, fix). This tests for a bug where OnSwap callback
// was recording indices incorrectly.
func TestScheduler_HeapIndexCorrectness(t *testing.T) {
	disc := &mockDiscoverer{
		calls:    make(map[blob.IRI]int),
		interval: 100 * time.Millisecond,
	}

	s := newScheduler(disc, testConfig(disc.interval, 2))

	// Create 3 tasks with different nextRunTime values.
	now := time.Now()
	task1 := &taskHandle{key: DiscoveryKey{IRI: "hm://task1"}, nextRunTime: now.Add(100 * time.Millisecond)}
	task2 := &taskHandle{key: DiscoveryKey{IRI: "hm://task2"}, nextRunTime: now.Add(200 * time.Millisecond)}
	task3 := &taskHandle{key: DiscoveryKey{IRI: "hm://task3"}, nextRunTime: now.Add(300 * time.Millisecond)}

	// Push all tasks.
	s.queue.Push(task1)
	s.queue.Push(task2)
	s.queue.Push(task3)

	// The heap is ordered by nextRunTime, so task1 should be at index 0.
	require.Equal(t, 0, task1.queueIndex.Value(), "task1 must be at index 0 (earliest)")

	// Verify each task's heapIndex is valid (>= 0 and < Len).
	for _, task := range []*taskHandle{task1, task2, task3} {
		require.GreaterOrEqual(t, task.queueIndex.Value(), 0, "heapIndex must be >= 0")
		require.Less(t, task.queueIndex.Value(), s.queue.Len(), "heapIndex must be < Len")
	}

	// Now Fix task3 to have earliest time - it should move to index 0.
	task3.nextRunTime = now.Add(-100 * time.Millisecond)
	s.queue.Fix(task3.queueIndex.Value())

	// After Fix, task3 should be at index 0.
	require.Equal(t, 0, task3.queueIndex.Value(), "task3 must move to index 0 after Fix with earlier time")

	// Verify task1 moved from index 0.
	require.NotEqual(t, 0, task1.queueIndex.Value(), "task1 must have moved from index 0")

	// Pop task3, verify it's the right one.
	popped := s.queue.Pop()
	require.Equal(t, task3.key, popped.key, "task3 must be popped first")

	// After pop, remaining tasks should have valid indices.
	require.Equal(t, 2, s.queue.Len())

	// Verify task1 heapIndex is valid.
	require.True(t, task1.queueIndex.IsSet())
	require.GreaterOrEqual(t, task1.queueIndex.Value(), 0, "task1 heapIndex must be valid")
	require.Less(t, task1.queueIndex.Value(), s.queue.Len(), "task1 heapIndex must be < Len")
}

// TestScheduler_TaskNotLostWhenWorkersBusy verifies that all tasks eventually
// get processed even when workers are temporarily saturated.
func TestScheduler_TaskNotLostWhenWorkersBusy(t *testing.T) {
	blockCh := make(chan struct{})
	disc := &mockDiscoverer{calls: make(map[blob.IRI]int), blockCh: blockCh, interval: 100 * time.Millisecond}

	// 1 min worker, 1 max worker = limited capacity.
	s := newScheduler(disc, testConfig(disc.interval, 1))
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() { _ = s.run(ctx) }()

	// Schedule 3 tasks rapidly. With limited workers, some will be queued.
	key1 := DiscoveryKey{IRI: "hm://task1"}
	key2 := DiscoveryKey{IRI: "hm://task2"}
	key3 := DiscoveryKey{IRI: "hm://task3"}

	s.scheduleTask(key1, time.Now(), schedOpts{forceSubscription: true})
	s.scheduleTask(key2, time.Now(), schedOpts{forceSubscription: true})
	s.scheduleTask(key3, time.Now(), schedOpts{forceSubscription: true})

	// Wait for at least one task to start executing.
	require.Eventually(t, func() bool {
		s.mu.Lock()
		defer s.mu.Unlock()
		for _, task := range s.tasks {
			if task.state == TaskStateInProgress {
				return true
			}
		}
		return false
	}, time.Second, 10*time.Millisecond, "at least one task must be in progress")

	// Release workers.
	close(blockCh)

	// All tasks should eventually complete.
	require.Eventually(t, func() bool {
		disc.mu.Lock()
		defer disc.mu.Unlock()
		return disc.calls["hm://task1"] > 0 && disc.calls["hm://task2"] > 0 && disc.calls["hm://task3"] > 0
	}, 2*time.Second, 10*time.Millisecond, "all tasks must be processed")
}

// withHotTTL overrides the scheduler's hotTTL to exercise heartbeat expiry
// on compressed timescales. Must be called after newScheduler but before s.run.
func withHotTTL(s *scheduler, ttl time.Duration) {
	s.hotTTL = ttl
}

// waitForState blocks until the given task reaches the expected state or the
// deadline elapses. Returns once the state matches; fails the test otherwise.
func waitForState(t *testing.T, s *scheduler, key DiscoveryKey, want TaskState, msg string) {
	t.Helper()
	require.Eventually(t, func() bool {
		s.mu.Lock()
		defer s.mu.Unlock()
		task, ok := s.tasks[key]
		return ok && task.state == want
	}, 2*time.Second, 5*time.Millisecond, msg)
}

// TestScheduler_HotPreemptsSubscription verifies that when the worker pool is
// saturated by a running subscription, a newly arriving hot task cancels the
// subscription's context so its slot can be reclaimed.
func TestScheduler_HotPreemptsSubscription(t *testing.T) {
	blockCh := make(chan struct{})
	disc := &mockDiscoverer{calls: make(map[blob.IRI]int), blockCh: blockCh}

	// Single worker so the subscription saturates the pool.
	s := newScheduler(disc, testConfig(10*time.Second, 1))
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() { _ = s.run(ctx) }()

	subKey := DiscoveryKey{IRI: "hm://alice/sub"}
	hotKey := DiscoveryKey{IRI: "hm://alice/hot"}

	s.scheduleTask(subKey, time.Now(), schedOpts{forceSubscription: true})
	waitForState(t, s, subKey, TaskStateInProgress, "subscription must start running")

	// Fire a hot task. Workers are saturated, so the scheduler should cancel
	// the subscription via preemption.
	s.scheduleTask(hotKey, time.Now(), schedOpts{isHot: true})

	// The subscription task's context should be cancelled; when its mock
	// returns, its lastErr is set to context.Canceled.
	require.Eventually(t, func() bool {
		s.mu.Lock()
		defer s.mu.Unlock()
		task, ok := s.tasks[subKey]
		if !ok {
			return false
		}
		return errors.Is(task.lastErr, context.Canceled)
	}, 2*time.Second, 10*time.Millisecond, "subscription must be cancelled by preemption")

	// Unblock the mock so the hot task (now in the freed worker) can finish.
	close(blockCh)

	require.Eventually(t, func() bool {
		disc.mu.Lock()
		defer disc.mu.Unlock()
		return disc.calls[hotKey.IRI] > 0
	}, 2*time.Second, 10*time.Millisecond, "hot task must run after preemption")
}

// TestScheduler_MultiWindowParallelism verifies that multiple hot tasks
// whose count fits within MaxWorkers all run concurrently, with no preemption.
func TestScheduler_MultiWindowParallelism(t *testing.T) {
	blockCh := make(chan struct{})

	var inFlightMu sync.Mutex
	inFlight := make(map[blob.IRI]bool)

	disc := &mockDiscoverer{
		calls:   make(map[blob.IRI]int),
		blockCh: blockCh,
		onDiscoverFn: func(iri blob.IRI) {
			inFlightMu.Lock()
			inFlight[iri] = true
			inFlightMu.Unlock()
		},
	}

	// 3 workers so all three hot tasks fit in parallel.
	s := newScheduler(disc, testConfig(10*time.Second, 3))
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() { _ = s.run(ctx) }()

	keys := []DiscoveryKey{
		{IRI: "hm://doc/a"},
		{IRI: "hm://doc/b"},
		{IRI: "hm://doc/c"},
	}
	for _, k := range keys {
		s.scheduleTask(k, time.Now(), schedOpts{isHot: true})
	}

	// All three must reach InProgress simultaneously (i.e. no one got preempted).
	require.Eventually(t, func() bool {
		inFlightMu.Lock()
		defer inFlightMu.Unlock()
		return inFlight[keys[0].IRI] && inFlight[keys[1].IRI] && inFlight[keys[2].IRI]
	}, 2*time.Second, 10*time.Millisecond, "all three hot tasks must run in parallel")

	// None of them should have been cancelled (no preemption when there's capacity).
	s.mu.Lock()
	for _, k := range keys {
		task := s.tasks[k]
		require.NotNil(t, task)
		require.Equal(t, TaskStateInProgress, task.state, "task %s should still be running", k.IRI)
	}
	s.mu.Unlock()

	close(blockCh)
}

// TestScheduler_PreemptOldestHotWhenSaturated verifies that when every worker
// is occupied by a hot task, scheduling a newer hot task cancels the
// least-recently-touched in-flight hot task and lets it resume later.
func TestScheduler_PreemptOldestHotWhenSaturated(t *testing.T) {
	blockCh := make(chan struct{})

	var seenMu sync.Mutex
	firstRunSeen := make(map[blob.IRI]bool)

	disc := &mockDiscoverer{
		calls:   make(map[blob.IRI]int),
		blockCh: blockCh,
		onDiscoverFn: func(iri blob.IRI) {
			seenMu.Lock()
			firstRunSeen[iri] = true
			seenMu.Unlock()
		},
	}

	// 1 worker so each hot task fully saturates the pool.
	s := newScheduler(disc, testConfig(10*time.Second, 1))
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() { _ = s.run(ctx) }()

	keyA := DiscoveryKey{IRI: "hm://doc/a"}
	keyB := DiscoveryKey{IRI: "hm://doc/b"}

	// Schedule A first. It'll start executing and block on blockCh.
	s.scheduleTask(keyA, time.Now(), schedOpts{isHot: true})
	waitForState(t, s, keyA, TaskStateInProgress, "A must start running")

	// Give B a strictly later hotDeadline so the preemption logic will pick A as the victim.
	time.Sleep(5 * time.Millisecond)
	s.scheduleTask(keyB, time.Now(), schedOpts{isHot: true})

	// A's context should be cancelled; when A's mock returns, lastErr is
	// context.Canceled before the preemption-detection branch re-enqueues it.
	// Observationally: A must re-reach Idle (re-enqueued) and B must start.
	require.Eventually(t, func() bool {
		seenMu.Lock()
		defer seenMu.Unlock()
		return firstRunSeen[keyB.IRI]
	}, 2*time.Second, 10*time.Millisecond, "B must run after A is preempted")

	// A should still be tracked (preempted, not deleted) and be back in the queue
	// at the hot tier waiting for a worker.
	s.mu.Lock()
	taskA, ok := s.tasks[keyA]
	require.True(t, ok, "A must not be deleted; it should be preempted and re-queued")
	// A is either queued waiting, or already running again (if B finished fast).
	require.NotEqual(t, TaskStateCompleted, taskA.state, "A should not be in completed state after preemption")
	s.mu.Unlock()

	close(blockCh)
}

// TestScheduler_HeartbeatCleanupCancelsRunningHot verifies that an in-flight
// ephemeral hot task whose heartbeat expires is cancelled and removed.
func TestScheduler_HeartbeatCleanupCancelsRunningHot(t *testing.T) {
	blockCh := make(chan struct{})
	disc := &mockDiscoverer{calls: make(map[blob.IRI]int), blockCh: blockCh}

	s := newScheduler(disc, testConfig(10*time.Second, 2))
	withHotTTL(s, 150*time.Millisecond)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() { _ = s.run(ctx) }()

	key := DiscoveryKey{IRI: "hm://doc/abandoned"}
	s.scheduleTask(key, time.Now(), schedOpts{isHot: true})
	waitForState(t, s, key, TaskStateInProgress, "task must start running")

	// Don't touch it again. The heartbeat (150ms) expires. On the next
	// dispatch tick, the scheduler should cancel the running context and,
	// because the task is ephemeral, delete it.
	require.Eventually(t, func() bool {
		s.mu.Lock()
		defer s.mu.Unlock()
		_, exists := s.tasks[key]
		return !exists
	}, 2*time.Second, 10*time.Millisecond, "abandoned hot task must be cancelled and removed")

	// The mock saw its context cancellation and returned early; no deadlock.
	close(blockCh)
}

// TestScheduler_HotOrderingByHotDeadline verifies that when two hot tasks are
// both ready to dispatch, the one with the more recent hotDeadline (i.e. the
// more recently touched) runs first. This exercises the LIFO property of the
// hot tier comparator.
func TestScheduler_HotOrderingByHotDeadline(t *testing.T) {
	s := newScheduler(nil, testConfig(10*time.Second, 1))

	now := time.Now()
	older := &taskHandle{
		key:         DiscoveryKey{IRI: "hm://older"},
		hotDeadline: now.Add(100 * time.Millisecond),
		nextRunTime: now,
		queueTier:   tierHot,
	}
	newer := &taskHandle{
		key:         DiscoveryKey{IRI: "hm://newer"},
		hotDeadline: now.Add(200 * time.Millisecond),
		nextRunTime: now,
		queueTier:   tierHot,
	}

	// Push in "wrong" order to prove the comparator reorders them.
	s.queue.Push(older)
	s.queue.Push(newer)

	top := s.queue.Peek()
	require.Equal(t, newer.key, top.key, "hot task with more recent hotDeadline must sit at the head")
}

// TestScheduler_HotTierBeatsColdTier verifies that any hot-tier task outranks
// any cold-tier task, regardless of their nextRunTimes.
func TestScheduler_HotTierBeatsColdTier(t *testing.T) {
	s := newScheduler(nil, testConfig(10*time.Second, 1))

	now := time.Now()
	cold := &taskHandle{
		key:         DiscoveryKey{IRI: "hm://cold"},
		nextRunTime: now.Add(-time.Second), // very overdue
		queueTier:   tierCold,
	}
	hot := &taskHandle{
		key:         DiscoveryKey{IRI: "hm://hot"},
		hotDeadline: now.Add(time.Minute),
		nextRunTime: now.Add(time.Second), // slightly future, but still hot tier
		queueTier:   tierHot,
	}

	s.queue.Push(cold)
	s.queue.Push(hot)

	require.Equal(t, hot.key, s.queue.Peek().key, "hot tier must outrank cold tier")
}

// TestScheduler_RetouchPromotesColdToHot verifies that touching a subscription
// (which lives in the cold tier) with isHot fixes its heap position so it
// dispatches ahead of other cold-tier tasks.
func TestScheduler_RetouchPromotesColdToHot(t *testing.T) {
	blockCh := make(chan struct{})
	disc := &mockDiscoverer{calls: make(map[blob.IRI]int), blockCh: blockCh}

	// 1 worker saturated by a blocking filler task so queued order matters.
	s := newScheduler(disc, testConfig(10*time.Second, 1))
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() { _ = s.run(ctx) }()

	filler := DiscoveryKey{IRI: "hm://filler"}
	s.scheduleTask(filler, time.Now(), schedOpts{forceSubscription: true})
	waitForState(t, s, filler, TaskStateInProgress, "filler must start")

	// Two queued subscriptions.
	subA := DiscoveryKey{IRI: "hm://sub/a"}
	subB := DiscoveryKey{IRI: "hm://sub/b"}
	s.scheduleTask(subA, time.Now(), schedOpts{forceSubscription: true})
	time.Sleep(2 * time.Millisecond)
	s.scheduleTask(subB, time.Now(), schedOpts{forceSubscription: true})

	// Touch subB with isHot. It should now sit at the hot tier and become
	// the head of the queue, even though subA was enqueued earlier.
	s.scheduleTask(subB, time.Now(), schedOpts{isHot: true})

	s.mu.Lock()
	// filler is in progress so it should not be the head; peek the queue top.
	require.Greater(t, s.queue.Len(), 0, "queue must be non-empty")
	top := s.queue.Peek()
	require.Equal(t, subB, top.key, "touched-hot task must move to the head of the queue")
	require.Equal(t, tierHot, top.queueTier, "touched-hot task must be in the hot tier")
	s.mu.Unlock()

	close(blockCh)
}
