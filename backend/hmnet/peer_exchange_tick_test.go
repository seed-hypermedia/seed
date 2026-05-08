package hmnet

import (
	"context"
	"errors"
	"fmt"
	"seed/backend/blob"
	"seed/backend/config"
	"seed/backend/core/coretest"
	"seed/backend/core/keystore"
	"seed/backend/logging"
	"seed/backend/storage"
	"seed/backend/util/must"
	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"
	"testing"
	"time"

	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/multiformats/go-multiaddr"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
	"google.golang.org/grpc"
)

// fakePeerIDs returns n distinct, deterministic PIDs derived from the
// known fakeUsers identities so candidate ordering is reproducible.
func fakePeerIDs(t *testing.T, n int) []peer.ID {
	t.Helper()
	names := []string{"alice", "alice-2", "bob", "carol", "david"}
	out := make([]peer.ID, 0, n)
	for i := 0; i < n; i++ {
		name := names[i%len(names)]
		// Skew the second half to avoid duplicates by appending a synthetic
		// suffix index — but coretest only knows the canonical names, so we
		// stop once we've exhausted the table.
		if i >= len(names) {
			t.Fatalf("only %d distinct test PIDs available, asked for %d", len(names), n)
		}
		t2 := coretest.NewTester(name)
		out = append(out, t2.Device.PeerID())
	}
	return out
}

// makeTestNode constructs a real *Node backed by a real test SQLite pool and
// libp2p host. It mirrors networking_test.go's setup but skips Start() so we
// retain control of the peer-exchange goroutine inside individual tests.
func makeTestNode(t *testing.T) *Node {
	t.Helper()

	u := coretest.NewTester("alice")

	db := storage.MakeTestDB(t)
	idx := must.Do2(blob.OpenIndex(context.Background(), db, logging.New("seed/hyper", "debug")))

	cfg := config.Default().P2P
	cfg.Port = 0
	cfg.NoRelay = true
	cfg.BootstrapPeers = nil
	cfg.NoMetrics = true

	ks := keystore.NewMemory()
	must.Do(ks.StoreKey(context.Background(), "main", u.Account))

	n, err := New(cfg, u.Device, ks, db, idx, zap.NewNop())
	require.NoError(t, err)

	errc := make(chan error, 1)
	ctx, cancel := context.WithCancel(context.Background())

	go func() {
		errc <- n.Start(ctx)
	}()

	t.Cleanup(func() {
		err := <-errc
		if err != nil && !errors.Is(err, grpc.ErrServerStopped) {
			t.Fatal(err)
		}
	})

	select {
	case <-n.Ready():
	case err := <-errc:
		require.NoError(t, err)
	}

	t.Cleanup(cancel)

	return n
}

// insertPeers inserts the given peers directly into the peers table with the
// supplied updated_at offsets relative to now (negative seconds = older). The
// addresses column is forced unique because of the table's UNIQUE constraint.
func insertPeers(t *testing.T, db *sqlitex.Pool, pids []peer.ID, updatedAtOffsetSec []int64) {
	t.Helper()
	require.Equal(t, len(pids), len(updatedAtOffsetSec))
	now := time.Now().Unix()
	require.NoError(t, db.WithTx(context.Background(), func(conn *sqlite.Conn) error {
		for i, pid := range pids {
			addr := fmt.Sprintf("/ip4/127.0.0.1/tcp/%d/p2p/%s", 30000+i, pid.String())
			ts := now + updatedAtOffsetSec[i]
			if err := sqlitex.Exec(conn,
				"INSERT INTO peers (pid, addresses, explicitly_connected, created_at, updated_at) VALUES (?, ?, ?, ?, ?);",
				nil, pid.String(), addr, false, ts, ts); err != nil {
				return err
			}
		}
		return nil
	}))
}

func TestPeerExchangeCandidates_OrdersByUpdatedAtDesc(t *testing.T) {
	n := makeTestNode(t)

	pids := fakePeerIDs(t, 4)
	// Index 0: oldest (-3600s), 1: -1800, 2: -60, 3: -10 — so newest first should be 3,2,1,0.
	insertPeers(t, n.db, pids, []int64{-3600, -1800, -60, -10})

	got, err := n.peerExchangeCandidates(context.Background(), nil, 10)
	require.NoError(t, err)
	require.Equal(t, []peer.ID{pids[3], pids[2], pids[1], pids[0]}, got)
}

func TestPeerExchangeCandidates_FreshnessWindowExcludesAncient(t *testing.T) {
	n := makeTestNode(t)

	pids := fakePeerIDs(t, 3)
	// One row beyond 30 days old; must be filtered out by the SQL freshness clause.
	older := -int64((PeerFreshnessWindow + time.Hour).Seconds())
	insertPeers(t, n.db, pids, []int64{-60, older, -120})

	got, err := n.peerExchangeCandidates(context.Background(), nil, 10)
	require.NoError(t, err)
	require.NotContains(t, got, pids[1])
	require.Equal(t, []peer.ID{pids[0], pids[2]}, got)
}

func TestPeerExchangeCandidates_SkipsConnectedAndBootstrap(t *testing.T) {
	u := coretest.NewTester("alice")

	db := storage.MakeTestDB(t)
	idx := must.Do2(blob.OpenIndex(context.Background(), db, logging.New("seed/hyper", "debug")))

	cfg := config.Default().P2P
	cfg.Port = 0
	cfg.NoRelay = true
	cfg.NoMetrics = true

	pids := fakePeerIDs(t, 4)
	// Make pids[0] a bootstrap peer.
	bootstrapMA := must.Do2(multiaddr.NewMultiaddr(
		fmt.Sprintf("/ip4/127.0.0.1/tcp/40001/p2p/%s", pids[0].String())))
	cfg.BootstrapPeers = []peer.AddrInfo{
		{ID: pids[0], Addrs: []multiaddr.Multiaddr{bootstrapMA}},
	}

	ks := keystore.NewMemory()
	must.Do(ks.StoreKey(context.Background(), "main", u.Account))

	n, err := New(cfg, u.Device, ks, db, idx, zap.NewNop())
	require.NoError(t, err)
	t.Cleanup(func() { _ = n.clean.Close() })

	insertPeers(t, db, pids, []int64{-10, -20, -30, -40})

	// Pretend pids[1] is currently connected; combined with the bootstrap
	// exclusion, the only valid candidates are pids[2] and pids[3].
	got, err := n.peerExchangeCandidates(context.Background(), []peer.ID{pids[1]}, 10)
	require.NoError(t, err)
	require.Equal(t, []peer.ID{pids[2], pids[3]}, got)
}

func TestPeerExchangeCandidates_LimitOverfetchAbsorbsSkips(t *testing.T) {
	n := makeTestNode(t)

	pids := fakePeerIDs(t, 5)
	insertPeers(t, n.db, pids, []int64{-10, -20, -30, -40, -50})

	// Skip pids[0] and pids[1]; ask for 3 — implementation should overfetch
	// (limit*2 = 6) so the surviving 3 still come back.
	got, err := n.peerExchangeCandidates(context.Background(), []peer.ID{pids[0], pids[1]}, 3)
	require.NoError(t, err)
	require.Equal(t, []peer.ID{pids[2], pids[3], pids[4]}, got)
}

func TestConnectedSeedPeers_EmptyWhenNoConns(t *testing.T) {
	n := makeTestNode(t)
	require.Empty(t, n.connectedSeedPeers(),
		"a freshly-started node with no peers must report 0 connected Seed peers")
}

func TestRunPeerExchangeTick_NoopWhenNoCandidates(t *testing.T) {
	n := makeTestNode(t)
	// Empty peers table → tick must return promptly with no error and no
	// goroutine fan-out (we have no live peer to actually dial against, so
	// any attempt to dial would expose itself as a hang or test timeout).
	done := make(chan error, 1)
	go func() { done <- n.runPeerExchangeTick(context.Background()) }()
	select {
	case err := <-done:
		require.NoError(t, err)
	case <-time.After(5 * time.Second):
		t.Fatal("runPeerExchangeTick blocked despite empty candidate set")
	}
}

func TestPeerExchangeTickConstants(t *testing.T) {
	// Document the contract the live verification steps in the plan rely on.
	require.Equal(t, 20, targetConnectedPeers)
	require.Equal(t, 60*time.Second, peerExchangeTick)
	require.Equal(t, 8, peerExchangeDialFanout)
}

// Sanity: bitswapWorkerCount honors its 16-worker floor and scales with cores.
func TestBitswapWorkerCountFloor(t *testing.T) {
	got := bitswapWorkerCount()
	require.GreaterOrEqual(t, got, 16, "worker count must respect the 16 floor")
	// Smell-check the upper bound — we never want to exceed boxo's old default
	// dramatically. NumCPU*4 on a typical CI runner (8) = 32, on a 32-core box
	// = 128; this assertion just enforces "sensible".
	require.LessOrEqual(t, got, 4096)
}

