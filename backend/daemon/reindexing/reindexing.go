// Package reindexing provides helpers for tracking blob reindex work in the daemon task manager.
package reindexing

import (
	"context"
	"errors"
	"sync"
	"time"

	"seed/backend/blob"
	taskmanager "seed/backend/daemon/taskmanager"
	daemonpb "seed/backend/genproto/daemon/v1alpha"

	"go.uber.org/zap"
)

const (
	blobTaskID          = "blob_reindex"
	blobTaskDescription = "Reindexing blobs"
	blobTaskUpdateEvery = 100 * time.Millisecond
)

type reindexInfoProvider interface {
	ReindexInfo() blob.ReindexInfo
}

// RunBlobReindexTask executes a blob reindex operation while exposing its progress through the task manager.
func RunBlobReindexTask(
	ctx context.Context,
	idx reindexInfoProvider,
	tasks *taskmanager.TaskManager,
	log *zap.Logger,
	run func(context.Context) error,
) error {
	if log == nil {
		log = zap.NewNop()
	}

	if _, err := tasks.AddTask(blobTaskID, daemonpb.TaskName_REINDEXING, blobTaskDescription, 0); err != nil {
		if errors.Is(err, taskmanager.ErrTaskExists) {
			log.Debug("BlobReindexTaskAlreadyRunning")
			return nil
		}

		return err
	}

	stopProgress := make(chan struct{})
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()

		ticker := time.NewTicker(blobTaskUpdateEvery)
		defer ticker.Stop()

		for {
			info := idx.ReindexInfo()
			if _, err := tasks.UpdateProgress(blobTaskID, info.BlobsTotal, info.BlobsIndexed); err != nil && !errors.Is(err, taskmanager.ErrTaskMissing) {
				log.Warn("Failed to update blob reindex task progress", zap.Error(err))
			}

			if info.State == blob.ReindexStateCompleted || info.State == blob.ReindexStateNotNeeded {
				return
			}

			select {
			case <-stopProgress:
				return
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
		}
	}()

	err := run(ctx)
	close(stopProgress)
	wg.Wait()

	if _, derr := tasks.DeleteTask(blobTaskID); derr != nil && !errors.Is(derr, taskmanager.ErrTaskMissing) {
		log.Warn("Failed to delete blob reindex task", zap.Error(derr))
		err = errors.Join(err, derr)
	}

	return err
}
