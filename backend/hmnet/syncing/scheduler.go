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
	"time"

	"golang.org/x/sync/errgroup"
)

const (
	defaultHotTTL      = 40 * time.Second
	defaultHotCooldown = 10 * time.Second
	// progressGrace is how recently a running task must have downloaded a block to
	// be considered "actively progressing" and therefore protected from
	// preemption. Under a discovery storm (many docs/cards discovered at once)
	// LIFO preemption would otherwise let a newer hot task kill an older one that
	// is mid-download — so nothing ever converges. Protecting in-flight
	// progress lets running discoveries finish; newcomers queue instead.
	progressGrace = 5 * time.Second
	// minDeadlineWake floors wakes derived from deadlines that may already be in
	// the past: an in-progress task whose heartbeat lapsed but whose worker
	// hasn't unwound yet (canceled, still blocked in a fetch), or a due cold
	// task while all workers are saturated. Without the floor those produce
	// zero-duration wakes — the timer refires immediately and rescans the task
	// map thousands of times per second until the blocking condition clears
	// (profiled at ~40% of daemon CPU on a desktop). Reaping or retrying at
	// 100ms granularity is imperceptible. Deliberately NOT applied to
	// resetTimer's ready-hot-task path, which uses a zero wake once per enqueue
	// to dispatch immediately.
	minDeadlineWake = 100 * time.Millisecond
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
	// runningCold marks an in-progress run that was dispatched without a live
	// hot heartbeat and therefore counted against the cold worker cap. Read on
	// unwind to decrement scheduler.inProgressCold. Guarded by scheduler.mu.
	runningCold bool
	// runStartedAt is when the current (or latest) run was dispatched. Young
	// runs are protected from preemption — see isActivelyProgressing.
	runStartedAt time.Time

	// Cancellation. Set by dispatchReadyTasks under s.mu before dispatching, cleared in executeTask's unwind.
	cancelFunc context.CancelFunc
	runCtx     context.Context

	// Progress watermarks for cancellation protection (see isActivelyProgressing).
	// lastDownloaded mirrors progress.BlobsDownloaded and lastReconciled mirrors
	// progress.MaxReconciledWants, each with the time it last advanced. A task that
	// downloaded OR reconciled within progressGrace is "actively progressing" and
	// is protected from both preemption and the hot-TTL reaper. Sampled lazily
	// (only when a cancellation is considered); guarded by scheduler.mu.
	lastDownloaded  int32
	lastDownloadAt  time.Time
	lastReconciled  int32
	lastReconcileAt time.Time

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

// isActivelyProgressing reports whether the task has made discovery progress —
// fetched a block OR grown a peer's reconciled want-count — within progressGrace,
// advancing its watermarks as a side effect. It is the shared "don't cancel a
// converging discovery" check used by all three cancellation paths — subscription
// preemption (preemptSubscriptionLocked), hot preemption (preemptOldestHotLocked)
// and the hot-TTL reaper (cleanupExpiredHotTasksLocked).
//
// Reconcile counts as progress, not just download: a recursive discovery spends
// its first seconds reconciling want-lists with peers before any block arrives,
// and the foreground site sync was being preempted in exactly that window (cut
// with ok=0 downloaded=0, then a full re-cycle). MaxReconciledWants is monotonic,
// so it advances only while new peers are still reconciling — once that settles,
// download progress takes over the protection. A task with no progress tracker,
// or one idle on both signals past the grace, is not protected. Caller must hold
// scheduler.mu (the watermark fields are mutated here).
func (task *taskHandle) isActivelyProgressing(now time.Time) bool {
	// A run younger than progressGrace hasn't had a chance to make visible
	// progress yet: peer selection and auth compute come before any reconcile
	// or download. Killing it there wastes the whole round, and under a
	// post-restart hot storm every newcomer used to murder the previous task
	// at its first step (observed: rounds dying in SELECT over the peers
	// table with SQLITE_INTERRUPT, so a viewed document synced nothing for
	// minutes). Protecting the young window lets every started round reach
	// the phases where the progress signals below take over.
	if !task.runStartedAt.IsZero() && now.Sub(task.runStartedAt) < progressGrace {
		return true
	}
	if task.progress == nil {
		return false
	}
	if dl := task.progress.BlobsDownloaded.Load(); dl > task.lastDownloaded {
		task.lastDownloaded = dl
		task.lastDownloadAt = now
	}
	if !task.lastDownloadAt.IsZero() && now.Sub(task.lastDownloadAt) < progressGrace {
		return true
	}
	if rec := task.progress.MaxReconciledWants.Load(); rec > task.lastReconciled {
		task.lastReconciled = rec
		task.lastReconcileAt = now
	}
	return !task.lastReconcileAt.IsZero() && now.Sub(task.lastReconcileAt) < progressGrace
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

	// inProgress counts tasks that are currently being executed by a worker
	// goroutine. Bounded by cfg.MaxWorkers. Used to detect saturation for
	// preemption decisions.
	inProgress int

	// inProgressCold counts the subset of inProgress runs dispatched without a
	// live hot heartbeat (background subscription rounds). Capped below
	// MaxWorkers by dispatchReadyTasks so one slot always remains for hot
	// tasks: without the reservation, MaxWorkers multi-second cold rounds
	// occupy the whole pool and on-screen discovery waits behind them.
	inProgressCold int

	// Heartbeat TTL for hot tasks. Installed from defaultHotTTL in newScheduler.
	// Tests may assign a smaller value before calling run().
	hotTTL time.Duration

	// lastHotCleanup rate-limits cleanupExpiredHotTasksLocked: both dispatch
	// paths call it on every wake, and a full task-map scan per wake was the
	// single biggest scheduler cost under load.
	lastHotCleanup time.Time
}

// newScheduler creates a new scheduler.
func newScheduler(disc discoverer, cfg config.Syncing) *scheduler {
	if cfg.MaxWorkers == 0 {
		panic("BUG: invalid worker count")
	}

	s := &scheduler{
		disc:   disc,
		cfg:    cfg,
		timer:  time.NewTimer(0),
		tasks:  make(map[DiscoveryKey]*taskHandle),
		hotTTL: defaultHotTTL,
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
	if task.runningCold {
		task.runningCold = false
		s.inProgressCold--
	}

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
		return task.Info()
	}

	if forceImmediate || task.runCount == 0 {
		s.scheduleNext(task, now, forceImmediate)
	} else if opts.isHot {
		retryNow := false
		if task.lastErr != nil {
			retryNow = true
		}
		if task.key.Version != "" && task.result != task.key.Version {
			retryNow = true
		}
		if task.result == "" {
			var peersSyncedOK int32
			if task.progress != nil {
				peersSyncedOK = task.progress.PeersSyncedOK.Load()
			}
			if peersSyncedOK == 0 {
				retryNow = true
			}
		}
		if retryNow {
			task.nextRunTime = now
			if task.result == "" && task.lastErr == nil {
				// An empty result with no successful peer sync usually means
				// we ran before Connect/Identify-side peer bookkeeping caught
				// up. Don't report it as a final completed discovery while a
				// hot caller is still polling; enqueue an immediate retry.
				task.state = TaskStateIdle
				task.progress = nil
			}
			s.enqueueLocked(task, now)
		} else {
			// A hot touch on a task scheduled beyond the hot cooldown — a
			// subscription riding out its background interval — pulls the
			// next run within the cooldown: content on screen must not wait
			// out a background cadence. No-op for ephemeral hot tasks, whose
			// nextRunTime never exceeds the cooldown.
			if soonest := now.Add(defaultHotCooldown); task.nextRunTime.After(soonest) {
				task.nextRunTime = soonest
			}
			if task.queueIndex.IsSet() {
				// Re-touching an already-queued task: its hot deadline (and
				// possibly nextRunTime) changed, which may move it up in the
				// hot tier (LIFO ordering) or migrate it from cold into hot.
				// Re-seat it in the queue.
				s.enqueueLocked(task, now)
			}
		}
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
	// Cold runs may fill every worker slot but one; the last is reserved for
	// hot tasks. Without the reservation, MaxWorkers multi-second subscription
	// rounds occupy the whole pool and a freshly-viewed document waits for a
	// full round (or a lucky preemption) before its discovery even starts.
	// Single-worker pools skip the reservation — a standing reserve would
	// starve cold work entirely there — and rely on the preemption paths
	// below for the hot case.
	coldCap := s.cfg.MaxWorkers
	if coldCap > 1 {
		coldCap--
	}

	// Cold tasks set aside because the cold lane is full. Re-enqueued after
	// the scan: a due hot task can sit behind blocked cold heads (within the
	// cold tier ordering), so the scan must drain past them to reach it.
	var blockedCold []*taskHandle

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
		// end-user devices. Hot tasks always dispatch immediately. The break
		// falls through to the shared wake computation at the bottom, which
		// derives the same head-due wake this path used to return directly.
		const lookAhead = 10 * time.Second
		if task.queueTier == tierCold && task.nextRunTime.After(now.Add(lookAhead)) {
			break
		}

		// A live heartbeat classifies the run as hot for the worker-lane
		// accounting regardless of the tier it happened to be queued in (a
		// hot task riding out its cooldown sits in the cold tier until due).
		isHot := task.IsHot(now)
		if !isHot && s.inProgressCold >= coldCap {
			// Cold lane full: set the task aside and keep scanning — a due
			// hot task deeper in the queue can still take the reserved slot.
			s.queue.Pop()
			blockedCold = append(blockedCold, task)
			continue
		}

		// Task is ready. Pop it from the queue and prepare its run context.
		s.queue.Pop()
		task.state = TaskStateInProgress
		task.progress = &Progress{}
		task.runStartedAt = now
		runParent := ctx
		if isHot {
			// Interactive run: syncWithManyPeers picks the latency-first
			// wave-cut policy for contexts tagged hot.
			runParent = contextWithHotDiscovery(ctx)
		}
		taskCtx, cancel := context.WithCancel(runParent)
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
			if !isHot {
				s.inProgressCold++
				task.runningCold = true
			}
			continue
		}

		// Worker pool is full. For hot tasks, try to make room by preempting
		// a running subscription or the oldest in-flight hot task. The new
		// task goes back into the queue; when the preempted worker unwinds,
		// its tail calls resetTimer so we get re-entered and retry.
		preempted := false
		if task.queueTier == tierHot {
			if s.preemptSubscriptionLocked(now) {
				preempted = true
			} else if s.preemptOldestHotLocked(task, now) {
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

	// Put back any cold tasks the scan set aside; they keep their due times
	// and dispatch as cold slots free up (worker completions re-enter us).
	for _, task := range blockedCold {
		s.enqueueLocked(task, now)
	}

	s.cleanupExpiredHotTasksLocked(now)

	// Sleep forever unless an in-progress hot task's heartbeat is about to
	// expire (so we can cancel it promptly), or a queued cold task becomes due.
	wake := time.Duration(math.MaxInt64)
	if s.queue.Len() > 0 {
		top := s.queue.Peek()
		if top.queueTier == tierCold {
			// Floored: a cold task can be already due when the dispatch loop
			// broke on worker saturation; a zero wake would spin the timer
			// until a worker frees up (completions re-enter us anyway).
			if d := max(top.nextRunTime.Sub(now), minDeadlineWake); d < wake {
				wake = d
			}
		}
		// Hot tasks at the head are always "ready"; if we got here without
		// dispatching them it means workers are saturated. Wait for a worker
		// completion to wake us.
	}
	return s.boundedWake(wake, now)
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
func (s *scheduler) preemptSubscriptionLocked(now time.Time) bool {
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
		// Never preempt a subscription that is actively downloading — the same
		// protection preemptOldestHotLocked gives hot tasks (672a978cb), which was
		// never applied here. The foreground site sync is a recursive subscription;
		// when a freshly-rendered card (a new hot task) needs a slot, killing the
		// site sync mid-download throws away thousands of in-flight blobs AND
		// reschedules it a full Interval later — the exact multi-cycle cold-sync
		// stall (measured: connected_sync "context canceled" at 18s, then a ~1.7min
		// dead gap). A stalled/idle subscription is still fair game; if every
		// subscription is downloading, the hot task queues until a slot frees.
		if t.isActivelyProgressing(now) {
			continue
		}
		t.cancelFunc()
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
		// Never preempt a task that is actively downloading: under a storm of
		// concurrent discoveries, LIFO preemption used to let a newer hot task
		// (e.g. a card rendered after the home) cancel an older one mid-download, so
		// nothing ever finished. Protected tasks stay; the newcomer queues until a
		// slot frees.
		if t.isActivelyProgressing(now) {
			continue
		}
		// Victim must have a strictly older heartbeat than the incoming task;
		// otherwise preempting just delays the user's most recent request.
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
	// At most one full task-map scan per second: reaping a lapsed heartbeat up
	// to a second late is imperceptible, while scanning on every wake is not
	// (profiled at ~20% of daemon CPU).
	if now.Sub(s.lastHotCleanup) < time.Second {
		return
	}
	s.lastHotCleanup = now

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
			// The heartbeat lapsed (frontend stopped polling once the view
			// rendered), but if the task is still actively downloading, the deep
			// structure fetch it kicked off is still streaming and the content is
			// still wanted — keep it alive (extend the heartbeat) so it converges
			// instead of being killed mid-stream and re-queued behind the storm.
			// A stalled expired task (no download within progressGrace) is reaped.
			if t.isActivelyProgressing(now) {
				t.hotDeadline = now.Add(s.hotTTL)
				continue
			}
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
//
// Expired deadlines are floored at minDeadlineWake, not zero: an in-progress
// task past its heartbeat stays in that state until its worker unwinds, and a
// zero wake would refire the timer (and rescan the task map) continuously for
// that whole window.
func (s *scheduler) boundedWake(candidate time.Duration, now time.Time) time.Duration {
	for _, t := range s.tasks {
		if t.state != TaskStateInProgress || t.subscription {
			continue
		}
		if t.hotDeadline.IsZero() {
			continue
		}
		d := max(t.hotDeadline.Sub(now), minDeadlineWake)
		if d < candidate {
			candidate = d
		}
	}
	return candidate
}

// scheduleNext calculates the next run time and enqueues/fixes the task.
// Tasks with a fresh hot heartbeat reschedule on the short hot cooldown —
// including subscriptions: a subscribed space that is actively being viewed
// must re-sync at interactive cadence instead of waiting out the background
// interval (checking subscription first used to shadow the heartbeat, so
// viewing a subscribed space was stuck on the interval cadence). A
// subscription whose heartbeat lapses falls back to the configured interval
// on its next completion. Ephemeral hot tasks whose heartbeat is still fresh
// stay in the map with the cooldown so polling callers can read the last
// result; cleanupExpiredHotTasksLocked drops them once the heartbeat
// expires. Ephemeral tasks whose heartbeat has already expired are dropped
// immediately.
// Caller must hold s.mu.
func (s *scheduler) scheduleNext(task *taskHandle, now time.Time, forceImmediate bool) {
	switch {
	case forceImmediate || task.runCount == 0:
		task.nextRunTime = now
	case task.IsHot(now):
		task.nextRunTime = now.Add(defaultHotCooldown)
	case task.subscription:
		task.nextRunTime = now.Add(s.cfg.Interval)
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
