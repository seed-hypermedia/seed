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

// Task timing constants.
const (
	// hotTTL is how long the hot mode lasts after the last heartbeat.
	hotTTL = 40 * time.Second

	// hotInterval is how often a task refreshes while in on-demand mode.
	hotInterval = 20 * time.Second
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
	nextRunTime  time.Time
	subscription bool
	hotDeadline  time.Time
	runCount     uint64 // Number of times task has been executed.

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

// scheduler manages discovery tasks with a bounded worker pool,
// allowing for bursts of hot tasks.
type scheduler struct {
	workers errgroup.Group

	disc discoverer
	cfg  config.Syncing

	mu      sync.Mutex
	timer   *time.Timer
	tasks   map[DiscoveryKey]*taskHandle
	queue   *heap.Heap[*taskHandle]
	workerc chan *taskHandle // Channel for sending tasks to persistent workers.
}

// newScheduler creates a new scheduler.
func newScheduler(disc discoverer, cfg config.Syncing) *scheduler {
	if cfg.MinWorkers == 0 || cfg.MaxWorkers == 0 || cfg.MaxWorkers < cfg.MinWorkers {
		panic("BUG: invalid worker count")
	}

	s := &scheduler{
		disc:    disc,
		cfg:     cfg,
		timer:   time.NewTimer(0),
		tasks:   make(map[DiscoveryKey]*taskHandle),
		workerc: make(chan *taskHandle, cfg.MinWorkers),
		queue: heap.New(func(a, b *taskHandle) bool {
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
		close(s.workerc)
		err = errors.Join(err, s.workers.Wait())
	}()

	// Start persistent workers.
	for range s.cfg.MinWorkers {
		s.workers.Go(func() error {
			for task := range s.workerc {
				s.executeTask(ctx, task)
			}
			return nil
		})
	}

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

// executeTask runs discovery and updates task state directly.
func (s *scheduler) executeTask(ctx context.Context, task *taskHandle) {
	// Read progress pointer (set by scheduler before dispatch).
	prog := task.progress

	result, err := s.disc.DiscoverObjectWithProgress(
		ctx,
		task.key.IRI,
		task.key.Version,
		task.key.Recursive,
		prog,
	)

	s.mu.Lock()
	defer s.mu.Unlock()

	now := time.Now()

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
		task.hotDeadline = now.Add(hotTTL)
	}

	if (forceImmediate || task.runCount == 0) && task.state != TaskStateInProgress {
		s.scheduleNext(task, now, forceImmediate)
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

		// Because this scheduler runs on end-user devices we want to clump up the tasks,
		// instead of spreading them out for a steady stream. This should be more forgiving for device batteries,
		// and overall efficiency on constrained devices. This is why we don't add any jitter when scheduling,
		// and instead look ahead a little bit into the future when dequeuing tasks — to group them while we are awake.
		const lookAhead = 10 * time.Second
		if task.nextRunTime.After(now.Add(lookAhead)) {
			// Most urgent task is not due yet.
			// Sleep until then.
			return task.nextRunTime.Sub(now)
		}

		// Task is ready. Pop it from the queue.
		s.queue.Pop()

		// Prepare the task for execution.
		task.state = TaskStateInProgress
		task.progress = &Progress{}

		// Try to send to persistent workers first.
		select {
		case s.workerc <- task:
			continue
		default:
			// Workers busy. Try burst worker for hot tasks.
			if task.IsHot(now) && s.workers.TryGo(func() error {
				s.executeTask(ctx, task)
				return nil
			}) {
				// Dispatched to burst worker.
				// Move to next task.
				continue
			}
		}

		// All workers are busy. Can't dispatch.
		// Reset and re-queue the current task,
		// and stop processing the queue.
		task.state = TaskStateIdle
		task.progress = nil
		s.enqueue(task)
		break
	}

	// Nothing in the queue, or workers are busy.
	// Sleep forever until woken up by an available worker.
	return time.Duration(math.MaxInt64)
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
		task.nextRunTime = now.Add(hotInterval)
	case !isHot && task.subscription:
		task.nextRunTime = now.Add(s.cfg.Interval)
	case !isHot && !task.subscription:
		// Not hot, nor a subscription, delete the task.
		delete(s.tasks, task.key)
		return
	default:
		panic("BUG: unreachable")
	}

	if task.queueIndex.IsSet() {
		s.queue.Fix(task.queueIndex.Value())
	} else {
		s.queue.Push(task)
	}
}

// enqueue adds a task to the queue. Caller must hold s.mu.
func (s *scheduler) enqueue(task *taskHandle) {
	if task.queueIndex.IsSet() {
		return // Already in queue.
	}
	s.queue.Push(task)
}

// resetTimer resets the timer for the scheduler.
// Caller must hold s.mu.
func (s *scheduler) resetTimer(now time.Time) {
	if s.queue.Len() == 0 {
		// If nothing is in the queue we sleep forever until woken up by new tasks.
		s.timer.Reset(time.Duration(math.MaxInt64))
	} else {
		// If there are tasks in the queue, wake up at the next scheduled time.
		s.timer.Reset(s.queue.Peek().nextRunTime.Sub(now))
	}
}
