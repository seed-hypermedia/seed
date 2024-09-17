package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"net/url"
	"os"
	"os/signal"
	"seed/backend/config"
	"seed/backend/core"
	"seed/backend/daemon"
	"seed/backend/logging"
	"seed/backend/mttnet"
	"seed/backend/storage"
	"seed/backend/util/libp2px"
	"strings"
	"time"

	"github.com/libp2p/go-libp2p/core/host"
	"github.com/libp2p/go-libp2p/core/network"
	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/multiformats/go-multiaddr"
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
	cfg := config.Default()
	cfg.DataDir = "/tmp/seed-connectivity-test"
	cfg.Syncing.NoSyncBack = true
	cfg.Syncing.SmartSyncing = true

	remotePeerRaw := flag.String("remote-peer", "", "comma-separated addresses of the remote peer to connect to")
	flag.Parse()

	store, err := storage.Open(cfg.DataDir, nil, core.NewMemoryKeyStore(), "info")
	if err != nil {
		return err
	}
	defer store.Close()

	app, err := daemon.Load(ctx, cfg, store)
	if err != nil {
		return err
	}

	logging.SetLogLevel("p2p-holepunch", "debug")
	// logging.SetLogLevel("p2p-holepunch", "debug")
	logging.SetLogLevel("autorelay", "debug")
	logging.SetLogLevel("autonat", "info")
	logging.SetLogLevel("autonatv2", "info")
	// logging.SetLogLevel("basichost", "debug")
	// logging.SetLogLevel("nat", "debug")
	logging.SetLogLevel("p2p-circuit", "debug")
	logging.SetLogLevel("upgrader", "debug")
	// logging.SetLogLevel("webrtc-transport", "debug")
	// logging.SetLogLevel("webrtc-transport-pion", "debug")
	logging.SetLogLevel("relay", "debug")
	// logging.SetLogLevel("eventlog", "debug")

	<-app.Net.Ready()
	fmt.Println("Bootstrap done")

	node := app.Net.Libp2p().Host

	ok := retry(ctx, "WaitForRelay", func() error {
		if hasRelayAddrs(node) {
			return nil
		}
		return fmt.Errorf("no relay addresses yet")
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

		go ensureConnection(ctx, app, remoteAddr)
	}

	return app.Wait()
}

func ensureConnection(ctx context.Context, app *daemon.App, remote peer.AddrInfo) {
	fmt.Println("Warming up before connecting to remote peer")

	time.Sleep(5 * time.Second)
	fmt.Println("Connecting to remote peer")

	ok := retry(ctx, "ConnectToRemote", func() error {
		return app.Net.Connect(ctx, remote)
	})
	if !ok {
		fmt.Println("Failed to connect to remote peer. Stop retrying.")
		return
	}

	fmt.Println("Connected to remote peer")

	node := app.Net.Libp2p().Host

	ok = retry(ctx, "CheckConnectionUnlimited", func() error {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
			state := node.Network().Connectedness(remote.ID)
			if state != network.Connected {
				err := node.Connect(ctx, remote)
				return fmt.Errorf("not connected yet: current state: %s: %w", state, err)
			}
			return nil
		}
	})

	fmt.Println("Connection should be unlimited now", node.Network().Connectedness(remote.ID))

	stream, err := node.NewStream(ctx, remote.ID, "/ipfs/ping/1.0.0")
	if err != nil {
		fmt.Println("Failed to open stream", err)
		return
	}

	if err := stream.Close(); err != nil {
		fmt.Println("Failed to close stream", err)
		return
	}

	fmt.Println("Stream open/close done")
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
