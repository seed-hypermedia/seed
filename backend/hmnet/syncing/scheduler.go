package syncing

import (
	"context"
	"errors"
	"iter"
	"math"
	"math/rand/v2"
	"seed/backend/blob"
	"seed/backend/config"
	"seed/backend/util/heap"
	"seed/backend/util/maybe"
	"sync"
	"time"

	"golang.org/x/sync/errgroup"
)

// Task timing defaults. Installed into every new scheduler and may be
// overridden per-instance before run() is called (tests exercise heartbeat
// expiry and rate-limit behavior on human-friendly timescales).
const (
	defaultHotTTL      = 40 * time.Second
	defaultHotInterval = 20 * time.Second
)

// Queue priority tiers. Lower value = higher priority.
const (
	tierHot  uint8 = 0
	tierCold uint8 = 1
)

// TaskState represents the current state of a discovery task.
type TaskState uint8

// Task state constants.
const (
	TaskStateIdle TaskState = iota
	TaskStateInProgress
	TaskStateCompleted
)

// TaskInfo contains the current state and progress of a discovery task.
type TaskInfo struct {
	State          TaskState
	Progress       *Progress
	Result         blob.Version
	LastResultTime time.Time
	LastErr        error
}

// taskHandle holds state for a discovery task. Pure data, no methods.
// All fields protected by scheduler.mu (except Progress internals which are atomics).
type taskHandle struct {
	key DiscoveryKey // Immutable.

	// Scheduling fields.
	queueIndex   maybe.Value[int]
	queueTier    uint8 // tierHot or tierCold. Snapshot of the task's tier at last enqueue; may go stale.
	nextRunTime  time.Time
	subscription bool
	hotDeadline  time.Time
	runCount     uint64 // Number of times task has been executed.

	// Cancellation. Set by dispatchReadyTasks under s.mu before dispatching, cleared in executeTask's unwind.
	cancelFunc context.CancelFunc
	runCtx     context.Context

	// Observable fields.
	state       TaskState
	progress    *Progress // Progress fields are atomics (workers write to them).
	result      blob.Version
	lastErr     error
	lastRunTime time.Time
}

func (task *taskHandle) IsHot(now time.Time) bool {
	return now.Before(task.hotDeadline)
}

func (task *taskHandle) Info() TaskInfo {
	return TaskInfo{
		State:          task.state,
		Progress:       task.progress,
		Result:         task.result,
		LastErr:        task.lastErr,
		LastResultTime: task.lastRunTime,
	}
}

// discoverer is an interface for discovering objects.
type discoverer interface {
	DiscoverObjectWithProgress(ctx context.Context, entityID blob.IRI, version blob.Version, recursive bool, prog *Progress) (blob.Version, error)
}

// scheduler manages discovery tasks with a bounded worker pool.
//
// Worker capacity is bounded by cfg.MaxWorkers via an errgroup limit. Each
// dispatched task spawns a fresh goroutine via errgroup.TryGo; the limit
// enforces the concurrency cap. We intentionally avoid a buffered work
// channel here because a buffer would absorb new tasks when workers are
// busy, hiding saturation from the dispatch loop — which would defeat the
// hot-over-cold priority model and preemption machinery below.
type scheduler struct {
	workers errgroup.Group

	disc discoverer
	cfg  config.Syncing

	mu    sync.Mutex
	timer *time.Timer
	tasks map[DiscoveryKey]*taskHandle
	queue *heap.Heap[*taskHandle]

	// inProgress counts tasks that are currently being executed by a worker
	// goroutine. Bounded by cfg.MaxWorkers. Used to detect saturation for
	// preemption decisions.
	inProgress int

	// Task timing knobs. Installed from defaults in newScheduler. Tests may
	// assign smaller values before calling run() to exercise heartbeat and
	// rate-limit behavior on compressed timescales.
	hotTTL      time.Duration
	hotInterval time.Duration
}

// newScheduler creates a new scheduler.
func newScheduler(disc discoverer, cfg config.Syncing) *scheduler {
	if cfg.MaxWorkers == 0 {
		panic("BUG: invalid worker count")
	}

	s := &scheduler{
		disc:        disc,
		cfg:         cfg,
		timer:       time.NewTimer(0),
		tasks:       make(map[DiscoveryKey]*taskHandle),
		hotTTL:      defaultHotTTL,
		hotInterval: defaultHotInterval,
		// Two-tier priority: hot tasks always before cold. Within hot tier,
		// LIFO by hotDeadline desc (most recently touched wins); within cold
		// tier, FIFO by nextRunTime asc (earliest due wins). nextRunTime is
		// a stable secondary key in both tiers for deterministic ordering
		// when primary keys tie.
		queue: heap.New(func(a, b *taskHandle) bool {
			if a.queueTier != b.queueTier {
				return a.queueTier < b.queueTier
			}
			if a.queueTier == tierHot {
				if !a.hotDeadline.Equal(b.hotDeadline) {
					return a.hotDeadline.After(b.hotDeadline)
				}
			}
			return a.nextRunTime.Before(b.nextRunTime)
		}),
	}

	s.workers.SetLimit(cfg.MaxWorkers)

	// Track heap indices for Fix/Remove operations.
	s.queue.OnIndexChange = func(task *taskHandle, newIndex int) {
		if newIndex < 0 {
			task.queueIndex.Clear()
		} else {
			task.queueIndex.Set(newIndex)
		}
	}

	return s
}

// run is the main scheduler loop. It should be called in a goroutine.
func (s *scheduler) run(ctx context.Context) (err error) {
	defer func() {
		err = errors.Join(err, s.workers.Wait())
	}()

	// Add random jitter to warmup to avoid thundering herd at startup.
	//nolint:gosec // Using math/rand is acceptable for non-cryptographic jitter.
	initialDelay := time.Duration(rand.Int64N(int64(s.cfg.WarmupDuration)))
	s.timer.Reset(initialDelay)
	defer s.timer.Stop()

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-s.timer.C:
			s.mu.Lock()
			nextWake := s.dispatchReadyTasks(ctx)
			s.timer.Reset(nextWake)
			s.mu.Unlock()
		}
	}
}

// executeTask runs discovery and updates task state directly. It runs in a
// goroutine spawned by the dispatch loop via errgroup.TryGo and owns a single
// MaxWorkers slot for its lifetime.
func (s *scheduler) executeTask(task *taskHandle) {
	s.mu.Lock()
	taskCtx := task.runCtx
	prog := task.progress
	s.mu.Unlock()

	result, err := s.disc.DiscoverObjectWithProgress(
		taskCtx,
		task.key.IRI,
		task.key.Version,
		task.key.Recursive,
		prog,
	)

	s.mu.Lock()
	defer s.mu.Unlock()

	// Release the per-task context and the worker slot.
	if task.cancelFunc != nil {
		task.cancelFunc()
		task.cancelFunc = nil
	}
	task.runCtx = nil
	s.inProgress--

	now := time.Now()

	// Demotion detection: a hot task whose context was cancelled while its
	// heartbeat is still fresh was preempted to make room for a newer hot
	// task. Reset its state and re-enqueue at the top of whichever tier it
	// belongs in so it can resume as soon as a worker frees up.
	if errors.Is(err, context.Canceled) && !task.subscription && task.IsHot(now) {
		task.state = TaskStateIdle
		task.progress = nil
		task.nextRunTime = now
		s.enqueueLocked(task, now)
		s.resetTimer(now)
		return
	}

	task.state = TaskStateCompleted
	task.result = result
	task.lastErr = err
	task.lastRunTime = now
	task.runCount++

	// Reschedule or remove the task.
	s.scheduleNext(task, now, false)
	s.resetTimer(now)
}

// schedOpts specifies options for bumping a task.
type schedOpts struct {
	forceSubscription bool // Mark as persistent subscription.
	isHot             bool // Extend on-demand deadline (heartbeat).
}

// scheduleTask creates or updates a task and returns its current info.
func (s *scheduler) scheduleTask(key DiscoveryKey, now time.Time, opts schedOpts) TaskInfo {
	s.mu.Lock()
	defer s.mu.Unlock()

	info := s.scheduleTaskLocked(key, now, opts)
	s.resetTimer(now)
	return info
}

// loadSubscriptions bulk-loads subscription tasks without waking the scheduler for each insert.
// This is used during startup to avoid thundering herd.
func (s *scheduler) loadSubscriptions(keys iter.Seq[DiscoveryKey]) {
	s.mu.Lock()
	defer s.mu.Unlock()

	now := time.Now()
	for key := range keys {
		s.scheduleTaskLocked(key, now, schedOpts{forceSubscription: true})
	}
}

// scheduleTaskLocked is the internal implementation. Caller must hold s.mu.
func (s *scheduler) scheduleTaskLocked(key DiscoveryKey, now time.Time, opts schedOpts) TaskInfo {
	task, exists := s.tasks[key]
	forceImmediate := false

	if !exists {
		task = &taskHandle{key: key}
		s.tasks[key] = task
		forceImmediate = true
	}

	if opts.forceSubscription && !task.subscription {
		task.subscription = true
		if exists {
			forceImmediate = true
		}
	}

	if opts.isHot {
		task.hotDeadline = now.Add(s.hotTTL)
	}

	if task.state == TaskStateInProgress {
		// Re-touching a running task only updates the heartbeat deadline.
		// Re-running decisions happen when the current run completes.
		return task.Info()
	}

	if forceImmediate || task.runCount == 0 {
		s.scheduleNext(task, now, forceImmediate)
	} else if opts.isHot && task.queueIndex.IsSet() {
		// Re-touching an already-queued task: its hot deadline changed, which
		// may move it up in the hot tier (LIFO ordering) or migrate it from
		// cold into hot. Re-seat it in the queue without changing nextRunTime.
		s.enqueueLocked(task, now)
	}

	return task.Info()
}

// removeSubscription removes specific subscriptions from the scheduler.
func (s *scheduler) removeSubscriptions(keys ...DiscoveryKey) {
	s.mu.Lock()
	defer s.mu.Unlock()

	for _, key := range keys {
		task, exists := s.tasks[key]
		if !exists {
			continue
		}

		task.subscription = false
		now := time.Now()

		// If task is not hot and not running, remove immediately.
		if !task.IsHot(now) && task.state != TaskStateInProgress {
			if task.queueIndex.IsSet() {
				s.queue.Remove(task.queueIndex.Value())
			}
			delete(s.tasks, key)
		}
	}
}

// dispatchReadyTasks sends ready tasks to workers. Caller must hold s.mu.
func (s *scheduler) dispatchReadyTasks(ctx context.Context) (nextWake time.Duration) {
	for s.queue.Len() > 0 {
		task := s.queue.Peek()

		if task.state == TaskStateInProgress {
			s.queue.Pop()
			continue
		}

		now := time.Now()

		// Lazy migration: if the head task's tier flag is stale (e.g. a hot
		// task whose deadline expired while queued, or a rate-limited hot
		// task whose cooldown just ended), fix its position before dispatching.
		wantTier := tierCold
		if task.IsHot(now) && !task.nextRunTime.After(now) {
			wantTier = tierHot
		}
		if wantTier != task.queueTier {
			// Ephemeral (non-subscription) hot task with expired deadline:
			// there's nothing to run and no owner to resume it. Drop it.
			if wantTier == tierCold && !task.subscription {
				s.queue.Pop()
				delete(s.tasks, task.key)
				continue
			}
			task.queueTier = wantTier
			s.queue.Fix(task.queueIndex.Value())
			continue
		}

		// Clump cold tasks slightly into the future to save battery on
		// end-user devices. Hot tasks always dispatch immediately.
		const lookAhead = 10 * time.Second
		if task.queueTier == tierCold && task.nextRunTime.After(now.Add(lookAhead)) {
			s.cleanupExpiredHotTasksLocked(now)
			wake := task.nextRunTime.Sub(now)
			return s.boundedWake(wake, time.Now())
		}

		// Task is ready. Pop it from the queue and prepare its run context.
		s.queue.Pop()
		task.state = TaskStateInProgress
		task.progress = &Progress{}
		taskCtx, cancel := context.WithCancel(ctx)
		task.runCtx = taskCtx
		task.cancelFunc = cancel

		// Dispatch via errgroup.TryGo. TryGo respects the MaxWorkers limit
		// set in newScheduler, so saturation is authoritative here — either
		// we get a goroutine slot or we don't.
		if s.inProgress < s.cfg.MaxWorkers && s.workers.TryGo(func() error {
			s.executeTask(task)
			return nil
		}) {
			s.inProgress++
			continue
		}

		// Worker pool is full. For hot tasks, try to make room by preempting
		// a running subscription or demoting the oldest in-flight hot task.
		// The new task goes back into the queue; when the preempted worker
		// unwinds, its tail calls resetTimer so we get re-entered and retry.
		preempted := false
		if task.queueTier == tierHot {
			if s.preemptSubscriptionLocked() {
				preempted = true
			} else if s.demoteOldestHotLocked(task, now) {
				preempted = true
			}
		}

		// Release the unused context and reset the task.
		cancel()
		task.runCtx = nil
		task.cancelFunc = nil
		task.state = TaskStateIdle
		task.progress = nil
		s.enqueueLocked(task, now)

		if preempted {
			// A slot will open shortly. Stop dispatching; we'll be woken again.
			break
		}
		// Fully saturated with no preemption candidate.
		break
	}

	now := time.Now()
	s.cleanupExpiredHotTasksLocked(now)

	// Sleep forever unless an in-progress hot task's heartbeat is about to
	// expire (so we can cancel it promptly), or a queued cold task becomes due.
	wake := time.Duration(math.MaxInt64)
	if s.queue.Len() > 0 {
		top := s.queue.Peek()
		if top.queueTier == tierCold {
			if d := top.nextRunTime.Sub(now); d < wake {
				wake = d
			}
		}
		// Hot tasks at the head are always "ready"; if we got here without
		// dispatching them it means workers are saturated. Wait for a worker
		// completion to wake us.
	}
	return s.boundedWake(wake, now)
}

// enqueueLocked inserts or reorders the task in the queue based on its current
// hot state and rate-limit. Caller must hold s.mu. Must not be called while
// task.state == TaskStateInProgress.
//
// A task belongs in the hot tier iff its heartbeat is still fresh AND its
// nextRunTime rate-limit has elapsed. Rate-limited hot tasks (just finished
// a run, cooling down for hotInterval) sit in the cold tier sorted by their
// cooldown expiry; lazy migration in dispatchReadyTasks promotes them back
// when their cooldown ends.
func (s *scheduler) enqueueLocked(task *taskHandle, now time.Time) {
	if task.IsHot(now) && !task.nextRunTime.After(now) {
		task.queueTier = tierHot
	} else {
		task.queueTier = tierCold
	}
	if task.queueIndex.IsSet() {
		s.queue.Fix(task.queueIndex.Value())
		return
	}
	s.queue.Push(task)
}

// preemptSubscriptionLocked cancels an in-flight subscription so its worker
// slot can be reused by a higher-priority hot task. Returns true if a
// subscription was cancelled. Caller must hold s.mu.
func (s *scheduler) preemptSubscriptionLocked() bool {
	for _, t := range s.tasks {
		if t.state != TaskStateInProgress {
			continue
		}
		if !t.subscription {
			continue
		}
		if t.cancelFunc == nil {
			continue
		}
		t.cancelFunc()
		return true
	}
	return false
}

// demoteOldestHotLocked cancels the in-flight ephemeral hot task with the
// oldest hotDeadline so a newer hot task (`incoming`) can take its worker
// slot. The demoted task will re-enter the hot tier via executeTask's
// cancellation branch. Returns true if a task was demoted. Caller must
// hold s.mu.
func (s *scheduler) demoteOldestHotLocked(incoming *taskHandle, now time.Time) bool {
	var victim *taskHandle
	for _, t := range s.tasks {
		if t.state != TaskStateInProgress {
			continue
		}
		if t.subscription {
			continue
		}
		if !t.IsHot(now) {
			// Heartbeat already expired; cleanupExpiredHotTasksLocked will reap it.
			continue
		}
		if t.cancelFunc == nil {
			continue
		}
		if t.key == incoming.key {
			continue
		}
		// Victim must have a strictly older heartbeat than the incoming task;
		// otherwise demoting just delays the user's most recent request.
		if !t.hotDeadline.Before(incoming.hotDeadline) {
			continue
		}
		if victim == nil || t.hotDeadline.Before(victim.hotDeadline) {
			victim = t
		}
	}
	if victim == nil {
		return false
	}
	victim.cancelFunc()
	return true
}

// cleanupExpiredHotTasksLocked cancels in-progress ephemeral hot tasks whose
// heartbeat deadline has expired (the frontend stopped polling, meaning the
// user is no longer viewing that document) and drops any queued ephemeral
// hot tasks in the same state. Caller must hold s.mu.
func (s *scheduler) cleanupExpiredHotTasksLocked(now time.Time) {
	var toDelete []*taskHandle
	for _, t := range s.tasks {
		if t.subscription {
			continue
		}
		if t.IsHot(now) {
			continue
		}
		switch t.state {
		case TaskStateInProgress:
			if t.cancelFunc != nil {
				t.cancelFunc()
			}
		default:
			if t.queueIndex.IsSet() {
				toDelete = append(toDelete, t)
			}
		}
	}
	for _, t := range toDelete {
		s.queue.Remove(t.queueIndex.Value())
		delete(s.tasks, t.key)
	}
}

// boundedWake narrows `candidate` by the earliest in-progress hot-task
// heartbeat expiry so cleanup runs promptly. Caller must hold s.mu.
func (s *scheduler) boundedWake(candidate time.Duration, now time.Time) time.Duration {
	for _, t := range s.tasks {
		if t.state != TaskStateInProgress || t.subscription {
			continue
		}
		if t.hotDeadline.IsZero() {
			continue
		}
		d := max(t.hotDeadline.Sub(now), 0)
		if d < candidate {
			candidate = d
		}
	}
	return candidate
}

// scheduleNext calculates the next run time and enqueues/fixes the task.
// If the task should not be rescheduled (not hot, not subscription), it is deleted.
// Caller must hold s.mu.
func (s *scheduler) scheduleNext(task *taskHandle, now time.Time, forceImmediate bool) {
	isHot := task.IsHot(now)

	switch {
	case forceImmediate || task.runCount == 0:
		task.nextRunTime = now
	case isHot:
		task.nextRunTime = now.Add(s.hotInterval)
	case !isHot && task.subscription:
		task.nextRunTime = now.Add(s.cfg.Interval)
	case !isHot && !task.subscription:
		// Not hot, nor a subscription: drop the task.
		if task.queueIndex.IsSet() {
			s.queue.Remove(task.queueIndex.Value())
		}
		delete(s.tasks, task.key)
		return
	default:
		panic("BUG: unreachable")
	}

	s.enqueueLocked(task, now)
}

// resetTimer resets the timer for the scheduler.
// Caller must hold s.mu.
func (s *scheduler) resetTimer(now time.Time) {
	if s.queue.Len() == 0 {
		wake := s.boundedWake(time.Duration(math.MaxInt64), now)
		s.timer.Reset(wake)
		return
	}
	top := s.queue.Peek()
	wake := time.Duration(0)
	if top.queueTier != tierHot {
		wake = max(top.nextRunTime.Sub(now), 0)
	}
	s.timer.Reset(s.boundedWake(wake, now))
}
