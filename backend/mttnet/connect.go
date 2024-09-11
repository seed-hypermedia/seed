package mttnet

import (
	"context"
	"errors"
	"fmt"
	"math"
	p2p "seed/backend/genproto/p2p/v1alpha"
	"seed/backend/util/dqb"
	"strings"

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
	// ConnectTimeout is the maximum time to spend connecting to a peer
	ConnectTimeout         = time.Second * 15
	maxNonSeedPeersAllowed = 10
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

	log.Info("ConnectStarted")
	defer func() {
		log.Info("ConnectFinished", zap.Error(err), zap.Any("addrs", info.Addrs))
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
	if err := n.CheckHyperMediaProtocolVersion(ctx, info.ID, n.protocol.version); err != nil {
		return err
	}
	// TODO(juligasa): If transient then return
	// if transient {
	// 	return nil
	// }
	addrsStr := AddrInfoToStrings(info)
	if len(addrsStr) == 0 {
		return fmt.Errorf("Peer with no addresses")
	}
	initialAddrs := strings.ReplaceAll(strings.Join(addrsStr, ","), " ", "")
	conn, release, err = n.db.Conn(ctx)
	if err != nil {
		return err
	}
	defer release()

	c, err := n.client.Dial(ctx, info.ID)
	if err != nil {
		return fmt.Errorf("Could not get p2p client: %w", err)
	}
	res, err := c.ListPeers(ctx, &p2p.ListPeersRequest{PageSize: math.MaxInt32})
	if err != nil {
		return fmt.Errorf("Could not get list of peers: %w", err)
	}

	if len(res.Peers) > 0 {
		vals := []interface{}{}
		sqlStr := "INSERT OR REPLACE INTO peers (pid, addresses) VALUES "
		if initialAddrs != "" {
			sqlStr += "(?, ?),"
			vals = append(vals, info.ID.String(), initialAddrs)
		}
		var nonSeedPeers int
		var xerr []error
		for _, p := range res.Peers {
			if len(p.Addrs) > 0 {
				if p.Id == n.client.me.String() {
					continue
				}
				pid, err := peer.Decode(p.Id)
				if err != nil {
					nonSeedPeers++
					continue
				}
				if err := n.CheckHyperMediaProtocolVersion(ctx, pid, n.protocol.version); err != nil {
					nonSeedPeers++
					xerr = append(xerr, fmt.Errorf("Invalid peer %s: %w", p, err))
					continue
				}
				sqlStr += "(?, ?),"
				vals = append(vals, p.Id, strings.Join(p.Addrs, ","))
			} else {
				nonSeedPeers++
				xerr = append(xerr, fmt.Errorf("Invalid peer %s with no addresses", p))
			}
			// In order not to get spammed with thousands of peers and make us waste computing
			// resources, we abort early
			if nonSeedPeers >= maxNonSeedPeersAllowed {
				break
			}
		}
		if nonSeedPeers > 0 {
			log.Warn("The peer we are trying to connect with, has non-seed peers in its database.", zap.Int("Number of non-seed-peers", nonSeedPeers), zap.Errors("Errors", xerr))
		}
		if len(vals) != 0 {
			sqlStr = sqlStr[0 : len(sqlStr)-1]
			return sqlitex.Exec(conn, sqlStr, nil, vals...)
		}
		return fmt.Errorf("Peer with blank addresses")
	}
	if initialAddrs != "" {
		return sqlitex.Exec(conn, "INSERT OR REPLACE INTO peers (pid, addresses) VALUES (?, ?);", nil, info.ID.String(), initialAddrs)
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
	if err := n.CheckHyperMediaProtocolVersion(ctx, event.Peer, n.protocol.version, event.Protocols...); err != nil {
		return
	}

	conn, release, err := n.db.Conn(ctx)
	if err != nil {
		n.log.Warn("Could not get a connection", zap.Error(err))
		return
	}
	defer release()
	connectedness := n.Libp2p().Network().Connectedness(event.Peer)
	if connectedness != network.Connected {
		return
	}

	n.log.Debug("Storing Seed peer", zap.String("PID", event.Peer.String()), zap.String("Connectedness", connectedness.String()))
	var addrsString []string
	for _, addrs := range event.ListenAddrs {
		addrsString = append(addrsString, strings.ReplaceAll(addrs.String(), "/p2p/"+event.Peer.String(), "")+"/p2p/"+event.Peer.String())
	}
	if err = sqlitex.Exec(conn, "INSERT OR REPLACE INTO peers (pid, addresses) VALUES (?, ?);", nil, event.Peer.String(), strings.ReplaceAll(strings.Join(addrsString, ","), " ", "")); err != nil {
		n.log.Warn("Could not store new peer", zap.String("PID", event.Peer.String()), zap.Error(err))
	}
}

func (n *Node) CheckHyperMediaProtocolVersion(ctx context.Context, pid peer.ID, desiredVersion string, protos ...protocol.ID) (err error) {
	ctx, cancel := context.WithTimeout(ctx, time.Minute)
	defer cancel()

	if len(protos) == 0 {
		var attempts int
		if err := retry.Exponential(ctx, 50*time.Millisecond, func(ctx context.Context) error {
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
