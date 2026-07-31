package syncing

import (
	"testing"

	"github.com/stretchr/testify/require"
)

// TestTierSatisfiedRequiresReachingSomeone is the trap in the escalation gate.
// When every peer in a tier fails, nothing gets reconciled, so `outstanding`
// is 0 — which is byte-for-byte what "we are fully in sync" looks like. Without
// the NumSyncOK check the wave would stop at a tier that reached nobody and
// silently never try the next one.
func TestTierSatisfiedRequiresReachingSomeone(t *testing.T) {
	var res SyncResult
	var prog Progress

	require.False(t, tierSatisfied(&res, &prog),
		"a tier that reached nobody must escalate, not look satisfied")

	res.NumSyncOK = 1
	require.True(t, tierSatisfied(&res, &prog),
		"reached a peer and nothing is outstanding: done")
}

// TestTierSatisfiedWaitsForOutstandingWork: a tier that found content we have
// not downloaded yet is not finished, so we must not escalate past it — nor
// declare the wave done.
func TestTierSatisfiedWaitsForOutstandingWork(t *testing.T) {
	var res SyncResult
	var prog Progress
	res.NumSyncOK = 1

	prog.MaxReconciledWants.Store(50)
	prog.BlobsDownloaded.Store(10)
	require.False(t, tierSatisfied(&res, &prog), "40 blobs still owed")

	prog.BlobsDownloaded.Store(50)
	require.True(t, tierSatisfied(&res, &prog), "everything reconciled has landed")

	// Downloads can exceed the max single-peer reconcile when several peers each
	// contribute; that is still satisfied, not a negative backlog.
	prog.BlobsDownloaded.Store(70)
	require.True(t, tierSatisfied(&res, &prog))
}

// TestPeerTierNamesCoverEveryTier keeps the metric labels aligned with the
// constants, since they are indexed positionally.
func TestPeerTierNamesCoverEveryTier(t *testing.T) {
	require.Len(t, peerTierNames, numPeerTiers)
	require.Equal(t, "authority", peerTierNames[peerTierAuthority])
	require.Equal(t, "connected", peerTierNames[peerTierConnected])
	require.Equal(t, "cold", peerTierNames[peerTierCold])
}
