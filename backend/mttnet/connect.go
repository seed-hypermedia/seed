package mttnet

import (
	"context"
	"errors"
	"fmt"
	"math"
	"math/rand"
	p2p "seed/backend/genproto/p2p/v1alpha"
	"seed/backend/util/dqb"
	"sort"
	"strings"
	"sync"
	"sync/atomic"

	"time"

	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"

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
	// ConnectTimeout is the maximum time to spend connecting to a peer.
	ConnectTimeout = time.Minute
	// PeerSharingTimeout is the maximum time to try to store shared peer list.
	PeerSharingTimeout = time.Second * 30
	// CheckProtocolTimeout is the maximum time spent trying to check for protocols.
	CheckProtocolTimeout = time.Second * 12
	// PeerBatchTimeout is the maximum time spent pert batch of checking.
	PeerBatchTimeout = time.Second * 10
	// StorePeersBatchSize is the number of shared peers to check at once for protocols.
	StorePeersBatchSize    = 20
	maxNonSeedPeersAllowed = 15
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
	conn, release, err := n.db.Conn(ctx)
	if err != nil {
		return err
	}
	didHandshake := false
	if err = sqlitex.Exec(conn, qGetPeer(), func(stmt *sqlite.Stmt) error {
		pidStr := stmt.ColumnText(0)
		pid, err := peer.Decode(pidStr)
		if err != nil {
			return err
		}
		if pid.String() != info.ID.String() {
			return fmt.Errorf("found PID does not equal provided PID")
		}
		didHandshake = true
		return nil
	}, info.ID); err != nil {
		release()
		return err
	}
	release()
	if isConnected && didHandshake {
		return nil
	}

	log := n.log.With(zap.String("peerID", info.ID.String()))
	ctx, cancel := context.WithTimeout(ctx, ConnectTimeout)
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
	if err := n.CheckHyperMediaProtocolVersion(ctx, info.ID, n.protocol.version); err != nil {
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

	go func() {
		if err := n.storeRemotePeers(info.ID); err != nil {
			n.log.Warn("Problems storing some of the shared peer list", zap.String("Remote peer with bad peer list", info.ID.String()), zap.Error(err))
		}
	}()
	if initialAddrs != "" {
		conn, release, err = n.db.Conn(ctx)
		if err != nil {
			return err
		}
		defer release()

		if err = sqlitex.Exec(conn, "INSERT INTO peers (pid, addresses, explicitly_connected) VALUES (?, ?, ?) ON CONFLICT(pid) DO UPDATE SET addresses=excluded.addresses, updated_at=strftime('%s', 'now') WHERE addresses!=excluded.addresses AND excluded.addresses !='';", nil, info.ID.String(), initialAddrs, true); err != nil {
			n.log.Warn("Failing to store peer", zap.Error(err))
			return err
		}
	}
	return nil
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

	res, err := c.ListPeers(ctxStore, &p2p.ListPeersRequest{PageSize: math.MaxInt32})
	if err != nil {
		return fmt.Errorf("Could not get list of peers from %s: %w", id.String(), err)
	}

	if len(res.Peers) > 0 {
		localPeers := make(map[string]interface{})
		conn, release, err := n.db.Conn(ctxStore)
		if err != nil {
			return err
		}
		if err = sqlitex.Exec(conn, qListPeers(), func(stmt *sqlite.Stmt) error {
			maStr := stmt.ColumnText(1)
			maList := strings.Split(strings.Trim(maStr, " "), ",")
			info, err := AddrInfoFromStrings(maList...)
			if err != nil {
				n.log.Warn("We have peers with wrong formatted addresses in our database", zap.String("PID", info.ID.String()), zap.Error(err))
				return err
			}
			localPeers[info.ID.String()] = info.Addrs
			return nil
		}, math.MaxInt64, math.MaxInt64); err != nil {
			release()
			return err
		}
		release()
		vals := []interface{}{}
		sqlStr := "INSERT INTO peers (pid, addresses, explicitly_connected, updated_at) VALUES "
		var nonSeedPeers uint32
		var xerr []error
		var mu sync.Mutex

		var wg sync.WaitGroup
		r := rand.New(rand.NewSource(time.Now().UnixNano())) //nolint:gosec
		r.Shuffle(len(res.Peers), func(i, j int) { res.Peers[i], res.Peers[j] = res.Peers[j], res.Peers[i] })
		var waitThreshold = int(math.Min(float64(len(res.Peers)), StorePeersBatchSize))
		ctxBatch, cancelBatch := context.WithTimeout(ctxStore, PeerBatchTimeout)
		defer cancelBatch()
		for i, p := range res.Peers {
			wg.Add(1)
			go func() {
				// In order not to get spammed with thousands of peers and make us waste computing
				// resources, we abort early
				defer wg.Done()
				if nonSeedPeers >= maxNonSeedPeersAllowed {
					return
				}
				pid, err := peer.Decode(p.Id)
				if err != nil {
					mu.Lock()
					xerr = append(xerr, fmt.Errorf("Could not decode shared peer %s", p))
					mu.Unlock()
					atomic.AddUint32(&nonSeedPeers, 1)
					n.p2p.ConnManager().Unprotect(pid, ProtocolSupportKey)
					return
				}
				if _, ok := localPeers[p.Id]; ok {
					n.p2p.ConnManager().Protect(pid, ProtocolSupportKey)
					return
				}

				if len(p.Addrs) > 0 {
					// Skipping our own node.
					if p.Id == n.client.me.String() {
						return
					}

					// Skipping bootstrap nodes where the code is the only source of truth.
					if n.cfg.IsBootstrap(pid) {
						return
					}
					info, err := AddrInfoFromStrings(p.Addrs...)
					if err != nil {
						mu.Lock()
						xerr = append(xerr, fmt.Errorf("Could not get peer info from shared addresses: %w", err))
						mu.Unlock()
						atomic.AddUint32(&nonSeedPeers, 1)
						return
					}
					// If it's offline does not mean its not a seed peer
					if err := n.p2p.Host.Connect(ctxBatch, info); err != nil {
						return
					}
					n.p2p.ConnManager().Protect(pid, ProtocolSupportKey)
					if err := n.CheckHyperMediaProtocolVersion(ctxBatch, pid, n.protocol.version); err != nil {
						atomic.AddUint32(&nonSeedPeers, 1)
						mu.Lock()
						xerr = append(xerr, fmt.Errorf("Peer [%s] failed to pass seed-protocol-check: %w", p.Id, err))
						mu.Unlock()
						n.p2p.ConnManager().Unprotect(pid, ProtocolSupportKey)
						return
					}
					mu.Lock()
					sqlStr += "(?, ?, ?, ?),"
					sort.Strings(p.Addrs)
					vals = append(vals, p.Id, strings.Join(p.Addrs, ","), false, p.UpdatedAt.Seconds)
					mu.Unlock()
				} else {
					atomic.AddUint32(&nonSeedPeers, 1)
					mu.Lock()
					xerr = append(xerr, fmt.Errorf("Invalid peer [%s] with no addresses", p))
					mu.Unlock()
					return
				}
			}()
			if i >= waitThreshold {
				wg.Wait()
				waitThreshold = i + int(math.Min(float64(StorePeersBatchSize), float64(len(res.Peers)-i)-1))
				ctxBatch, cancelBatch = context.WithTimeout(ctxStore, PeerBatchTimeout)
				defer cancelBatch()
			}

			if nonSeedPeers >= maxNonSeedPeersAllowed {
				break
			}
		}
		wg.Wait()
		if nonSeedPeers > 0 {
			n.log.Debug("Some of the remote shared peers are not running up to date seed protocol", zap.Uint32("Number of non-seed (outdated) peers", nonSeedPeers), zap.Int("Number of actual Seed-peers at the moment we stopped", len(vals)/4) /*since we insert four params at a time*/, zap.Errors("errors", xerr))
		}
		if len(vals) != 0 {
			sqlStr = sqlStr[0:len(sqlStr)-1] + " ON CONFLICT(pid) DO UPDATE SET addresses=excluded.addresses, updated_at=excluded.updated_at WHERE addresses!=excluded.addresses AND excluded.addresses !='' AND excluded.updated_at > updated_at"
			conn, release, err := n.db.Conn(ctxStore)
			if err != nil {
				n.log.Warn("Couldn't store shared peers", zap.Error(err))
				return err
			}
			defer release()
			return sqlitex.Exec(conn, sqlStr, nil, vals...)
		}
		if nonSeedPeers > 0 {
			return fmt.Errorf("We encounter at least %d non-seed (outdated) peers on the sharing table", nonSeedPeers)
		}
	}
	return nil
}
func (n *Node) defaultConnectionCallback(_ context.Context, event event.EvtPeerConnectednessChanged) {
	return
}

func (n *Node) defaultIdentificationCallback(ctx context.Context, event event.EvtPeerIdentificationCompleted) {
	if event.Peer.String() == n.client.me.String() {
		return
	}

	connectedness := n.Libp2p().Network().Connectedness(event.Peer)
	if connectedness != network.Connected {
		return
	}

	if err := n.CheckHyperMediaProtocolVersion(ctx, event.Peer, n.protocol.version, event.Protocols...); err != nil {
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
	conn, release, err := n.db.Conn(ctx)
	if err != nil {
		n.log.Warn("Could not get a connection", zap.Error(err))
		return
	}
	defer release()
	if err = sqlitex.Exec(conn, "INSERT INTO peers (pid, addresses, explicitly_connected) VALUES (?, ?, ?) ON CONFLICT(pid) DO UPDATE SET addresses=excluded.addresses, updated_at=strftime('%s', 'now') WHERE addresses!=excluded.addresses AND excluded.addresses !='' AND excluded.updated_at > updated_at;", nil, event.Peer.String(), strings.ReplaceAll(strings.Join(addrsString, ","), " ", ""), bootstrapped); err != nil {
		n.log.Warn("Could not store new peer", zap.String("PID", event.Peer.String()), zap.Error(err))
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
				return retry.RetryableError(fmt.Errorf("failed to check Hyper Media protocol version: %w", err))
			}

			if len(protos) > 0 {
				return nil
			}

			return retry.RetryableError(fmt.Errorf("peer %s doesn't support any protocols", pid.String()))
		}); err != nil {
			return fmt.Errorf("retry failed: attempts %d: %w", attempts, err)
		}
	}
	// Eventually we'd need to implement some compatibility checks between different protocol versions.
	var isSeed bool
	var gotProtocols []string
	for _, p := range protos {
		version := strings.TrimPrefix(string(p), n.protocol.prefix)
		if version == string(p) {
			continue
		}
		isSeed = true
		gotProtocols = append(gotProtocols, string(p))
		if version == desiredVersion {
			return nil
		}
	}

	if isSeed {
		return fmt.Errorf("peer with incompatible Seed protocol version: want=%s, got=%v", n.protocol.ID, gotProtocols)
	}

	return fmt.Errorf("not a Seed peer")
}

var errDialSelf = errors.New("can't dial self")
