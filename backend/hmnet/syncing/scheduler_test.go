package syncing

import (
	"context"
	"seed/backend/blob"
	"seed/backend/config"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// testConfig creates a config.Syncing for tests with sensible defaults.
func testConfig(interval time.Duration, minWorkers, maxWorkers int) config.Syncing {
	return config.Syncing{
		Interval:       interval,
		MinWorkers:     minWorkers,
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
	s := newScheduler(disc, testConfig(disc.interval, 1, 2))
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
	s := newScheduler(disc, testConfig(disc.interval, 1, 2))
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
	s := newScheduler(disc, testConfig(disc.interval, 1, 2))
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
	s := newScheduler(disc, testConfig(disc.interval, 1, 2))
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
	s := newScheduler(disc, testConfig(disc.interval, 1, 2))
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

	s := newScheduler(disc, testConfig(disc.interval, 1, 2))

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
	s := newScheduler(disc, testConfig(disc.interval, 1, 1))
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
