// Package config provides global configuration.
package config

import (
	"flag"
	"fmt"
	"os"
	"seed/backend/ipfs"
	"seed/backend/util/must"
	"strings"
	"time"

	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/multiformats/go-multiaddr"
)

// Base configuration.
type Base struct {
	DataDir  string
	LogLevel string
}

func (c Base) Default() Base {
	return Base{
		DataDir:  "~/.mtt",
		LogLevel: "info",
	}
}

// BindFlags binds the flags to the given FlagSet.
func (c *Base) BindFlags(fs *flag.FlagSet) {
	fs.StringVar(&c.DataDir, "data-dir", c.DataDir, "Path to a directory where to store node data")
	fs.StringVar(&c.LogLevel, "log-level", c.LogLevel, "Log verbosity debug | info | warning | error")
}

// ExpandDataDir is used to expand the home directory in the data directory path.
func (c *Base) ExpandDataDir() error {
	// We allow homedir expansion in the repo path.
	if strings.HasPrefix(c.DataDir, "~") {
		homedir, err := os.UserHomeDir()
		if err != nil {
			return fmt.Errorf("failed to detect home directory: %w", err)
		}
		c.DataDir = strings.Replace(c.DataDir, "~", homedir, 1)
	}
	return nil
}

// Config for our daemon. When adding or removing fields,
// adjust the Default() and BindFlags() accordingly.
type Config struct {
	Base

	HTTP    HTTP
	GRPC    GRPC
	P2P     P2P
	Lndhub  Lndhub
	Syncing Syncing
}

// BindFlags configures the given FlagSet with the existing values from the given Config
// and prepares the FlagSet to parse the flags into the Config.
//
// This function is assumed to be called after some default values were set on the given config.
// These values will be used as default values in flags.
// See Default() for the default config values.
func (c *Config) BindFlags(fs *flag.FlagSet) {
	c.Base.BindFlags(fs)
	c.HTTP.BindFlags(fs)
	c.GRPC.BindFlags(fs)
	c.P2P.BindFlags(fs)
	c.Lndhub.BindFlags(fs)
	c.Syncing.BindFlags(fs)
}

// Default creates a new default config.
func Default() Config {
	return Config{
		Base:    Base{}.Default(),
		HTTP:    HTTP{}.Default(),
		GRPC:    GRPC{}.Default(),
		P2P:     P2P{}.Default(),
		Lndhub:  Lndhub{}.Default(),
		Syncing: Syncing{}.Default(),
	}
}

type addrsFlag []multiaddr.Multiaddr

func (al *addrsFlag) String() string {
	if al == nil {
		return ""
	}

	var sb strings.Builder
	last := len(*al) - 1
	for i, addr := range *al {
		if _, err := sb.WriteString(addr.String()); err != nil {
			panic(err)
		}

		if i < last {
			sb.WriteRune(',')
		}
	}

	return sb.String()
}

func (al *addrsFlag) Set(s string) error {
	ss := strings.Split(s, ",")
	out := make([]multiaddr.Multiaddr, len(ss))

	for i, as := range ss {
		addr, err := multiaddr.NewMultiaddr(as)
		if err != nil {
			return err
		}
		out[i] = addr
	}

	*al = out
	return nil
}

func newAddrsFlag(val []multiaddr.Multiaddr, p *[]multiaddr.Multiaddr) flag.Value {
	*p = val
	return (*addrsFlag)(p)
}

// HTTP configuration.
type HTTP struct {
	Port int
}

func (c HTTP) Default() HTTP {
	return HTTP{
		Port: 55001,
	}
}

// BindFlags binds the flags to the given FlagSet.
func (c *HTTP) BindFlags(fs *flag.FlagSet) {
	fs.IntVar(&c.Port, "http.port", c.Port, "Port for the HTTP server (including grpc-web)")
}

// GRPC configuration.
type GRPC struct {
	Port int
}

func (c GRPC) Default() GRPC {
	return GRPC{
		Port: 55002,
	}
}

// BindFlags binds the flags to the given FlagSet.
func (c *GRPC) BindFlags(fs *flag.FlagSet) {
	fs.IntVar(&c.Port, "grpc.port", c.Port, "Port for the gRPC server")
}

// Lndhub related config.
type Lndhub struct {
	Mainnet bool
}

func (c Lndhub) Default() Lndhub {
	return Lndhub{}
}

// BindFlags binds the flags to the given FlagSet.
func (c *Lndhub) BindFlags(fs *flag.FlagSet) {
	fs.BoolVar(&c.Mainnet, "lndhub.mainnet", c.Mainnet, "Connect to the mainnet lndhub.go server")
}

// Syncing configuration.
type Syncing struct {
	WarmupDuration  time.Duration
	Interval        time.Duration
	TimeoutPerPeer  time.Duration
	RefreshInterval time.Duration
	SmartSyncing    bool
	NoPull          bool
	NoDiscovery     bool
	AllowPush       bool
	NoSyncBack      bool
}

func (c Syncing) Default() Syncing {
	return Syncing{
		WarmupDuration:  time.Second * 20,
		Interval:        time.Minute,
		TimeoutPerPeer:  time.Minute * 5,
		RefreshInterval: time.Second * 50,
	}
}

// BindFlags binds the flags to the given FlagSet.
func (c *Syncing) BindFlags(fs *flag.FlagSet) {
	fs.DurationVar(&c.WarmupDuration, "syncing.warmup-duration", c.WarmupDuration, "Time to wait before the first sync loop iteration")
	fs.DurationVar(&c.Interval, "syncing.interval", c.Interval, "Periodic interval at which sync loop is triggered")
	fs.DurationVar(&c.TimeoutPerPeer, "syncing.timeout-per-peer", c.TimeoutPerPeer, "Maximum duration for syncing with a single peer")
	fs.DurationVar(&c.RefreshInterval, "syncing.refresh-interval", c.RefreshInterval, "Periodic interval at which list of peers to sync is refreshed from the database")
	fs.BoolVar(&c.AllowPush, "syncing.allow-push", c.AllowPush, "Allows direct content push. Anyone could force push content")
	fs.BoolVar(&c.NoPull, "syncing.no-pull", c.NoPull, "Disables periodic content pulling")
	fs.BoolVar(&c.SmartSyncing, "syncing.smart", c.SmartSyncing, "Enables subscription-based syncing and deactivates dumb syncing")
	fs.BoolVar(&c.NoDiscovery, "syncing.no-discovery", c.NoDiscovery, "Disables the ability to discover content from other peers")
	fs.BoolVar(&c.NoSyncBack, "syncing.no-sync-back", c.NoSyncBack, "Disables syncing back all the content when a peer connects to us")
}

var customBootstrapPeers = []string{
	// HM24 Test Gateway.
	"/dns4/test.hyper.media/tcp/56000/p2p/12D3KooWMjs8x6ST53ZuXAegedQ4dJ2HYYQmFpw1puGpBZmLRCGB",
	"/dns4/test.hyper.media/udp/56000/quic-v1/p2p/12D3KooWMjs8x6ST53ZuXAegedQ4dJ2HYYQmFpw1puGpBZmLRCGB",

	// HM24 Production Gateway.
	"/dns4/gateway.hyper.media/tcp/56000/p2p/12D3KooWLyw3zApBMKK2BbtjgHPmtr4iqqJkY8nUGYs92oM2bzgR",
	"/dns4/gateway.hyper.media/udp/56000/quic-v1/p2p/12D3KooWLyw3zApBMKK2BbtjgHPmtr4iqqJkY8nUGYs92oM2bzgR",
}

func bootstrapPeers() []peer.AddrInfo {
	all := ipfs.DefaultBootstrapPeers()

	for _, addr := range customBootstrapPeers {
		all = append(all, must.Do2(multiaddr.NewMultiaddr(addr)))
	}

	infos, err := peer.AddrInfosFromP2pAddrs(all...)
	if err != nil {
		panic(err)
	}

	return infos
}

// P2P networking configuration.
type P2P struct {
	TestnetName             string
	Port                    int
	NoRelay                 bool
	BootstrapPeers          []peer.AddrInfo
	ListenAddrs             []multiaddr.Multiaddr
	AnnounceAddrs           []multiaddr.Multiaddr
	ForceReachabilityPublic bool
	PeerSharing             bool
	NoPrivateIps            bool
	NoMetrics               bool
	RelayBackoff            time.Duration
}

func (p2p P2P) Default() P2P {
	return P2P{
		BootstrapPeers: bootstrapPeers(),
		Port:           55000,
		RelayBackoff:   time.Minute * 3,
	}
}

// BindFlags binds the flags to the given FlagSet.
func (p2p *P2P) BindFlags(fs *flag.FlagSet) {
	fs.StringVar(&p2p.TestnetName, "p2p.testnet-name", p2p.TestnetName, "Name of the testnet to use (empty for mainnet)")
	fs.IntVar(&p2p.Port, "p2p.port", p2p.Port, "Port to listen for incoming P2P connections")
	fs.BoolVar(&p2p.NoRelay, "p2p.no-relay", p2p.NoRelay, "Disable libp2p circuit relay")
	fs.Func("p2p.bootstrap-peers", "Comma-separated multiaddrs for bootstrap nodes (default see `config/config.go`)", func(in string) error {
		addrs := strings.Split(in, ",")
		out := make([]multiaddr.Multiaddr, len(addrs))
		for i, addr := range addrs {
			maddr, err := multiaddr.NewMultiaddr(addr)
			if err != nil {
				return err
			}
			out[i] = maddr
		}
		if len(out) > 0 {
			p2p.BootstrapPeers = must.Do2(peer.AddrInfosFromP2pAddrs(out...))
		}
		return nil
	})
	fs.Var(newAddrsFlag(p2p.ListenAddrs, &p2p.ListenAddrs), "p2p.listen-addrs", "Addresses to be listen at (comma separated multiaddresses format)")
	fs.Var(newAddrsFlag(p2p.AnnounceAddrs, &p2p.AnnounceAddrs), "p2p.announce-addrs", "Multiaddrs this node will announce as being reachable at (comma separated)")
	fs.BoolVar(&p2p.ForceReachabilityPublic, "p2p.force-reachability-public", p2p.ForceReachabilityPublic, "Force the node into thinking it's publicly reachable")
	fs.BoolVar(&p2p.NoPrivateIps, "p2p.no-private-ips", p2p.NoPrivateIps, "Avoid announcing private IP addresses (ignored when using -p2p.announce-addrs)")
	fs.BoolVar(&p2p.NoMetrics, "p2p.no-metrics", p2p.NoMetrics, "Disable Prometheus metrics collection")
	fs.BoolVar(&p2p.PeerSharing, "syncing.peer-sharing", p2p.PeerSharing, "Whe share our peer list whenever we connect to another seed peer")
	fs.DurationVar(&p2p.RelayBackoff, "p2p.relay-backoff", p2p.RelayBackoff, "The time the autorelay waits to reconnect after failing to obtain a reservation with a candidate")
}

// NoBootstrap indicates whether bootstrap nodes are configured.
func (p2p P2P) NoBootstrap() bool {
	return len(p2p.BootstrapPeers) == 0
}
