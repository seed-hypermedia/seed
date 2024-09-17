package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"flag"
	"fmt"
	"net/url"
	"os"
	"os/signal"
	"seed/backend/ipfs"
	"seed/backend/logging"
	"seed/backend/mttnet"
	"seed/backend/util/libp2px"
	"strings"
	"sync/atomic"
	"time"

	"github.com/libp2p/go-libp2p"
	"github.com/libp2p/go-libp2p/core/crypto"
	"github.com/libp2p/go-libp2p/core/event"
	"github.com/libp2p/go-libp2p/core/host"
	"github.com/libp2p/go-libp2p/core/network"
	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/libp2p/go-libp2p/p2p/host/autorelay"
	"github.com/multiformats/go-multiaddr"
	"go.uber.org/zap"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	context.AfterFunc(ctx, stop)

	if err := run(ctx); err != nil {
		if errors.Is(err, context.Canceled) {
			return
		}
		fmt.Fprintf(os.Stderr, "%+v\n", err)
		os.Exit(1)
	}
}

func run(ctx context.Context) error {

	var (
		keySeed = flag.String("key-seed", "", "any string to derive the libp2p private key from")
		// Default relay is a fresh server on DigitalOcean for testing.
		relayRaw      = flag.String("relay", "12D3KooWJ2WmxpP5EaHXqR56VidLL7gngWKHSnbkt4Q1ARbNWHPX@159.89.23.179:4001", "relay peer to connect to in form of <peer-id>@<ip>:<port>")
		remotePeerRaw = flag.String("remote-peer", "", "comma-separated addresses of the remote peer to connect to")
	)

	flag.Parse()

	if *keySeed == "" {
		flag.Usage()
		return fmt.Errorf("flag -key-seed is required")
	}

	seedHash := sha256.Sum256([]byte(*keySeed))

	priv, _, err := crypto.GenerateEd25519Key(bytes.NewReader(seedHash[:]))
	if err != nil {
		return err
	}

	relay, err := parseRelay(*relayRaw)
	if err != nil {
		return fmt.Errorf("failed to parse relay: %w", err)
	}

	opts := []libp2p.Option{
		libp2p.Identity(priv),
		libp2p.EnableRelay(),
		libp2p.EnableAutoNATv2(),
		libp2p.EnableHolePunching(),
		libp2p.EnableAutoRelayWithStaticRelays(
			[]peer.AddrInfo{relay},
			autorelay.WithBootDelay(5*time.Second),
			autorelay.WithNumRelays(1),
		),
		// libp2p.ForceReachabilityPrivate(),
		libp2p.ListenAddrStrings(libp2px.DefaultListenAddrs(57010)...),
	}

	logging.SetLogLevel("p2p-holepunch", "debug")
	// logging.SetLogLevel("p2p-holepunch", "debug")
	logging.SetLogLevel("autorelay", "debug")
	logging.SetLogLevel("autonat", "debug")
	logging.SetLogLevel("autonatv2", "debug")
	// logging.SetLogLevel("basichost", "debug")
	// logging.SetLogLevel("nat", "debug")
	logging.SetLogLevel("p2p-circuit", "debug")
	logging.SetLogLevel("relay", "debug")
	// logging.SetLogLevel("eventlog", "debug")

	log := logging.New("conntest", "debug")

	node, err := libp2p.New(opts...)
	if err != nil {
		return err
	}
	defer node.Close()

	var myReachability atomic.Value
	myReachability.Store(network.ReachabilityUnknown)

	sub, err := node.EventBus().Subscribe(new(event.EvtLocalReachabilityChanged))
	if err != nil {
		return err
	}
	defer sub.Close()

	go func() {
		for evt := range sub.Out() {
			switch e := evt.(type) {
			case event.EvtLocalReachabilityChanged:
				myReachability.Store(e.Reachability)
			}
		}
	}()

	log.Debug("PeerStarted", zap.String("peerID", node.ID().String()))

	boot := ipfs.Bootstrap(ctx, node, nil, ipfs.DefaultBootstrapAddrInfos)
	fmt.Println("BootstrapFinished", boot)

	ok := retry(ctx, "WaitForRelay", func() error {
		if hasRelayAddrs(node) {
			return nil
		}
		return fmt.Errorf("no relay addresses yet: my reachability: %s", myReachability.Load())
	})
	if !ok {
		return fmt.Errorf("failed to get relay addresses")
	}

	fmt.Println("My Addresses:", strings.Join(mttnet.AddrInfoToStrings(libp2px.AddrInfo(node)), ","))

	if *remotePeerRaw != "" {
		remoteAddr, err := mttnet.AddrInfoFromStrings(strings.Split(*remotePeerRaw, ",")...)
		if err != nil {
			return fmt.Errorf("failed to parse remote addrs: %w", err)
		}

		go ensureConnection(ctx, node, remoteAddr)
	}

	<-ctx.Done()
	return ctx.Err()
}

func ensureConnection(ctx context.Context, node host.Host, remote peer.AddrInfo) {
	fmt.Println("Connecting to remote peer")

	ok := retry(ctx, "ConnectToRemote", func() error {
		return node.Connect(ctx, remote)
	})
	if !ok {
		fmt.Println("Failed to connect to remote peer. Stop retrying.")
		return
	}

	fmt.Println("Connected to remote peer")

	ok = retry(ctx, "CheckConnectionUnlimited", func() error {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
			state := node.Network().Connectedness(remote.ID)
			if state != network.Connected {
				return fmt.Errorf("not connected yet: current state: %s", state)
			}
			return nil
		}
	})

	fmt.Println("Connection should be unlimited now", node.Network().Connectedness(remote.ID))
}

func retry(ctx context.Context, msg string, fn func() error) (ok bool) {
	for {
		select {
		case <-ctx.Done():
			return
		default:
			err := fn()
			if err == nil {
				return true
			}

			if errors.Is(err, context.Canceled) {
				return false
			}

			fmt.Println("Failed operation", msg, err)
			time.Sleep(2 * time.Second)
		}
	}
}

func hasRelayAddrs(h host.Host) bool {
	for _, addr := range h.Addrs() {
		if strings.Contains(addr.String(), "p2p-circuit") {
			return true
		}
	}
	return false
}

func parseRelay(in string) (peer.AddrInfo, error) {
	u, err := url.Parse("uri://" + in)
	if err != nil {
		return peer.AddrInfo{}, err
	}

	pid, err := peer.Decode(u.User.String())
	if err != nil {
		return peer.AddrInfo{}, err
	}

	out := peer.AddrInfo{
		ID: pid,
	}

	u.Hostname()
	u.Port()

	atcp, err := multiaddr.NewMultiaddr("/ip4/" + u.Hostname() + "/tcp/" + u.Port())
	if err != nil {
		return peer.AddrInfo{}, err
	}
	out.Addrs = append(out.Addrs, atcp)

	aquic, err := multiaddr.NewMultiaddr("/ip4/" + u.Hostname() + "/udp/" + u.Port() + "/quic-v1")
	if err != nil {
		return peer.AddrInfo{}, err
	}
	out.Addrs = append(out.Addrs, aquic)

	return out, nil
}
