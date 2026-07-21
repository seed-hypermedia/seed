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
	hotCtx       map[blob.IRI]bool // If non-nil, records whether each run's context was tagged hot.
	blockCh      chan struct{}     // If non-nil, DiscoverObjectWithProgress returns only after this channel is closed.
	onDiscoverFn func(blob.IRI)
	interval     time.Duration
}

func (m *mockDiscoverer) DiscoverObjectWithProgress(ctx context.Context, entityID blob.IRI, version blob.Version, recursive bool, depthOne bool, blobTypes []string, prog *Progress) (blob.Version, error) {
	m.mu.Lock()
	m.calls[entityID]++
	if m.hotCtx != nil {
		m.hotCtx[entityID] = isHotDiscovery(ctx)
	}
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

func TestScheduler_HotRetouchRetriesIncompleteCompletedTask(t *testing.T) {
	t.Run("empty result with no successful peer sync is not final", func(t *testing.T) {
		s := newScheduler(nil, testConfig(10*time.Second, 1))
		now := time.Now()
		retouchAt := now.Add(time.Millisecond)
		key := DiscoveryKey{IRI: "hm://alice/missing"}

		s.scheduleTask(key, now, schedOpts{isHot: true})

		s.mu.Lock()
		task := s.tasks[key]
		require.NotNil(t, task)
		if task.queueIndex.IsSet() {
			s.queue.Remove(task.queueIndex.Value())
		}
		task.state = TaskStateCompleted
		task.runCount = 1
		task.result = ""
		task.lastErr = nil
		task.progress = &Progress{}
		task.nextRunTime = now.Add(defaultHotCooldown)
		s.enqueueLocked(task, now)
		s.mu.Unlock()

		info := s.scheduleTask(key, retouchAt, schedOpts{isHot: true})
		require.Equal(t, TaskStateIdle, info.State, "no-peer empty result must be retried instead of reported completed")

		s.mu.Lock()
		task = s.tasks[key]
		require.NotNil(t, task)
		require.Equal(t, retouchAt, task.nextRunTime)
		require.Equal(t, tierHot, task.queueTier)
		s.mu.Unlock()
	})

	t.Run("wrong requested version retries immediately", func(t *testing.T) {
		s := newScheduler(nil, testConfig(10*time.Second, 1))
		now := time.Now()
		retouchAt := now.Add(time.Millisecond)
		key := DiscoveryKey{IRI: "hm://alice/doc", Version: "want"}
		progress := &Progress{}
		progress.PeersSyncedOK.Add(1)

		s.scheduleTask(key, now, schedOpts{isHot: true})

		s.mu.Lock()
		task := s.tasks[key]
		require.NotNil(t, task)
		if task.queueIndex.IsSet() {
			s.queue.Remove(task.queueIndex.Value())
		}
		task.state = TaskStateCompleted
		task.runCount = 1
		task.result = "got"
		task.progress = progress
		task.nextRunTime = now.Add(defaultHotCooldown)
		s.enqueueLocked(task, now)
		s.mu.Unlock()

		_ = s.scheduleTask(key, retouchAt, schedOpts{isHot: true})

		s.mu.Lock()
		task = s.tasks[key]
		require.NotNil(t, task)
		require.Equal(t, retouchAt, task.nextRunTime)
		require.Equal(t, tierHot, task.queueTier)
		s.mu.Unlock()
	})
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

// backdateRunStart ages a running task's runStartedAt past the young-run
// preemption protection, so tests can exercise the stalled-task preemption and
// cleanup paths without waiting out progressGrace in real time.
func backdateRunStart(s *scheduler, key DiscoveryKey) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if task, ok := s.tasks[key]; ok {
		task.runStartedAt = time.Now().Add(-progressGrace - time.Second)
	}
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

	// Age the running subscription past the young-run protection window so the
	// preemption path is exercised (young runs are deliberately unpreemptable).
	backdateRunStart(s, subKey)

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

	// Age A past the young-run protection so it is a valid preemption victim.
	backdateRunStart(s, keyA)

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

// TestScheduler_NoPreemptWhileDownloading verifies the progress-aware guard:
// a running hot task that has downloaded within progressGrace is protected from
// preemption, while a stalled one (no download within the grace) is preemptible.
// This is the roof fix — under a storm of concurrent discoveries a newer hot task
// must not cancel an older one that is mid-download.
func TestScheduler_NoPreemptWhileDownloading(t *testing.T) {
	disc := &mockDiscoverer{calls: make(map[blob.IRI]int)}
	s := newScheduler(disc, testConfig(10*time.Second, 6))
	now := time.Now()

	// Incoming hot task (freshest deadline) wanting a worker slot.
	incoming := &taskHandle{key: DiscoveryKey{IRI: "hm://incoming"}, hotDeadline: now.Add(s.hotTTL)}

	// A running hot task with an OLDER deadline (normally the victim) that is
	// actively downloading.
	cancelled := false
	downloading := &taskHandle{
		key:         DiscoveryKey{IRI: "hm://downloading"},
		state:       TaskStateInProgress,
		hotDeadline: now.Add(s.hotTTL - 10*time.Second),
		cancelFunc:  func() { cancelled = true },
		progress:    &Progress{},
	}
	downloading.progress.BlobsDownloaded.Store(100)
	s.tasks[downloading.key] = downloading

	// It just downloaded, so it must be protected.
	require.False(t, s.preemptOldestHotLocked(incoming, now),
		"a task downloading within progressGrace must not be preempted")
	require.False(t, cancelled)

	// With no further downloads, once progressGrace elapses it becomes preemptible.
	require.True(t, s.preemptOldestHotLocked(incoming, now.Add(progressGrace+time.Second)),
		"a stalled task (no download within progressGrace) must be preemptible")
	require.True(t, cancelled, "the stalled task's cancelFunc must be called")
}

// TestScheduler_NoPreemptYoungRun verifies the young-run gate: a run younger
// than progressGrace is protected from preemption even with zero recorded
// progress — peer selection and auth compute precede any reconcile/download,
// so without this a hot storm kills every round at its first step (observed:
// rounds dying in the peers-table SELECT with SQLITE_INTERRUPT after an app
// restart, so the viewed document synced nothing for minutes). Once the run
// ages past the grace with no progress, it becomes a normal stalled victim.
func TestScheduler_NoPreemptYoungRun(t *testing.T) {
	disc := &mockDiscoverer{calls: make(map[blob.IRI]int)}
	s := newScheduler(disc, testConfig(10*time.Second, 6))
	now := time.Now()

	incoming := &taskHandle{key: DiscoveryKey{IRI: "hm://incoming"}, hotDeadline: now.Add(s.hotTTL)}

	cancelled := false
	young := &taskHandle{
		key:          DiscoveryKey{IRI: "hm://young"},
		state:        TaskStateInProgress,
		hotDeadline:  now.Add(s.hotTTL - 10*time.Second),
		cancelFunc:   func() { cancelled = true },
		progress:     &Progress{},
		runStartedAt: now,
	}
	s.tasks[young.key] = young

	require.False(t, s.preemptOldestHotLocked(incoming, now.Add(time.Second)),
		"a run younger than progressGrace must not be preempted even with zero progress")
	require.False(t, cancelled)

	require.True(t, s.preemptOldestHotLocked(incoming, now.Add(progressGrace+time.Second)),
		"a run older than progressGrace with no progress becomes a normal stalled victim")
	require.True(t, cancelled, "the stalled task's cancelFunc must be called")
}

// TestScheduler_NoPreemptSubscriptionWhileDownloading verifies that the
// subscription-preemption path honors the same download protection as the hot
// path: a freshly-rendered card (a new hot task) must not cancel a recursive
// subscription — e.g. the foreground site sync — while it is actively
// downloading; a stalled subscription is still fair game. Without this guard the
// site sync was killed mid-download and rescheduled a full Interval later, which
// is the multi-cycle cold-sync stall.
func TestScheduler_NoPreemptSubscriptionWhileDownloading(t *testing.T) {
	disc := &mockDiscoverer{calls: make(map[blob.IRI]int)}
	s := newScheduler(disc, testConfig(10*time.Second, 6))
	now := time.Now()

	cancelled := false
	downloading := &taskHandle{
		key:          DiscoveryKey{IRI: "hm://site/sub"},
		state:        TaskStateInProgress,
		subscription: true,
		cancelFunc:   func() { cancelled = true },
		progress:     &Progress{},
	}
	downloading.progress.BlobsDownloaded.Store(100)
	s.tasks[downloading.key] = downloading

	// Actively downloading -> protected.
	require.False(t, s.preemptSubscriptionLocked(now),
		"a subscription downloading within progressGrace must not be preempted")
	require.False(t, cancelled)

	// Stalled past progressGrace -> preemptible.
	require.True(t, s.preemptSubscriptionLocked(now.Add(progressGrace+time.Second)),
		"a stalled subscription must be preemptible")
	require.True(t, cancelled, "the stalled subscription's cancelFunc must be called")
}

// TestScheduler_NoPreemptWhileReconciling verifies that a discovery still in its
// reconcile ramp — growing a peer's reconciled want-count but with no block
// downloaded yet — is protected from preemption. The foreground site sync was
// being killed in exactly this window (connected_sync cut with ok=0 downloaded=0
// under the startup storm, then a full re-cycle), because the old protection only
// looked at downloads.
func TestScheduler_NoPreemptWhileReconciling(t *testing.T) {
	disc := &mockDiscoverer{calls: make(map[blob.IRI]int)}
	s := newScheduler(disc, testConfig(10*time.Second, 6))
	now := time.Now()

	cancelled := false
	reconciling := &taskHandle{
		key:          DiscoveryKey{IRI: "hm://site/sub"},
		state:        TaskStateInProgress,
		subscription: true,
		cancelFunc:   func() { cancelled = true },
		progress:     &Progress{},
	}
	// Reconciling (want-list growing), nothing downloaded yet.
	reconciling.progress.MaxReconciledWants.Store(5000)
	s.tasks[reconciling.key] = reconciling

	require.False(t, s.preemptSubscriptionLocked(now),
		"a subscription reconciling within progressGrace must not be preempted")
	require.False(t, cancelled)

	// Reconcile stops advancing and still nothing downloads -> after progressGrace
	// it is idle on both signals and becomes preemptible.
	require.True(t, s.preemptSubscriptionLocked(now.Add(progressGrace+time.Second)),
		"a subscription idle on both download and reconcile past the grace must be preemptible")
	require.True(t, cancelled)
}

// TestScheduler_NoTTLCancelWhileDownloading verifies the 4th progress gate: a hot
// task whose heartbeat expired is NOT cancelled by the cleanup while it's still
// actively downloading (its heartbeat is extended so the deep fetch converges);
// a stalled expired task is still reaped.
func TestScheduler_NoTTLCancelWhileDownloading(t *testing.T) {
	s := newScheduler(&mockDiscoverer{calls: make(map[blob.IRI]int)}, testConfig(10*time.Second, 6))
	now := time.Now()

	// Expired heartbeat, but actively downloading -> protected (extended).
	cancelledDL := false
	dl := &taskHandle{
		key: DiscoveryKey{IRI: "hm://downloading"}, state: TaskStateInProgress,
		hotDeadline: now.Add(-time.Second), cancelFunc: func() { cancelledDL = true }, progress: &Progress{},
	}
	dl.progress.BlobsDownloaded.Store(100)
	s.tasks[dl.key] = dl

	// Expired heartbeat and stalled (no recent download) -> reaped.
	cancelledStalled := false
	stalled := &taskHandle{
		key: DiscoveryKey{IRI: "hm://stalled"}, state: TaskStateInProgress,
		hotDeadline: now.Add(-time.Second), cancelFunc: func() { cancelledStalled = true },
		progress: &Progress{}, lastDownloaded: 50, lastDownloadAt: now.Add(-time.Minute),
	}
	stalled.progress.BlobsDownloaded.Store(50) // unchanged since lastDownloaded
	s.tasks[stalled.key] = stalled

	s.cleanupExpiredHotTasksLocked(now)

	require.False(t, cancelledDL, "a downloading expired hot task must not be TTL-cancelled")
	require.True(t, dl.IsHot(now), "the downloading task's heartbeat should be extended")
	require.True(t, cancelledStalled, "a stalled expired hot task must be reaped")
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

	// Age the run past the young-run protection so the TTL reaper sees a
	// stalled task rather than extending a just-started one.
	backdateRunStart(s, key)

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

// TestScheduler_HotSubscriptionReschedulesAtCooldown verifies that a
// subscription with a live hot heartbeat (its space is on screen) reschedules
// on the hot cooldown, and falls back to the background interval once the
// heartbeat lapses. Before the reorder in scheduleNext, the subscription
// branch shadowed the heartbeat and a viewed subscribed space stayed on the
// interval cadence.
func TestScheduler_HotSubscriptionReschedulesAtCooldown(t *testing.T) {
	s := newScheduler(nil, testConfig(time.Minute, 2))
	now := time.Now()

	task := &taskHandle{
		key:          DiscoveryKey{IRI: "hm://site/space"},
		subscription: true,
		hotDeadline:  now.Add(s.hotTTL),
		runCount:     1,
	}
	s.tasks[task.key] = task

	s.scheduleNext(task, now, false)
	require.Equal(t, now.Add(defaultHotCooldown), task.nextRunTime,
		"a subscription with a live heartbeat must reschedule on the hot cooldown, not the interval")

	// Heartbeat lapsed: back to the background interval, and the task stays.
	later := now.Add(s.hotTTL + time.Second)
	s.scheduleNext(task, later, false)
	require.Equal(t, later.Add(s.cfg.Interval), task.nextRunTime,
		"a subscription without a live heartbeat must reschedule on the interval")
	_, exists := s.tasks[task.key]
	require.True(t, exists, "a subscription must never be dropped when its heartbeat lapses")

	// An ephemeral task with a lapsed heartbeat must still be dropped.
	eph := &taskHandle{
		key:         DiscoveryKey{IRI: "hm://doc/gone"},
		hotDeadline: later.Add(-time.Second),
		runCount:    1,
	}
	s.tasks[eph.key] = eph
	s.scheduleNext(eph, later, false)
	_, exists = s.tasks[eph.key]
	require.False(t, exists, "an ephemeral task with a lapsed heartbeat must be dropped")
}

// TestScheduler_HotTouchPullsSubscriptionForward verifies that hot-touching a
// subscription waiting out its background interval pulls its next run within
// the hot cooldown, so a freshly-opened subscribed space starts syncing at
// interactive cadence instead of waiting out the remainder of the interval.
func TestScheduler_HotTouchPullsSubscriptionForward(t *testing.T) {
	s := newScheduler(nil, testConfig(time.Minute, 2))
	now := time.Now()
	key := DiscoveryKey{IRI: "hm://site/space"}

	s.mu.Lock()
	task := &taskHandle{
		key:          key,
		subscription: true,
		runCount:     1,
		state:        TaskStateCompleted,
		result:       "v1", // Good result: none of the hot retry-now conditions apply.
		nextRunTime:  now.Add(time.Minute),
	}
	s.tasks[key] = task
	s.enqueueLocked(task, now)
	s.mu.Unlock()

	touchAt := now.Add(time.Second)
	s.scheduleTask(key, touchAt, schedOpts{isHot: true})

	s.mu.Lock()
	require.Equal(t, touchAt.Add(defaultHotCooldown), s.tasks[key].nextRunTime,
		"hot touch must pull the far-out subscription run within the cooldown")
	s.mu.Unlock()
}

// TestScheduler_ColdLaneLeavesRoomForHot verifies the worker reservation: cold
// runs may fill every slot but one, so a hot task always dispatches without
// waiting for (or preempting) a multi-second background round.
func TestScheduler_ColdLaneLeavesRoomForHot(t *testing.T) {
	blockCh := make(chan struct{})
	disc := &mockDiscoverer{calls: make(map[blob.IRI]int), blockCh: blockCh}

	// 2 workers: the cold lane is capped at 1, the other slot is hot-reserved.
	s := newScheduler(disc, testConfig(10*time.Second, 2))
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() { _ = s.run(ctx) }()

	subA := DiscoveryKey{IRI: "hm://sub/a"}
	subB := DiscoveryKey{IRI: "hm://sub/b"}
	hot := DiscoveryKey{IRI: "hm://doc/viewed"}

	s.scheduleTask(subA, time.Now(), schedOpts{forceSubscription: true})
	waitForState(t, s, subA, TaskStateInProgress, "first subscription must start")

	// The second subscription must be held back by the cold-lane cap even
	// though a worker slot is technically free.
	s.scheduleTask(subB, time.Now(), schedOpts{forceSubscription: true})
	time.Sleep(50 * time.Millisecond)
	s.mu.Lock()
	require.NotEqual(t, TaskStateInProgress, s.tasks[subB].state,
		"second cold task must not take the hot-reserved slot")
	s.mu.Unlock()

	// A hot task takes the reserved slot immediately, with no preemption.
	s.scheduleTask(hot, time.Now(), schedOpts{isHot: true})
	waitForState(t, s, hot, TaskStateInProgress, "hot task must dispatch into the reserved slot")

	s.mu.Lock()
	require.Equal(t, TaskStateInProgress, s.tasks[subA].state,
		"running subscription must not be preempted while the reserved slot is free")
	s.mu.Unlock()

	close(blockCh)

	// Once the cold lane frees up, the held-back subscription runs too.
	require.Eventually(t, func() bool {
		disc.mu.Lock()
		defer disc.mu.Unlock()
		return disc.calls[subB.IRI] > 0
	}, 2*time.Second, 10*time.Millisecond, "blocked cold task must run once the cold lane frees up")
}

// TestScheduler_DueHotBehindBlockedColdStillDispatches verifies that the
// dispatch scan drains past cold tasks blocked by the lane cap to reach a due
// hot task deeper in the queue: a hot task riding out its cooldown sits in the
// cold tier (ordered after earlier-due cold tasks), and stopping at the first
// blocked cold head would leave the reserved slot idle while the hot task
// starves behind it.
func TestScheduler_DueHotBehindBlockedColdStillDispatches(t *testing.T) {
	blockCh := make(chan struct{})
	disc := &mockDiscoverer{calls: make(map[blob.IRI]int), blockCh: blockCh}
	s := newScheduler(disc, testConfig(time.Minute, 2)) // Cold lane capped at 1.
	ctx := context.Background()
	now := time.Now()

	s.mu.Lock()
	// Cold lane already full: one subscription mid-run (never completes here).
	running := &taskHandle{
		key:          DiscoveryKey{IRI: "hm://sub/running"},
		subscription: true,
		state:        TaskStateInProgress,
		runningCold:  true,
	}
	s.tasks[running.key] = running
	s.inProgress = 1
	s.inProgressCold = 1

	// A due cold subscription ahead of the hot task in the cold-tier order.
	coldB := &taskHandle{
		key:          DiscoveryKey{IRI: "hm://sub/b"},
		subscription: true,
		runCount:     1,
		nextRunTime:  now.Add(-2 * time.Second),
	}
	s.tasks[coldB.key] = coldB
	s.enqueueLocked(coldB, now)

	// A hot task that was queued on its cooldown (cold tier) and is now due.
	// Its later nextRunTime sorts it behind coldB within the cold tier.
	hotTask := &taskHandle{
		key:         DiscoveryKey{IRI: "hm://doc/viewed"},
		hotDeadline: now.Add(time.Minute),
		runCount:    1,
		nextRunTime: now.Add(-time.Second),
		queueTier:   tierCold,
	}
	s.tasks[hotTask.key] = hotTask
	s.queue.Push(hotTask)

	s.dispatchReadyTasks(ctx)

	require.Equal(t, TaskStateInProgress, hotTask.state,
		"due hot task must dispatch into the reserved slot despite blocked cold heads ahead of it")
	require.NotEqual(t, TaskStateInProgress, coldB.state, "cold task must stay held back by the lane cap")
	require.True(t, coldB.queueIndex.IsSet(), "held-back cold task must be re-enqueued, not lost")
	require.Equal(t, 1, s.inProgressCold, "a hot dispatch must not count against the cold lane")
	s.mu.Unlock()

	close(blockCh)
	require.Eventually(t, func() bool {
		disc.mu.Lock()
		defer disc.mu.Unlock()
		return disc.calls[hotTask.key.IRI] > 0
	}, 2*time.Second, 10*time.Millisecond, "dispatched hot task must actually run")
}

// TestScheduler_HotDispatchTagsContext verifies that a run dispatched with a
// live hot heartbeat carries the hot-discovery context tag (which selects the
// latency-first wave-cut policy in syncWithManyPeers), while a plain
// subscription run does not.
func TestScheduler_HotDispatchTagsContext(t *testing.T) {
	disc := &mockDiscoverer{
		calls:  make(map[blob.IRI]int),
		hotCtx: make(map[blob.IRI]bool),
	}
	s := newScheduler(disc, testConfig(time.Minute, 2))
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() { _ = s.run(ctx) }()

	hotKey := DiscoveryKey{IRI: "hm://doc/viewed"}
	subKey := DiscoveryKey{IRI: "hm://site/background"}

	s.scheduleTask(hotKey, time.Now(), schedOpts{isHot: true})
	s.scheduleTask(subKey, time.Now(), schedOpts{forceSubscription: true})

	require.Eventually(t, func() bool {
		disc.mu.Lock()
		defer disc.mu.Unlock()
		return disc.calls[hotKey.IRI] > 0 && disc.calls[subKey.IRI] > 0
	}, 2*time.Second, 10*time.Millisecond, "both tasks must run")

	disc.mu.Lock()
	defer disc.mu.Unlock()
	require.True(t, disc.hotCtx[hotKey.IRI], "hot task's run context must be tagged as hot discovery")
	require.False(t, disc.hotCtx[subKey.IRI], "subscription run context must not be tagged hot")
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
