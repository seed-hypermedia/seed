package syncing

import (
	"context"
	"math"
	"seed/backend/blob"
	"seed/backend/util/heap"
	"sync"
	"time"
)

// Task timing constants.
const (
	// ephemeralLastCallTTL is how long an ephemeral task waits after the last API call before evicting.
	ephemeralLastCallTTL = 40 * time.Second

	// ephemeralRefreshInterval is how often an ephemeral task (or a woken subscription task) refreshes.
	ephemeralRefreshInterval = 20 * time.Second
)

// TaskState represents the current state of a discovery task.
type TaskState uint8

// Task state constants.
const (
	TaskStateIdle TaskState = iota
	TaskStateInProgress
	TaskStateCompleted
)

// DiscoveryTaskInfo contains the current state and progress of a discovery task.
type DiscoveryTaskInfo struct {
	State          TaskState
	Progress       *DiscoveryProgress
	Result         blob.Version
	LastResultTime time.Time
	LastErr        error
	CallCount      int
}

// taskState holds the state for a single discovery task.
type taskState struct {
	key DiscoveryKey

	// Scheduling fields (protected by scheduler.mu).
	heapIndex    int
	nextRunTime  time.Time
	onDemand     bool
	subscription bool

	// Result fields (protected by mu).
	mu           sync.Mutex
	info         DiscoveryTaskInfo
	lastCallTime time.Time
}

// GetInfo returns current task info for API callers.
func (t *taskState) GetInfo() DiscoveryTaskInfo {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.info
}

// MarkInProgress sets state to in-progress and creates a new progress tracker.
func (t *taskState) MarkInProgress() *DiscoveryProgress {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.info.State = TaskStateInProgress
	t.info.Progress = &DiscoveryProgress{}
	return t.info.Progress
}

// Complete updates result, error, and marks state as completed.
func (t *taskState) Complete(result blob.Version, err error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.info.State = TaskStateCompleted
	t.info.Result = result
	t.info.LastErr = err
	t.info.LastResultTime = time.Now()
}

// RecordCall updates on-demand call tracking.
func (t *taskState) RecordCall() {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.lastCallTime = time.Now()
	t.info.CallCount++
}

// isOnDemandActive returns true if an on-demand caller is actively polling.
func (t *taskState) isOnDemandActive() bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	return time.Since(t.lastCallTime) <= ephemeralLastCallTTL
}

// scheduler manages discovery tasks with a bounded worker pool.
type scheduler struct {
	svc *Service

	mu    sync.Mutex
	tasks map[DiscoveryKey]*taskState
	queue *heap.Heap[*taskState]
	wake  chan struct{} // Signal to wake scheduler loop.

	workerChan chan *taskState // Channel for sending tasks to persistent workers.
	wg         sync.WaitGroup

	minWorkers int
	maxWorkers int
	burstSem   chan struct{} // Semaphore for burst workers (capacity = maxWorkers - minWorkers).
}

// newScheduler creates a new scheduler.
func newScheduler(svc *Service, minWorkers, maxWorkers int) *scheduler {
	burstCapacity := maxWorkers - minWorkers
	if burstCapacity < 0 {
		burstCapacity = 0
	}

	s := &scheduler{
		svc:        svc,
		tasks:      make(map[DiscoveryKey]*taskState),
		wake:       make(chan struct{}, 1),
		workerChan: make(chan *taskState, minWorkers), // Buffer for persistent workers.
		minWorkers: minWorkers,
		maxWorkers: maxWorkers,
		burstSem:   make(chan struct{}, burstCapacity), // Semaphore for burst workers.
	}

	s.queue = heap.New(func(a, b *taskState) bool {
		// On-demand tasks have higher priority (come first).
		if a.onDemand != b.onDemand {
			return a.onDemand
		}
		return a.nextRunTime.Before(b.nextRunTime)
	})

	// Track heap indices for Fix/Remove operations.
	s.queue.OnSwap = func(data []*taskState, i, j int) {
		data[i].heapIndex = i
		data[j].heapIndex = j
	}

	return s
}

// run is the main scheduler loop. It should be called in a goroutine.
func (s *scheduler) run(ctx context.Context) error {
	defer s.wg.Wait()

	// Start persistent workers.
	for i := 0; i < s.minWorkers; i++ {
		s.wg.Go(func() {
			s.worker(ctx)
		})
	}

	timer := time.NewTimer(1) // Fire the timer immediately for the first run.
	defer timer.Stop()

	for {
		s.mu.Lock()
		s.evictStaleTasks()
		s.dispatchReadyTasks(ctx)
		nextWake := s.nextWakeTime()
		s.mu.Unlock()

		timer.Reset(time.Until(nextWake))

		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-s.wake:
			// Woken by enqueue or markOnDemandCall.
		case <-timer.C:
			// Timer fired, tasks may be ready.
		}
	}
}

// worker processes tasks from the workerChan.
func (s *scheduler) worker(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case task, ok := <-s.workerChan:
			if !ok {
				return
			}
			s.executeTask(ctx, task)
		}
	}
}

// executeTask runs the discovery for a task and updates its state.
// Task must already be marked as InProgress before calling this.
func (s *scheduler) executeTask(ctx context.Context, task *taskState) {
	task.mu.Lock()
	prog := task.info.Progress
	task.mu.Unlock()

	result, err := s.svc.DiscoverObjectWithProgress(
		ctx,
		task.key.IRI,
		task.key.Version,
		task.key.Recursive,
		prog,
	)

	task.Complete(result, err)
	isOnDemandActive := task.isOnDemandActive()

	// Update scheduler fields under s.mu.
	s.mu.Lock()
	defer s.mu.Unlock()

	now := time.Now()

	// Schedule next run based on task type and state.
	if isOnDemandActive {
		// On-demand caller still active, use faster refresh.
		task.nextRunTime = now.Add(ephemeralRefreshInterval)
		task.onDemand = true
	} else if task.subscription {
		// Subscription task, use normal interval.
		task.nextRunTime = now.Add(s.svc.cfg.Interval)
		task.onDemand = false
	} else {
		// Pure ephemeral task with no active callers, will be evicted.
		delete(s.tasks, task.key)
		return
	}

	s.enqueueUnsafe(task)
	s.wakeScheduler()
}

// enqueue adds or updates a task in the scheduler.
func (s *scheduler) enqueue(iri blob.IRI, version blob.Version, recursive, subscription bool) *taskState {
	s.mu.Lock()
	defer s.mu.Unlock()

	key := DiscoveryKey{IRI: iri, Version: version, Recursive: recursive}

	task, exists := s.tasks[key]
	if exists {
		if subscription && !task.subscription {
			task.subscription = true
			task.nextRunTime = time.Now()

			if task.heapIndex >= 0 {
				s.queue.Fix(task.heapIndex)
			} else {
				s.enqueueUnsafe(task)
			}
			s.wakeScheduler()
		}
		return task
	}

	// Create new task.
	now := time.Now()
	task = &taskState{
		key:          key,
		subscription: subscription,
		nextRunTime:  now,
		heapIndex:    -1,
		lastCallTime: now,
	}
	s.tasks[key] = task

	s.enqueueUnsafe(task)
	s.wakeScheduler()

	return task
}

// markOnDemandCall marks a task for on-demand discovery.
// Returns the current task state for progress reporting.
func (s *scheduler) markOnDemandCall(iri blob.IRI, version blob.Version, recursive bool) *taskState {
	s.mu.Lock()
	defer s.mu.Unlock()

	key := DiscoveryKey{IRI: iri, Version: version, Recursive: recursive}

	task, exists := s.tasks[key]
	if !exists {
		// Create new ephemeral task.
		now := time.Now()
		task = &taskState{
			key:          key,
			onDemand:     true,
			nextRunTime:  now,
			heapIndex:    -1,
			lastCallTime: now,
		}
		s.tasks[key] = task
		s.enqueueUnsafe(task)
		s.wakeScheduler()
	} else {
		// Update existing task's ephemeral fields.
		task.RecordCall()
		task.onDemand = true

		// If not running and not in queue, re-enqueue with priority.
		if task.info.State != TaskStateInProgress && task.heapIndex == -1 {
			task.nextRunTime = time.Now()
			s.enqueueUnsafe(task)
			s.wakeScheduler()
		} else if task.heapIndex >= 0 {
			// Already in queue, fix priority.
			s.queue.Fix(task.heapIndex)
		}
	}

	return task
}

// removeSubscriptionUnsafe removes a subscription. Caller must hold s.mu.
func (s *scheduler) removeSubscriptionUnsafe(key DiscoveryKey) {
	task, exists := s.tasks[key]
	if !exists {
		return
	}

	task.subscription = false

	// If no active on-demand callers and not running, remove immediately.
	if !task.isOnDemandActive() && task.info.State != TaskStateInProgress {
		if task.heapIndex >= 0 {
			s.queue.Remove(task.heapIndex)
		}
		delete(s.tasks, key)
	}
}

// enqueueUnsafe adds a task to the queue. Caller must hold s.mu.
func (s *scheduler) enqueueUnsafe(task *taskState) {
	if task.heapIndex >= 0 {
		return // Already in queue.
	}
	s.queue.Push(task)
	task.heapIndex = s.queue.Len() - 1
}

// dispatchReadyTasks sends ready tasks to workers. Caller must hold s.mu.
func (s *scheduler) dispatchReadyTasks(ctx context.Context) {
	now := time.Now()
	for s.queue.Len() > 0 {
		task := s.queue.Peek()

		// Check if task is already running or not ready yet.
		task.mu.Lock()
		isRunning := task.info.State == TaskStateInProgress
		task.mu.Unlock()
		if isRunning {
			// Task is already running (e.g. triggered by on-demand or subscription update).
			// Remove from queue to avoid head-of-line blocking.
			// It will be re-enqueued when the current execution finishes.
			s.queue.Pop()
			task.heapIndex = -1
			continue
		}

		if task.nextRunTime.After(now) {
			break
		}

		s.queue.Pop()
		task.heapIndex = -1

		// Mark as in-progress before sending to worker.
		prog := task.MarkInProgress()

		// Try to send to persistent workers first.
		select {
		case s.workerChan <- task:
			continue
		default:
			// For on-demand tasks, try to spawn a burst worker.
			if task.onDemand {
				select {
				case s.burstSem <- struct{}{}:
					s.wg.Go(func() {
						s.burstWorker(ctx, task, prog)
					})
					continue
				default:
				}
			}
			// Couldn't dispatch, reset state and put back in queue.
			task.mu.Lock()
			task.info.State = TaskStateIdle
			task.mu.Unlock()
			s.enqueueUnsafe(task)
			return
		}
	}
}

// burstWorker is a temporary worker for on-demand tasks.
func (s *scheduler) burstWorker(ctx context.Context, task *taskState, _ *DiscoveryProgress) {
	defer func() { <-s.burstSem }()
	s.executeTask(ctx, task)
}

// evictStaleTasks removes ephemeral tasks that haven't been called recently. Caller must hold s.mu.
func (s *scheduler) evictStaleTasks() {
	for key, task := range s.tasks {
		if task.subscription || task.info.State == TaskStateInProgress {
			continue
		}
		if !task.isOnDemandActive() && task.heapIndex == -1 {
			delete(s.tasks, key)
		}
	}
}

// nextWakeTime returns when the scheduler should next wake. Caller must hold s.mu.
func (s *scheduler) nextWakeTime() time.Time {
	if s.queue.Len() == 0 {
		// If no tasks in the queue we should sleep until woken up.
		return time.Unix(math.MaxInt64, 0)
	}
	return s.queue.Peek().nextRunTime
}

// wakeScheduler signals the scheduler loop to wake up.
func (s *scheduler) wakeScheduler() {
	select {
	case s.wake <- struct{}{}:
	default:
	}
}
