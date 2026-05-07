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
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"golang.org/x/sync/errgroup"
)

const (
	defaultHotTTL      = 40 * time.Second
	defaultHotCooldown = 20 * time.Second
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
	queueTier    uint8 // tierHot or tierCold. Assigned at enqueue; re-evaluated lazily at dispatch.
	nextRunTime  time.Time
	subscription bool
	hotDeadline  time.Time
	runCount     uint64 // Number of times task has been executed.

	// hotIndex tracks the position of this task inside scheduler.inProgressHot
	// while it is running as an ephemeral hot task. Maintained by the heap's
	// OnIndexChange callback. Unset for queued, completed, or subscription tasks.
	hotIndex maybe.Value[int]

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
	DiscoverObjectWithProgress(ctx context.Context, entityID blob.IRI, version blob.Version, recursive bool, depthOne bool, blobTypes []string, prog *Progress) (blob.Version, error)
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

	// inProgressHot indexes ephemeral hot tasks currently running, ordered
	// by hotDeadline ascending so the head is always the oldest (the most
	// likely preemption victim and the soonest heartbeat to expire). Lets
	// preempt/cleanup/wake decisions stay O(1)/O(log n) instead of walking
	// the full s.tasks map every dispatch tick.
	inProgressHot *heap.Heap[*taskHandle]

	// inProgressSubs indexes subscription tasks currently running. Keyed by
	// DiscoveryKey for O(1) "any one" picks during subscription preemption.
	inProgressSubs map[DiscoveryKey]*taskHandle

	// inProgress counts tasks that are currently being executed by a worker
	// goroutine. Bounded by cfg.MaxWorkers. Used to detect saturation for
	// preemption decisions.
	inProgress int

	// Observability counters surfaced via /debug/network so we can confirm
	// whether preemption ever fires in production. Atomics so reads from
	// the debug page don't need to acquire s.mu.
	preemptSubsCount atomic.Uint64
	preemptHotCount  atomic.Uint64

	// Heartbeat TTL for hot tasks. Installed from defaultHotTTL in newScheduler.
	// Tests may assign a smaller value before calling run().
	hotTTL time.Duration
}

// newScheduler creates a new scheduler.
func newScheduler(disc discoverer, cfg config.Syncing) *scheduler {
	if cfg.MaxWorkers == 0 {
		panic("BUG: invalid worker count")
	}

	s := &scheduler{
		disc:           disc,
		cfg:            cfg,
		timer:          time.NewTimer(0),
		tasks:          make(map[DiscoveryKey]*taskHandle),
		inProgressSubs: make(map[DiscoveryKey]*taskHandle),
		hotTTL:         defaultHotTTL,
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
		// Ascending by hotDeadline: head = oldest = next-to-expire = first
		// preemption victim.
		inProgressHot: heap.New(func(a, b *taskHandle) bool {
			return a.hotDeadline.Before(b.hotDeadline)
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
	s.inProgressHot.OnIndexChange = func(task *taskHandle, newIndex int) {
		if newIndex < 0 {
			task.hotIndex.Clear()
		} else {
			task.hotIndex.Set(newIndex)
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
			s.mu.Unlock()
			// time.Timer.Reset is goroutine-safe, so we keep it out of the
			// critical section to shrink the window during which scheduleTask
			// callers contend on s.mu.
			s.timer.Reset(nextWake)
		}
	}
}

// executeTask runs discovery and updates task state directly. It runs in a
// goroutine spawned by the dispatch loop via errgroup.TryGo and owns a single
// MaxWorkers slot for its lifetime.
//
// taskCtx and prog are passed by value so executeTask never has to grab s.mu
// just to read them off task — the dispatch path captures them locally
// before assigning the task fields, so the closure already holds the
// correct values.
func (s *scheduler) executeTask(task *taskHandle, taskCtx context.Context, prog *Progress) {
	var blobTypes []string
	if task.key.BlobTypes != "" {
		blobTypes = strings.Split(task.key.BlobTypes, ",")
	}

	result, err := s.disc.DiscoverObjectWithProgress(
		taskCtx,
		task.key.IRI,
		task.key.Version,
		task.key.Recursive,
		task.key.DepthOne,
		blobTypes,
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
	s.markFinished(task)

	now := time.Now()

	// Preemption detection: a hot task whose context was cancelled while its
	// heartbeat is still fresh was preempted to make room for a newer hot
	// task. Re-enqueue it so it resumes as soon as a worker frees up.
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
		// If the task is in inProgressHot, its order key (hotDeadline)
		// just changed, so fix the in-progress hot heap too.
		if task.hotIndex.IsSet() {
			s.inProgressHot.Fix(task.hotIndex.Value())
		}
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

		// If the task is currently running as a subscription, drop the
		// in-progress subscription tracking now that it isn't one anymore.
		// We don't migrate it into inProgressHot — it'll finish normally
		// and exit through markFinished, which is idempotent.
		if existing, ok := s.inProgressSubs[key]; ok && existing == task {
			delete(s.inProgressSubs, key)
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
		// task whose heartbeat expired while queued), fix its position.
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

		// Task is ready. Pop it from the queue.
		s.queue.Pop()

		// Capacity check first — only allocate the per-task context when
		// we're committed to dispatching. Under saturation the prior code
		// allocated a context.WithCancel + Progress per peeked task and
		// immediately discarded them, which showed up directly in the
		// allocation profile.
		if s.inProgress < s.cfg.MaxWorkers {
			taskCtx, cancel := context.WithCancel(ctx)
			prog := &Progress{}
			task.state = TaskStateInProgress
			task.progress = prog
			task.runCtx = taskCtx
			task.cancelFunc = cancel
			// TryGo respects the MaxWorkers limit; on the rare losing race
			// we unwind state and re-enqueue.
			if s.workers.TryGo(func() error {
				s.executeTask(task, taskCtx, prog)
				return nil
			}) {
				s.inProgress++
				s.markInProgress(task)
				continue
			}
			// Race lost: TryGo refused despite the capacity check. Reset
			// state and fall through to the saturation branch.
			cancel()
			task.runCtx = nil
			task.cancelFunc = nil
			task.state = TaskStateIdle
			task.progress = nil
		}

		// Worker pool is full. For hot tasks, try to make room by preempting
		// a running subscription or the oldest in-flight hot task. The new
		// task goes back into the queue; when the preempted worker unwinds,
		// its tail calls resetTimer so we get re-entered and retry.
		preempted := false
		if task.queueTier == tierHot {
			if s.preemptSubscriptionLocked() {
				preempted = true
			} else if s.preemptOldestHotLocked(task, now) {
				preempted = true
			}
		}

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

// markInProgress adds a freshly-dispatched task to the appropriate
// in-progress index. Caller must hold s.mu.
func (s *scheduler) markInProgress(task *taskHandle) {
	if task.subscription {
		s.inProgressSubs[task.key] = task
		return
	}
	if task.hotDeadline.IsZero() {
		// Non-subscription, non-hot tasks aren't expected to land here —
		// scheduleNext deletes them — but be defensive.
		return
	}
	s.inProgressHot.Push(task)
}

// markFinished removes a completing or cancelling task from the in-progress
// indexes. Idempotent: safe to call after preemption/cleanup paths have
// already removed the task to keep it from being picked again.
// Caller must hold s.mu.
func (s *scheduler) markFinished(task *taskHandle) {
	if existing, ok := s.inProgressSubs[task.key]; ok && existing == task {
		delete(s.inProgressSubs, task.key)
	}
	if task.hotIndex.IsSet() {
		s.inProgressHot.Remove(task.hotIndex.Value())
	}
}

// enqueueLocked inserts or reorders the task in the queue. Caller must hold
// s.mu. Must not be called while task.state == TaskStateInProgress.
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
//
// Pops the victim from inProgressSubs eagerly so a follow-up preemption in
// the same dispatch sweep doesn't pick the same task.
func (s *scheduler) preemptSubscriptionLocked() bool {
	for key, t := range s.inProgressSubs {
		if t.cancelFunc == nil {
			continue
		}
		delete(s.inProgressSubs, key)
		t.cancelFunc()
		s.preemptSubsCount.Add(1)
		return true
	}
	return false
}

// preemptOldestHotLocked cancels the in-flight ephemeral hot task with the
// oldest hotDeadline so a newer hot task (`incoming`) can take its worker
// slot. The preempted task re-enters the hot tier via executeTask's
// cancellation branch. Returns true if a task was preempted. Caller must
// hold s.mu.
func (s *scheduler) preemptOldestHotLocked(incoming *taskHandle, now time.Time) bool {
	if s.inProgressHot.Len() == 0 {
		return false
	}
	victim := s.inProgressHot.Peek()
	if victim.key == incoming.key {
		return false
	}
	if !victim.IsHot(now) {
		// Heartbeat already expired; cleanupExpiredHotTasksLocked will reap it.
		return false
	}
	// Victim must have a strictly older heartbeat than the incoming task;
	// otherwise preempting just delays the user's most recent request.
	if !victim.hotDeadline.Before(incoming.hotDeadline) {
		return false
	}
	if victim.cancelFunc == nil {
		return false
	}
	s.inProgressHot.Remove(victim.hotIndex.Value())
	victim.cancelFunc()
	s.preemptHotCount.Add(1)
	return true
}

// cleanupExpiredHotTasksLocked cancels in-progress ephemeral hot tasks whose
// heartbeat deadline has expired (the frontend stopped polling, meaning the
// user is no longer viewing that document). Caller must hold s.mu.
//
// Idle-but-queued ephemeral hot tasks whose deadline expired are reaped
// lazily by the dispatch-loop tier-migration check, so we don't sweep the
// queue here.
func (s *scheduler) cleanupExpiredHotTasksLocked(now time.Time) {
	for s.inProgressHot.Len() > 0 {
		head := s.inProgressHot.Peek()
		if !head.hotDeadline.Before(now) {
			return
		}
		s.inProgressHot.Remove(head.hotIndex.Value())
		if head.cancelFunc != nil {
			head.cancelFunc()
		}
	}
}

// boundedWake narrows `candidate` by the earliest in-progress hot-task
// heartbeat expiry so cleanup runs promptly. Caller must hold s.mu.
func (s *scheduler) boundedWake(candidate time.Duration, now time.Time) time.Duration {
	if s.inProgressHot.Len() == 0 {
		return candidate
	}
	head := s.inProgressHot.Peek()
	if head.hotDeadline.IsZero() {
		return candidate
	}
	d := max(head.hotDeadline.Sub(now), 0)
	if d < candidate {
		return d
	}
	return candidate
}

// scheduleNext calculates the next run time and enqueues/fixes the task.
// Subscriptions reschedule on the configured interval. Ephemeral hot tasks
// whose heartbeat is still fresh stay in the map with a short cooldown so
// polling callers can read the last result; cleanupExpiredHotTasksLocked
// drops them once the heartbeat expires. Ephemeral tasks whose heartbeat
// has already expired are dropped immediately.
// Caller must hold s.mu.
func (s *scheduler) scheduleNext(task *taskHandle, now time.Time, forceImmediate bool) {
	switch {
	case forceImmediate || task.runCount == 0:
		task.nextRunTime = now
	case task.subscription:
		task.nextRunTime = now.Add(s.cfg.Interval)
	case task.IsHot(now):
		task.nextRunTime = now.Add(defaultHotCooldown)
	default:
		if task.queueIndex.IsSet() {
			s.queue.Remove(task.queueIndex.Value())
		}
		delete(s.tasks, task.key)
		return
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

// SchedulerSnapshot is a point-in-time view of scheduler internals,
// surfaced via /debug/network so we can confirm whether preemption ever
// fires in production without standing up a metrics scraper. All fields
// are cumulative since process start except Tasks/Queue/InProgress*, which
// are instantaneous.
type SchedulerSnapshot struct {
	TasksTotal             int
	QueueLen               int
	InProgress             int
	InProgressHot          int
	InProgressSubscription int
	PreemptHotCount        uint64
	PreemptSubsCount       uint64
}

// snapshot returns a consistent view of the scheduler counters.
func (s *scheduler) snapshot() SchedulerSnapshot {
	s.mu.Lock()
	defer s.mu.Unlock()
	return SchedulerSnapshot{
		TasksTotal:             len(s.tasks),
		QueueLen:               s.queue.Len(),
		InProgress:             s.inProgress,
		InProgressHot:          s.inProgressHot.Len(),
		InProgressSubscription: len(s.inProgressSubs),
		PreemptHotCount:        s.preemptHotCount.Load(),
		PreemptSubsCount:       s.preemptSubsCount.Load(),
	}
}
