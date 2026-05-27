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
	"golang.org/x/sync/errgroup"
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

	// targetConnectedPeers is the steady-state goal for active Seed-protocol
	// peers. Once we're at or above this, the periodic peer-exchange
	// scheduler is a no-op — we still react to disconnect events to top up.
	targetConnectedPeers = 20

	// peerExchangeTick is the period between scheduler waits. Was 15 s; with
	// a per-peer dial budget driven by the connection gap, more frequent
	// ticks just create churn.
	peerExchangeTick = 60 * time.Second

	// peerExchangeDialFanout caps concurrent storeRemotePeers calls per tick.
	peerExchangeDialFanout = 8
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

	addrsStr := n.filterAddrs(AddrInfoToStrings(info))
	if len(addrsStr) == 0 {
		n.p2p.ConnManager().Unprotect(info.ID, ProtocolSupportKey)
		return fmt.Errorf("Peer with no routable addresses")
	}
	sort.Strings(addrsStr)
	initialAddrs := strings.ReplaceAll(strings.Join(addrsStr, ","), " ", "")

	if initialAddrs != "" && !n.peerWriteIsRedundant(ctx, info.ID.String(), initialAddrs) {
		// Fire-and-forget: route the peer-row INSERT through the dedicated
		// peerWriter goroutine, which batches outstanding jobs from this
		// path AND from onLibp2pIdentification into a single BEGIN
		// IMMEDIATE / COMMIT cycle. Without this, each explicit Connect()
		// fanout (e.g. syncWithManyPeers dialing N peers in parallel)
		// would issue N concurrent WithTx calls and stampede the writer
		// mutex — directly observable on /debug/sqlite as connect
		// dominating "contender events". The INSERT semantics are
		// preserved: ON CONFLICT bumps updated_at unconditionally and
		// overwrites addresses only when the new set is non-empty (see
		// peerWriter.flush insertStmt).
		n.peerWriter.enqueue(peerWriteJob{
			pid:                 info.ID.String(),
			addrs:               initialAddrs,
			explicitlyConnected: true,
		})
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

// maxSharedPeersPerPage caps how many rows we ask a remote node for per
// ListPeers request. The old code asked for math.MaxInt32, which some remote
// implementations interpreted literally and returned every row they had ever
// seen — leading to massive protobuf payloads. The right answer is not a
// tight cap on *total* rows (we want the full peer graph the remote knows
// about) but a sane cap on a single *page*, combined with the pagination
// loop below. 2000 is large enough that any real deployment returns its
// whole table in one round-trip; the loop is a correctness belt for the
// degenerate case where a remote genuinely has more.
const maxSharedPeersPerPage = 2000

// runPeerExchangeTick keeps us at targetConnectedPeers Seed-protocol peers.
// It is a no-op when we're already at the target; otherwise it dials
// freshness-ranked candidates from the peers table with bounded concurrency.
// Unlike the previous unconditional fan-out, it does NOT clear libp2p's
// per-peer backoff (see client.dialPeer) so unreachable peers naturally fade
// from the dial schedule until they come back online.
func (n *Node) runPeerExchangeTick(ctx context.Context) error {
	connected := n.connectedSeedPeers()
	if len(connected) >= targetConnectedPeers {
		return nil
	}
	need := targetConnectedPeers - len(connected)

	candidates, err := n.peerExchangeCandidates(ctx, connected, need*4)
	if err != nil {
		return err
	}
	if len(candidates) == 0 {
		return nil
	}

	g, gctx := errgroup.WithContext(ctx)
	g.SetLimit(peerExchangeDialFanout)
	for _, pid := range candidates[:min(need, len(candidates))] {
		pid := pid
		g.Go(func() error {
			// storeRemotePeers handles its own per-call timeout.
			if err := n.storeRemotePeers(pid); err != nil {
				n.log.Debug("PeerExchangeDialFailed",
					zap.String("PID", pid.String()), zap.Error(err))
			}
			_ = gctx
			return nil
		})
	}
	return g.Wait()
}

// connectedSeedPeers returns the subset of currently-connected libp2p peers
// that have advertised our Seed protocol ID via Identify, excluding any
// configured bootstrap peers. Bootstrap peers are infrastructure — the
// ConnectionManager pins them and PeriodicBootstrap reconnects them — so
// counting them as part of the "useful peers" budget would mask the case
// where we have no organic peers and PEX-driven discovery has stalled.
// Symmetric with peerExchangeCandidates, which also excludes bootstrap.
func (n *Node) connectedSeedPeers() []peer.ID {
	conns := n.p2p.Host.Network().Conns()
	out := make([]peer.ID, 0, len(conns))
	seen := make(map[peer.ID]struct{}, len(conns))
	ps := n.p2p.Peerstore()
	for _, c := range conns {
		pid := c.RemotePeer()
		if _, ok := seen[pid]; ok {
			continue
		}
		seen[pid] = struct{}{}
		if n.cfg.IsBootstrap(pid) {
			continue
		}
		proto, err := ps.FirstSupportedProtocol(pid, n.protocol.ID)
		if err != nil || proto != n.protocol.ID {
			continue
		}
		out = append(out, pid)
	}
	return out
}

// peerExchangeCandidates returns up to limit peer IDs from the peers table,
// ordered by updated_at DESC (most recently confirmed alive first), excluding
// peers we are already connected to and any configured bootstrap peers.
// Bootstrap peers are excluded because the libp2p host's connection manager
// already keeps a live link to them.
func (n *Node) peerExchangeCandidates(ctx context.Context, connected []peer.ID, limit int) ([]peer.ID, error) {
	skip := make(map[peer.ID]struct{}, len(connected))
	for _, pid := range connected {
		skip[pid] = struct{}{}
	}
	var out []peer.ID
	err := n.db.WithSave(ctx, func(conn *sqlite.Conn) error {
		return sqlitex.Exec(conn,
			"SELECT pid FROM peers WHERE updated_at > (strftime('%s', 'now') - 30*86400) ORDER BY updated_at DESC LIMIT ?;",
			func(stmt *sqlite.Stmt) error {
				pid, err := peer.Decode(stmt.ColumnText(0))
				if err != nil {
					return nil // tolerate; bad rows aren't fatal
				}
				if _, dup := skip[pid]; dup {
					return nil
				}
				if n.cfg.IsBootstrap(pid) {
					return nil
				}
				out = append(out, pid)
				return nil
			}, limit*2) // overfetch to absorb skip filtering
	})
	return out, err
}

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

	// Pull the remote's full peer table across as many pages as it takes.
	// Only the first request carries ListHash: that's a "we already agree on
	// the whole list, skip the round-trip" optimization; it's meaningless once
	// we're mid-cursor. A defensive page cap stops us from looping forever
	// against a pathological remote that keeps returning NextPageToken.
	var allPeers []*p2p.PeerInfo
	const maxPages = 50 // 50 * 2000 = 100k rows — more than any real deployment
	pageToken := ""
	localHash := hex.EncodeToString(hash[:])
	for page := 0; page < maxPages; page++ {
		req := &p2p.ListPeersRequest{PageSize: maxSharedPeersPerPage, PageToken: pageToken}
		if page == 0 {
			req.ListHash = localHash
		}
		res, err := c.ListPeers(ctxStore, req)
		if err != nil {
			return fmt.Errorf("could not get list of peers from %s: %w", id.String(), err)
		}
		if res == nil {
			// Remote short-circuited on ListHash: our tables match, nothing to do.
			return nil
		}
		allPeers = append(allPeers, res.Peers...)
		if res.NextPageToken == "" {
			break
		}
		pageToken = res.NextPageToken
	}
	if len(allPeers) >= maxSharedPeersPerPage*maxPages {
		n.log.Warn("Peer-exchange hit page cap, remote has an unusually large table",
			zap.String("PID", id.String()),
			zap.Int("received", len(allPeers)))
	}

	// Ingress freshness filter: drop stale entries from the shared list before
	// we process them. Even if the sharer still remembers a long-dead peer, we
	// shouldn't accept it — it would bloat our table, waste our dial budget,
	// and (if later re-shared by us) re-pollute the peer graph.
	if len(allPeers) > 0 {
		freshnessThreshold := time.Now().Add(-PeerFreshnessWindow).Unix()
		fresh := allPeers[:0]
		staleCount := 0
		for _, p := range allPeers {
			if p.UpdatedAt != nil && p.UpdatedAt.Seconds >= freshnessThreshold {
				fresh = append(fresh, p)
			} else {
				staleCount++
			}
		}
		total := len(allPeers)
		allPeers = fresh
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

	if len(allPeers) > 0 {
		// Store-first: persist peer metadata immediately without blocking on
		// per-peer dials or protocol checks. A background goroutine below
		// dials the freshly-stored peers so discovery.go's Connectedness
		// filter sees them without forcing the caller to wait.
		var vals []any
		var toDial []peer.AddrInfo
		sqlStr := "INSERT INTO peers (pid, addresses, explicitly_connected, updated_at) VALUES "

		for _, p := range allPeers {
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
			// Strip non-routable addresses (LAN-private, loopback, link-local,
			// ULA) before persisting. libp2p identify announces every bound
			// NIC; peers downstream can't reach any of them and storing them
			// just bloats the column and our future peer-exchange responses.
			// Gated on AllowPrivateIPs so single-host e2e tests still work.
			p.Addrs = n.filterAddrs(p.Addrs)
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
	// Drop non-routable advertised addrs (LAN-private, loopback, etc.) before
	// they enter the column. libp2p identify announces every bound NIC.
	// Gated on AllowPrivateIPs so single-host e2e tests still work.
	addrsString = n.filterAddrs(addrsString)
	sort.Strings(addrsString)
	incomingAddrs := strings.ReplaceAll(strings.Join(addrsString, ","), " ", "")

	if !n.peerWriteIsRedundant(ctx, event.Peer.String(), incomingAddrs) {
		// Fire-and-forget: the actual INSERT runs on the dedicated
		// peerWriter goroutine, which batches outstanding jobs to
		// amortise the BEGIN IMMEDIATE / COMMIT cost. The dispatcher
		// goroutine (us) returns immediately so other libp2p events
		// can continue to drain even if the writer slot is currently
		// contended elsewhere in the daemon. See peer_writer.go for
		// the motivation and architectural notes.
		//
		// Identify completed — we have direct first-hand evidence
		// this peer exists right now. The INSERT always bumps
		// updated_at regardless of whether addresses changed, so TTL
		// pruning doesn't evict long-lived peers with stable addrs.
		// Addresses only overwrite the stored set when the newly
		// observed set is non-empty.
		n.peerWriter.enqueue(peerWriteJob{
			pid:                 event.Peer.String(),
			addrs:               incomingAddrs,
			explicitlyConnected: bootstrapped,
		})
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

// filterAddrs strips non-routable multiaddrs from the given list unless the
// daemon is configured to allow private IPs (tests, single-host dev setups),
// and always strips /certhash/-bearing multiaddrs (WebRTC-direct /
// WebTransport cert-pinned addresses): the cached hash goes stale the moment
// the remote rotates its DTLS cert, the live hash is re-learned in-band from
// the next Identify exchange, and no consumer of peers.addresses relies on
// it being correct. See netutil.FilterCertHashMultiaddrs for the full
// rationale. All callsites that build the peers.addresses column should
// funnel through this so test fixtures with only loopback / LAN addresses
// still work.
func (n *Node) filterAddrs(addrs []string) []string {
	if !n.ArePrivateIPsAllowed() {
		addrs = netutil.FilterRoutableMultiaddrs(addrs)
	}
	return netutil.FilterCertHashMultiaddrs(addrs)
}

// peerStartupCleanup runs the one-shot data-hygiene pass on the peers table
// at daemon start. Two steps in a single transaction:
//
//  1. Rewrite every row's `addresses` column through filterAddrs so existing
//     rows shed (a) any non-routable multiaddrs ingested before that filter
//     was introduced, and (b) any /certhash/-bearing multiaddrs — these
//     accumulate one variant per remote DTLS-cert rotation, bloat the row
//     into SQLite overflow pages, and are useless without the live cert
//     hash anyway (see netutil.FilterCertHashMultiaddrs). The routability
//     pass is skipped when AllowPrivateIPs is on (tests); the certhash
//     pass always runs since stale hashes are unconditionally dead weight.
//     Rows that become empty after filtering are deleted.
//  2. Delete rows with `explicitly_connected=0 AND updated_at < now - 30d`.
//     This is the prune that was disabled at hmnet.go pending one full
//     PeerFreshnessWindow of `updated_at`-bump correctness — that window
//     has now cycled, so stale timestamps reliably mean "we haven't heard
//     from this peer in 30 days" rather than "ingested before the fix
//     shipped". `explicitly_connected=0` protects bootstrap / direct
//     contact peers from prune regardless of freshness.
//
// Guarded with a row-count floor so a near-empty fresh deploy can't
// accidentally prune itself to zero.
//
// Logs an info line for each step describing the work done; errors are
// returned to the caller, which logs but does NOT fail startup on them —
// peers-table hygiene is best-effort.
func (n *Node) peerStartupCleanup(ctx context.Context, floor int64) error {
	applyRoutabilityFilter := !n.ArePrivateIPsAllowed()
	log := n.log
	return n.db.WithTx(ctx, func(conn *sqlite.Conn) error {
		// Step 1: filter existing addresses in-place.
		type updateJob struct {
			id    int64
			addrs string // empty => delete the row
		}
		var jobs []updateJob
		if err := sqlitex.Exec(conn, "SELECT id, addresses FROM peers;", func(stmt *sqlite.Stmt) error {
			id := stmt.ColumnInt64(0)
			raw := stmt.ColumnText(1)
			addrs := strings.Split(raw, ",")
			if applyRoutabilityFilter {
				addrs = netutil.FilterRoutableMultiaddrs(addrs)
			}
			addrs = netutil.FilterCertHashMultiaddrs(addrs)
			cleaned := strings.Join(addrs, ",")
			if cleaned != raw {
				jobs = append(jobs, updateJob{id: id, addrs: cleaned})
			}
			return nil
		}); err != nil {
			return fmt.Errorf("peerStartupCleanup: scan peers: %w", err)
		}
		var rewritten, deletedEmpty int
		for _, j := range jobs {
			if j.addrs == "" {
				if err := sqlitex.Exec(conn, "DELETE FROM peers WHERE id = ?;", nil, j.id); err != nil {
					return fmt.Errorf("peerStartupCleanup: delete empty-after-filter peer id=%d: %w", j.id, err)
				}
				deletedEmpty++
			} else {
				if err := sqlitex.Exec(conn, "UPDATE peers SET addresses = ? WHERE id = ?;", nil, j.addrs, j.id); err != nil {
					return fmt.Errorf("peerStartupCleanup: rewrite peer id=%d: %w", j.id, err)
				}
				rewritten++
			}
		}
		log.Info("PeerAddressCleanup",
			zap.Bool("routability_filter", applyRoutabilityFilter),
			zap.Int("rewritten", rewritten),
			zap.Int("deleted_empty", deletedEmpty))

		// Step 2: prune stale gossip-ingested peers.
		var total int64
		if err := sqlitex.Exec(conn, "SELECT count(*) FROM peers;", func(s *sqlite.Stmt) error {
			total = s.ColumnInt64(0)
			return nil
		}); err != nil {
			return fmt.Errorf("peerStartupCleanup: count peers: %w", err)
		}
		if total < floor {
			log.Info("PeerPruneSkipped",
				zap.Int64("total", total),
				zap.Int64("floor", floor))
			return nil
		}
		if err := sqlitex.Exec(conn,
			"DELETE FROM peers "+
				"WHERE explicitly_connected = 0 "+
				"AND updated_at < (strftime('%s','now') - 30*86400);",
			nil); err != nil {
			return fmt.Errorf("peerStartupCleanup: prune stale: %w", err)
		}
		deleted := int64(conn.Changes())
		log.Info("PeerPruneCompleted",
			zap.Int64("before", total),
			zap.Int64("deleted", deleted),
			zap.Int64("after", total-deleted))
		return nil
	})
}
