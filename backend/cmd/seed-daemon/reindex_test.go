package main

import (
	"bytes"
	"context"
	"strings"
	"sync"
	"testing"
	"time"

	"seed/backend/blob"

	"github.com/stretchr/testify/require"
)

// fakeReindex hands out a scripted sequence of progress snapshots, one per call,
// and cancels the reporter once the script runs out.
type fakeReindex struct {
	mu     sync.Mutex
	steps  []blob.ReindexInfo
	cancel context.CancelFunc
}

func (f *fakeReindex) ReindexInfo() blob.ReindexInfo {
	f.mu.Lock()
	defer f.mu.Unlock()

	info := f.steps[0]
	if len(f.steps) == 1 {
		f.cancel()
	} else {
		f.steps = f.steps[1:]
	}

	return info
}

func TestReportReindexProgress(t *testing.T) {
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()

	idx := &fakeReindex{
		cancel: cancel,
		steps: []blob.ReindexInfo{
			{State: blob.ReindexStateInProgress},
			{State: blob.ReindexStateInProgress, BlobsTotal: 1000, BlobsIndexed: 250},
			{State: blob.ReindexStateInProgress, BlobsTotal: 1000, BlobsIndexed: 1000},
		},
	}

	var out bytes.Buffer

	reportReindexProgress(ctx, &out, idx, time.Millisecond)

	lines := strings.Split(strings.TrimSpace(out.String()), "\n")
	require.Len(t, lines, 3, "must print exactly one line per interval: %q", out.String())
	require.Contains(t, lines[0], "preparing")
	require.Contains(t, lines[1], " 25.0% 250/1000 blobs")
	require.Contains(t, lines[1], "blobs/s, ETA ")
	require.NotContains(t, lines[1], "ETA unknown")
	require.Contains(t, lines[2], "1000/1000 blobs indexed, finalizing")
}
