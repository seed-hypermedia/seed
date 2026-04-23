package hmnet

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	p2p "seed/backend/genproto/p2p/v1alpha"
	"seed/backend/hmnet/netutil"
	"seed/backend/util/dqb"
	"sort"
	"strings"
	"sync"
	"time"

	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"

	"github.com/iancoleman/orderedmap"
	"github.com/libp2p/go-libp2p/core/event"
	"github.com/libp2p/go-libp2p/core/network"
	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/libp2p/go-libp2p/core/peerstore"
	"github.com/libp2p/go-libp2p/core/protocol"
	"github.com/libp2p/go-libp2p/p2p/net/swarm"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
	"github.com/sethvargo/go-retry"
	"go.uber.org/zap"
)

const (
	// PeerSharingTimeout is the maximum time to try to store shared peer list.
	PeerSharingTimeout = time.Second * 30
	// CheckProtocolTimeout is the maximum time spent trying to check for protocols.
	CheckProtocolTimeout = time.Second * 12
	// PeerFreshnessWindow is the maximum age of a peer record before we treat it
	// as stale. Peers older than this are rejected on ingress (won't be accepted
	// from peer-exchange) and excluded on egress (won't be shared with others).
	// Active peers bump their updated_at on every direct contact, so only
	// genuinely unseen records age out.
	PeerFreshnessWindow = 30 * 24 * time.Hour
	// suspiciousStaleShare is the fraction of stale rows in a single peer-exchange
	// response above which we log the sharer as suspicious. A healthy peer will
	// have mostly fresh data; a misconfigured/malicious one dumps its whole table.
	suspiciousStaleShare = 0.5
)

var (
	mConnectsInFlight = promauto.NewGauge(prometheus.GaugeOpts{
		Name: "seed_connects_in_flight",
		Help: "Number of connection attempts in progress.",
	})
)

// Increasing the default temporary TTL for peerstore, to ensure that we
// don't forget the addresses between sync intervals.
func init() {
	peerstore.TempAddrTTL = 5 * time.Minute
}

// Connect to a peer using provided addr info.
func (n *Node) Connect(ctx context.Context, info peer.AddrInfo) error {
	return n.connect(ctx, info, false)
}

// ForceConnect is like Connext, but it ignores any backoffs that the network might have.
func (n *Node) ForceConnect(ctx context.Context, info peer.AddrInfo) error {
	return n.connect(ctx, info, true)
}

var qGetPeer = dqb.Str(`
	SELECT
		pid
	FROM peers WHERE pid =:pid LIMIT 1;
`)

func (n *Node) connect(ctx context.Context, info peer.AddrInfo, force bool) (err error) {
	mConnectsInFlight.Inc()
	defer mConnectsInFlight.Dec()

	if info.ID == "" {
		return fmt.Errorf("must specify peer ID to connect")
	}

	isConnected := n.p2p.Host.Network().Connectedness(info.ID) == network.Connected

	didHandshake := false
	if err = n.db.WithSave(ctx, func(conn *sqlite.Conn) error {
		return sqlitex.Exec(conn, qGetPeer(), func(stmt *sqlite.Stmt) error {
			pidStr := stmt.ColumnText(0)
			pid, err := peer.Decode(pidStr)
			if err != nil {
				return err
			}
			if pid.String() != info.ID.String() {
				n.log.Debug("found PID does not equal provided PID", zap.String("found", pid.String()), zap.String("provided", info.ID.String()))
				return fmt.Errorf("found PID does not equal provided PID")
			}
			didHandshake = true
			return nil
		}, info.ID)
	}); err != nil {
		return err
	}

	if isConnected && didHandshake {
		return nil
	}

	log := n.log.With(zap.String("peerID", info.ID.String()))
	ctx, cancel := context.WithTimeout(ctx, netutil.ConnectTimeout)
	defer cancel()

	log.Debug("ConnectStarted")
	defer func() {
		log.Debug("ConnectFinished", zap.Error(err), zap.Any("addrs", info.Addrs))
	}()

	// Since we're explicitly connecting to a peer, we want to clear any backoffs
	// that the network might have at the moment.
	if force {
		sw, ok := n.p2p.Host.Network().(*swarm.Swarm)
		if ok {
			sw.Backoff().Clear(info.ID)
		}
	}
	if err := n.p2p.Host.Connect(ctx, info); err != nil {
		return fmt.Errorf("failed to connect to peer %s: %w", info.ID, err)
	}
	n.p2p.ConnManager().Protect(info.ID, ProtocolSupportKey)
	if err := n.CheckHyperMediaProtocolVersion(ctx, info.ID, n.protocol.Version); err != nil {
		n.p2p.ConnManager().Unprotect(info.ID, ProtocolSupportKey)
		return err
	}

	// Refresh the peer info after we've connected and identified each other.
	info = n.p2p.Peerstore().PeerInfo(info.ID)

	addrsStr := AddrInfoToStrings(info)
	if len(addrsStr) == 0 {
		n.p2p.ConnManager().Unprotect(info.ID, ProtocolSupportKey)
		return fmt.Errorf("Peer with no addresses")
	}
	sort.Strings(addrsStr)
	initialAddrs := strings.ReplaceAll(strings.Join(addrsStr, ","), " ", "")

	if initialAddrs != "" && !n.peerWriteIsRedundant(ctx, info.ID.String(), initialAddrs) {
		if err = n.db.WithTx(ctx, func(conn *sqlite.Conn) error {
			// On direct contact we always bump updated_at, whether or not the address
			// set changed. Gating the update on address change would let an active
			// peer with stable addrs age past our TTL and get pruned despite being
			// alive and healthy. Addresses are still only overwritten when non-empty.
			return sqlitex.Exec(conn, "INSERT INTO peers (pid, addresses, explicitly_connected) VALUES (?, ?, ?) ON CONFLICT(pid) DO UPDATE SET addresses=CASE WHEN excluded.addresses!='' THEN excluded.addresses ELSE addresses END, updated_at=strftime('%s', 'now');", nil, info.ID.String(), initialAddrs, true)
		}); err != nil {
			// Transient write lock contention (e.g. during reindexing) should not
			// fail an otherwise successful P2P connection. The peer address will be
			// persisted on the next identify/connect cycle.
			if !errors.Is(err, sqlitex.ErrBeginImmediateTx) {
				return err
			}
			n.log.Warn("Failing to store peer, will retry later", zap.Error(err))
		}
	}
	return nil
}

// peerWriteIsRedundant returns true when the peers-table row for pid already
// holds the given addresses and was updated within the last 60s. Callers use
// it to short-circuit an INSERT-on-conflict write whose only effect would be
// bumping updated_at by milliseconds — the kind of write that stacks up when
// the scheduler dials the same peer repeatedly or dialStoredPeers re-dials
// peers we bulk-inserted a moment ago. A failed lookup falls through to the
// write rather than silently dropping it.
func (n *Node) peerWriteIsRedundant(ctx context.Context, pid, incomingAddrs string) bool {
	var skip bool
	if err := n.db.WithSave(ctx, func(conn *sqlite.Conn) error {
		return sqlitex.Exec(conn, "SELECT addresses, updated_at FROM peers WHERE pid = ? LIMIT 1;", func(stmt *sqlite.Stmt) error {
			stored := stmt.ColumnText(0)
			updatedAt := stmt.ColumnInt64(1)
			recent := time.Now().Unix()-updatedAt < 60
			// If we have no new addresses to contribute the INSERT would only
			// bump the timestamp; if we do have addresses they must match the
			// stored set for the write to be truly redundant.
			unchanged := incomingAddrs == "" || stored == incomingAddrs
			skip = recent && unchanged
			return nil
		}, pid)
	}); err != nil {
		n.log.Debug("Peer freshness check failed, falling through to write", zap.String("PID", pid), zap.Error(err))
		return false
	}
	return skip
}

// maxSharedPeers caps how many peers we request from a remote node's peer
// table. Requesting the full table (previously math.MaxInt32) caused massive
// protobuf allocations, multiaddr parsing, and downstream goroutine storms.
const maxSharedPeers = 200

func (n *Node) storeRemotePeers(id peer.ID) (err error) {
	n.log.Debug("storeRemotePeers Called", zap.String("PID", id.String()))
	defer n.log.Debug("Exiting storeRemotePeers", zap.String("PID", id.String()), zap.Error(err))
	ctxStore, cancel := context.WithTimeout(context.Background(), PeerSharingTimeout)
	defer cancel()
	ctxDial, cancel2 := context.WithTimeout(ctxStore, 10*time.Second)
	defer cancel2()
	c, err := n.client.Dial(ctxDial, id)
	if err != nil {
		return fmt.Errorf("Could not get p2p client: %w", err)
	}
	om := orderedmap.New()

	if err := n.db.WithSave(ctxStore, func(conn *sqlite.Conn) error {
		return sqlitex.Exec(conn, qListPeers(), func(stmt *sqlite.Stmt) error {
			maStr := stmt.ColumnText(1)
			maList := strings.Split(strings.Trim(maStr, " "), ",")
			info, err := netutil.AddrInfoFromStrings(maList...)
			if err != nil {
				n.log.Warn("We have peers with wrong formatted addresses in our database", zap.String("PID", info.ID.String()), zap.Error(err))
				return err
			}
			om.Set(info.ID.String(), info.Addrs)
			return nil
		}, math.MaxInt64, math.MaxInt64)
	}); err != nil {
		return err
	}
	om.SortKeys(func(keys []string) {
		sort.Strings(keys)
	})
	orderedPeersBytes, err := json.Marshal(om)
	if err != nil {
		return fmt.Errorf("failed to marshal localPeers: %w", err)
	}
	hash := sha256.Sum256(orderedPeersBytes)

	res, err := c.ListPeers(ctxStore, &p2p.ListPeersRequest{PageSize: maxSharedPeers, ListHash: hex.EncodeToString(hash[:])})
	if err != nil {
		return fmt.Errorf("Could not get list of peers from %s: %w", id.String(), err)
	}

	// Ingress freshness filter: drop stale entries from the shared list before
	// we process them. Even if the sharer still remembers a long-dead peer, we
	// shouldn't accept it — it would bloat our table, waste our dial budget,
	// and (if later re-shared by us) re-pollute the peer graph.
	if len(res.Peers) > 0 {
		freshnessThreshold := time.Now().Add(-PeerFreshnessWindow).Unix()
		fresh := res.Peers[:0]
		staleCount := 0
		for _, p := range res.Peers {
			if p.UpdatedAt != nil && p.UpdatedAt.Seconds >= freshnessThreshold {
				fresh = append(fresh, p)
			} else {
				staleCount++
			}
		}
		total := len(res.Peers)
		res.Peers = fresh
		if staleCount > 0 && float64(staleCount)/float64(total) >= suspiciousStaleShare {
			n.log.Warn("Peer-exchange source shared mostly stale data",
				zap.String("PID", id.String()),
				zap.Int("total", total),
				zap.Int("stale", staleCount),
				zap.Int("accepted", len(fresh)))
		} else if staleCount > 0 {
			n.log.Debug("Dropped stale peers from exchange",
				zap.String("PID", id.String()),
				zap.Int("stale", staleCount),
				zap.Int("accepted", len(fresh)))
		}
	}

	if len(res.Peers) > 0 {
		// Store-first: persist peer metadata immediately without blocking on
		// per-peer dials or protocol checks. A background goroutine below
		// dials the freshly-stored peers so discovery.go's Connectedness
		// filter sees them without forcing the caller to wait.
		var vals []any
		var toDial []peer.AddrInfo
		sqlStr := "INSERT INTO peers (pid, addresses, explicitly_connected, updated_at) VALUES "

		for _, p := range res.Peers {
			if p.Id == n.client.me.String() {
				continue
			}
			pid, err := peer.Decode(p.Id)
			if err != nil {
				continue
			}
			if n.cfg.IsBootstrap(pid) {
				continue
			}
			if len(p.Addrs) == 0 {
				continue
			}

			sort.Strings(p.Addrs)
			sqlStr += "(?, ?, ?, ?),"
			vals = append(vals, p.Id, strings.Join(p.Addrs, ","), false, p.UpdatedAt.Seconds)
			if info, err := netutil.AddrInfoFromStrings(p.Addrs...); err == nil {
				toDial = append(toDial, info)
			}
		}

		if len(vals) != 0 {
			sqlStr = sqlStr[:len(sqlStr)-1] + " ON CONFLICT(pid) DO UPDATE SET addresses=excluded.addresses, updated_at=excluded.updated_at WHERE addresses!=excluded.addresses AND excluded.addresses !='' AND excluded.updated_at > updated_at"
			peerCount := len(vals) / 4
			// Give the bulk INSERT its own timeout rather than inheriting ctxStore.
			// ctxStore is scoped to the whole peer-exchange (dial + verify + insert),
			// and on large peer lists the dial phase regularly consumes all 30s of
			// PeerSharingTimeout — leaving zero budget for the INSERT. Before this
			// fresh context, the driver would abort BEGIN IMMEDIATE with
			// SQLITE_INTERRUPT the moment it tried to run, and we'd lose every row
			// we just spent ~30s accumulating. The INSERT itself is fast (O(N)
			// bound-param write of a few hundred rows) so a short dedicated window
			// is enough.
			insertCtx, insertCancel := context.WithTimeout(context.Background(), 15*time.Second)
			var insertErr error
			for attempt := 0; attempt < 3; attempt++ {
				insertErr = n.db.WithTx(insertCtx, func(conn *sqlite.Conn) error {
					return sqlitex.ExecTransient(conn, sqlStr, nil, vals...)
				})
				if insertErr == nil {
					break
				}
				if !errors.Is(insertErr, sqlitex.ErrBeginImmediateTx) {
					insertCancel()
					return insertErr
				}
				if insertCtx.Err() != nil {
					// Our dedicated budget is also gone; no point in more retries.
					break
				}
				n.log.Debug("Bulk peer INSERT busy, retrying",
					zap.Int("peers", peerCount),
					zap.Int("attempt", attempt+1),
					zap.Error(insertErr))
				time.Sleep(time.Duration(attempt+1) * 500 * time.Millisecond)
			}
			insertCancel()
			if insertErr != nil {
				// Still failing after retries. Do NOT silently swallow — this is
				// real data loss that used to be invisible and routinely cost users
				// hundreds of peer-graph entries during startup indexing pressure.
				n.log.Warn("Bulk peer INSERT gave up after retries, peer-exchange rows dropped",
					zap.String("from_peer", id.String()),
					zap.Int("peers_lost", peerCount),
					zap.Error(insertErr))
			}
		}

		if len(toDial) > 0 {
			go n.dialStoredPeers(toDial)
		}
	}

	return nil
}

// dialStoredPeers opens libp2p connections to freshly-stored peers in the
// background. Discovery filters known peers by Connectedness, so peers we've
// only persisted to the DB are invisible until something dials them. This runs
// detached from the caller's context with bounded concurrency; failures are
// logged at debug level only.
func (n *Node) dialStoredPeers(infos []peer.AddrInfo) {
	const maxConcurrentDials = 20
	const perPeerDialTimeout = 10 * time.Second

	ctx, cancel := context.WithTimeout(context.Background(), PeerSharingTimeout)
	defer cancel()

	sem := make(chan struct{}, maxConcurrentDials)
	var wg sync.WaitGroup
	for _, info := range infos {
		if info.ID == "" || len(info.Addrs) == 0 {
			continue
		}
		select {
		case <-ctx.Done():
			wg.Wait()
			return
		case sem <- struct{}{}:
		}
		wg.Add(1)
		go func(info peer.AddrInfo) {
			defer wg.Done()
			defer func() { <-sem }()
			dialCtx, dialCancel := context.WithTimeout(ctx, perPeerDialTimeout)
			defer dialCancel()
			n.p2p.Peerstore().AddAddrs(info.ID, info.Addrs, peerstore.TempAddrTTL)
			if err := n.p2p.Host.Connect(dialCtx, info); err != nil {
				n.log.Debug("BackgroundPeerDialFailed", zap.String("PID", info.ID.String()), zap.Error(err))
			}
		}(info)
	}
	wg.Wait()
}
func (n *Node) onLibp2pConnection(_ context.Context, event event.EvtPeerConnectednessChanged) {
	// Clear authentication for disconnected peers.
	if event.Connectedness == network.NotConnected {
		n.index.ClearPeer(event.Peer)
	}
}

func (n *Node) onLibp2pIdentification(ctx context.Context, event event.EvtPeerIdentificationCompleted) {
	if event.Peer.String() == n.client.me.String() {
		return
	}

	connectedness := n.Libp2p().Network().Connectedness(event.Peer)
	if connectedness != network.Connected {
		return
	}

	if err := n.CheckHyperMediaProtocolVersion(ctx, event.Peer, n.protocol.Version, event.Protocols...); err != nil {
		n.p2p.ConnManager().Unprotect(event.Peer, ProtocolSupportKey)
		return
	}

	bootstrapped := n.cfg.IsBootstrap(event.Peer)

	var addrsString []string

	if bootstrapped {
		go func() {
			if err := n.storeRemotePeers(event.Peer); err != nil {
				n.log.Warn("Problems storing bootstrapped shared peer list", zap.String("PID", event.Peer.String()), zap.Error(err))
			}
		}()
	}

	for _, addrs := range event.ListenAddrs {
		addrsString = append(addrsString, strings.ReplaceAll(addrs.String(), "/p2p/"+event.Peer.String(), "")+"/p2p/"+event.Peer.String())
	}
	sort.Strings(addrsString)
	incomingAddrs := strings.ReplaceAll(strings.Join(addrsString, ","), " ", "")

	if !n.peerWriteIsRedundant(ctx, event.Peer.String(), incomingAddrs) {
		if err := n.db.WithTx(ctx, func(conn *sqlite.Conn) error {
			// Identify completed — we have direct first-hand evidence this peer exists
			// right now. Always bump updated_at, regardless of whether addresses changed,
			// so TTL pruning doesn't evict long-lived peers with stable addrs. Addresses
			// only overwrite the stored set when the newly observed set is non-empty.
			return sqlitex.Exec(conn, "INSERT INTO peers (pid, addresses, explicitly_connected) VALUES (?, ?, ?) ON CONFLICT(pid) DO UPDATE SET addresses=CASE WHEN excluded.addresses!='' THEN excluded.addresses ELSE addresses END, updated_at=strftime('%s', 'now');", nil, event.Peer.String(), incomingAddrs, bootstrapped)
		}); err != nil {
			n.log.Warn("Could not store new peer", zap.String("PID", event.Peer.String()), zap.Error(err))
		}
	}

	n.p2p.ConnManager().Protect(event.Peer, ProtocolSupportKey)
	n.log.Debug("Storing Seed peer", zap.String("PID", event.Peer.String()), zap.String("Connectedness", connectedness.String()))
}

func (n *Node) CheckHyperMediaProtocolVersion(ctx context.Context, pid peer.ID, desiredVersion string, protos ...protocol.ID) (err error) {
	newCtx, cancel := context.WithTimeout(ctx, CheckProtocolTimeout)
	defer cancel()

	if len(protos) == 0 {
		var attempts int
		if err := retry.Exponential(newCtx, 50*time.Millisecond, func(_ context.Context) error {
			attempts++
			protos, err = n.p2p.Peerstore().GetProtocols(pid)
			if err != nil {
				return retry.RetryableError(fmt.Errorf("failed to check Hypermedia protocol version: %w", err))
			}

			if len(protos) > 0 {
				return nil
			}

			return retry.RetryableError(fmt.Errorf("peer %s doesn't support any protocols", pid.String()))
		}); err != nil {
			return fmt.Errorf("retry failed: attempts %d: %w", attempts, err)
		}
	}

	pinfo, isHM := FindHypermediaProtocol(protos)
	if !isHM {
		return fmt.Errorf("not a Hypermedia peer")
	}

	if pinfo.Version != desiredVersion {
		return fmt.Errorf("peer with incompatible Hypermedia protocol version: want=%s, got=%v", n.protocol.ID, pinfo.ID)
	}

	return nil
}

var errDialSelf = errors.New("can't dial self")
