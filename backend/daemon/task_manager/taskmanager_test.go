package taskmanager

import (
	"errors"
	"testing"

	daemonpb "seed/backend/genproto/daemon/v1alpha"
)

func TestTaskManagerLifecycle(t *testing.T) {
	tm := NewTaskManager()

	if _, err := tm.AddTask("reindex", daemonpb.TaskName_REINDEXING, "reindex blobs", 10); err != nil {
		t.Fatalf("AddTask: unexpected error: %v", err)
	}

	if _, err := tm.AddTask("reindex", daemonpb.TaskName_REINDEXING, "duplicate", 10); !errors.Is(err, ErrTaskExists) {
		t.Fatalf("AddTask duplicate: expected ErrTaskExists, got %v", err)
	}

	if got := tm.Tasks(); len(got) != 1 {
		t.Fatalf("Tasks: expected 1 task, got %d", len(got))
	}

	updated, err := tm.UpdateProgress("reindex", 10, 5)
	if err != nil {
		t.Fatalf("UpdateProgress: unexpected error: %v", err)
	}
	if updated.Completed != 5 {
		t.Fatalf("UpdateProgress: expected completed to be 5, got %v", updated.Completed)
	}

	if _, err := tm.DeleteTask("reindex"); err != nil {
		t.Fatalf("DeleteTask: unexpected error: %v", err)
	}

	if got := tm.Tasks(); len(got) != 0 {
		t.Fatalf("Tasks: expected no tasks after delete, got %d", len(got))
	}
}

func TestTaskManagerGlobalState(t *testing.T) {
	tm := NewTaskManager()

	if state := tm.GlobalState(); state != daemonpb.State_STARTING {
		t.Fatalf("GlobalState: expected STARTING, got %v", state)
	}

	tm.UpdateGlobalState(daemonpb.State_MIGRATING)

	if state := tm.GlobalState(); state != daemonpb.State_MIGRATING {
		t.Fatalf("GlobalState: expected MIGRATING, got %v", state)
	}
}
