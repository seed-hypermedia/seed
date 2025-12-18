package taskmanager

import (
	"errors"
	"fmt"
	"sync"

	daemonpb "seed/backend/genproto/daemon/v1alpha"

	"google.golang.org/protobuf/proto"
)

var (
	ErrTaskExists  = errors.New("task already exists")
	ErrTaskMissing = errors.New("task not found")
	ErrTaskIDEmpty = errors.New("task id must not be empty")
)

// TaskManager manages long-running tasks and the global daemon state.
type TaskManager struct {
	mu          sync.Mutex
	tasks       map[string]*daemonpb.Task
	globalState daemonpb.State
}

// NewTaskManager creates a new TaskManager.
func NewTaskManager() *TaskManager {
	return &TaskManager{
		tasks:       make(map[string]*daemonpb.Task),
		globalState: daemonpb.State_STARTING,
	}
}

// AddTask adds a new task with the given ID, name, and description.
func (m *TaskManager) AddTask(id string, name daemonpb.TaskName, description string, total int64) (*daemonpb.Task, error) {
	if id == "" {
		return nil, ErrTaskIDEmpty
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	if _, exists := m.tasks[id]; exists {
		return nil, fmt.Errorf("task %q: %w", id, ErrTaskExists)
	}

	task := &daemonpb.Task{
		TaskName:    name,
		Description: description,
		Total:       total,
		Completed:   0,
	}
	m.tasks[id] = task

	return cloneTask(task), nil
}

// UpdateGlobalState updates the global daemon state.
func (m *TaskManager) UpdateGlobalState(state daemonpb.State) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.globalState = state
}

// GlobalState returns the current global daemon state.
func (m *TaskManager) GlobalState() daemonpb.State {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.globalState
}

// UpdateProgress updates the progress of the given task.
func (m *TaskManager) UpdateProgress(id string, total int64, completed int64) (*daemonpb.Task, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	task, ok := m.tasks[id]
	if !ok {
		return nil, fmt.Errorf("task %q: %w", id, ErrTaskMissing)
	}

	if completed > total {
		return nil, fmt.Errorf("task %q: completed %d exceeds total %d", id, completed, total)
	}

	task.Total = total
	task.Completed = completed
	return cloneTask(task), nil
}

// DeleteTask deletes the given task.
func (m *TaskManager) DeleteTask(id string) (*daemonpb.Task, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	task, ok := m.tasks[id]
	if !ok {
		return nil, fmt.Errorf("task %q: %w", id, ErrTaskMissing)
	}

	delete(m.tasks, id)
	return cloneTask(task), nil
}

// Tasks returns the list of current tasks.
func (m *TaskManager) Tasks() []*daemonpb.Task {
	m.mu.Lock()
	defer m.mu.Unlock()

	list := make([]*daemonpb.Task, 0, len(m.tasks))
	for _, task := range m.tasks {
		list = append(list, cloneTask(task))
	}

	return list
}

func cloneTask(t *daemonpb.Task) *daemonpb.Task {
	if t == nil {
		return nil
	}

	clone := proto.Clone(t)
	if task, ok := clone.(*daemonpb.Task); ok {
		return task
	}

	return nil
}
