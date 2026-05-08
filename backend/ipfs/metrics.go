package ipfs

import (
	"sort"
	"sync"
	"time"

	"seed/backend/util/bwcounter"

	"github.com/libp2p/go-libp2p/core/host"
	"github.com/libp2p/go-libp2p/core/metrics"
	"github.com/libp2p/go-libp2p/core/network"
	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/libp2p/go-libp2p/core/protocol"
	"github.com/multiformats/go-multiaddr"
	manet "github.com/multiformats/go-multiaddr/net"
	"github.com/prometheus/client_golang/prometheus"
)

// Libp2pMetrics implements Libp2p metrics.Reporter and prometheus.Collector.
// It is passed to Libp2p constructor as a BandwidthCounter, and then registered
// with Prometheus global registry.
type Libp2pMetrics struct {
	h host.Host

	errorsTotal    prometheus.Counter
	totalIn        prometheus.Counter
	totalOut       prometheus.Counter
	protocolIn     *prometheus.CounterVec
	protocolOut    *prometheus.CounterVec
	scopeBytes     *prometheus.CounterVec
	openConns      prometheus.Gauge
	connectedPeers *prometheus.GaugeVec

	allMetrics []prometheus.Collector

	// Collecting connection metrics is a bit expensive, so we only want to do it
	// once per interval. The default is defined in NewLibp2pMetrics.
	ExportInterval time.Duration
	mu             sync.Mutex
	lastExportTime time.Time

	// Bandwidth split by loopback vs remote scope, keyed by libp2p protocol ID.
	// Surfaced on /debug/network alongside per-peer breakdown.
	BW *bwcounter.Counter

	// peerScope tracks each connected peer's loopback-vs-remote classification,
	// updated on Connected/Disconnected via the network.Notifiee implementation.
	// A peer is loopback if any of its current connections has a loopback
	// remote multiaddr.
	peerScopeMu sync.RWMutex
	peerScope   map[peer.ID]bool

	// peerBytes accumulates per-peer in/out totals plus last activity time.
	// Read on the /debug/network page; written on every libp2p stream message.
	peerBytesMu sync.Mutex
	peerBytes   map[peer.ID]*peerBytesEntry
}

type peerBytesEntry struct {
	In         uint64
	Out        uint64
	LastActive time.Time
	Loopback   bool
}

// NewLibp2pMetrics creates new Libp2pMetricsCollector.
// Callers must call .SetHost() when Libp2p Host is initialized.
// The caller is also responsible for passing the collection
// to the libp2p constructor, and the corresponding Prometheus registry.
func NewLibp2pMetrics() *Libp2pMetrics {
	m := &Libp2pMetrics{
		errorsTotal: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "libp2p_exporter_errors_total",
			Help: "Total number of errors occurred when collecting libp2p metrics.",
		}),

		totalIn: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "libp2p_receive_bytes_total",
			Help: "Total number of bytes received via Libp2p.",
		}),

		totalOut: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "libp2p_transmit_bytes_total",
			Help: "Total number of bytes sent via Libp2p.",
		}),

		protocolIn: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "libp2p_protocol_receive_bytes_total",
			Help: "Total number of bytes received on a specified Libp2p protocol.",
		}, []string{"protocol"}), // Be careful changing labels, we're using WithLabelValues.

		protocolOut: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "libp2p_protocol_transmit_bytes_total",
			Help: "Total number of bytes sent on a specified Libp2p protocol.",
		}, []string{"protocol"}), // Be careful changing labels, we're using WithLabelValues.

		scopeBytes: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "seed_libp2p_scope_bytes_total",
			Help: "Total libp2p stream bytes split by direction and scope (loopback vs remote).",
		}, []string{"direction", "scope"}),

		openConns: prometheus.NewGauge(prometheus.GaugeOpts{
			Name: "libp2p_open_connections",
			Help: "Number of currently open Libp2p connections.",
		}),

		connectedPeers: prometheus.NewGaugeVec(prometheus.GaugeOpts{
			Name: "libp2p_connected_peers",
			Help: "Number of currently connected Libp2p peers per protocol.",
		}, []string{"protocol"}),

		ExportInterval: 15 * time.Second,
		BW:             &bwcounter.Counter{},
		peerScope:      make(map[peer.ID]bool),
		peerBytes:      make(map[peer.ID]*peerBytesEntry),
	}

	m.allMetrics = []prometheus.Collector{
		m.errorsTotal,
		m.totalIn,
		m.totalOut,
		m.protocolIn,
		m.protocolOut,
		m.scopeBytes,
		m.openConns,
		m.connectedPeers,
	}

	return m
}

// SetHost must be called before registering collector.
// Some metrics are provided in the libp2p constructor, but others can only be
// collected after the Host is instantiated.
func (m *Libp2pMetrics) SetHost(h host.Host) {
	m.h = h
}

// Describe implements prometheus.Collector.
func (m *Libp2pMetrics) Describe(c chan<- *prometheus.Desc) {
	if m.h == nil {
		panic("BUG: call SetHost() before registering the collector")
	}

	for _, m := range m.allMetrics {
		m.Describe(c)
	}
}

// Collect implements prometheus.Collector.
func (m *Libp2pMetrics) Collect(c chan<- prometheus.Metric) {
	if m.h == nil {
		panic("BUG: call SetHost() before registering the collector")
	}

	if m.shouldCollect(time.Now()) {
		m.collectConnectionStats()
	}

	for _, m := range m.allMetrics {
		m.Collect(c)
	}
}

// Reset implements libp2p.BandwidthReporter.
func (m *Libp2pMetrics) Reset() {
	return
}

// TrimIdle implements libp2p.BandwidthReporter.
func (m *Libp2pMetrics) TrimIdle(time.Time) {
	return
}

func (m *Libp2pMetrics) shouldCollect(now time.Time) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	ok := now.Sub(m.lastExportTime) > m.ExportInterval
	if ok {
		m.lastExportTime = now
	}
	return ok
}

func (m *Libp2pMetrics) collectConnectionStats() {
	conns := m.h.Network().Conns()
	peers := make(map[peer.ID]struct{}, len(conns))

	for _, c := range conns {
		pid := c.RemotePeer()
		_, ok := peers[pid]
		if ok {
			continue
		}
		peers[pid] = struct{}{}
	}

	m.openConns.Set(float64(len(conns)))

	m.connectedPeers.Reset()
	m.connectedPeers.WithLabelValues("").Set(float64(len(peers)))

	ps := m.h.Peerstore()

	for pid := range peers {
		protos, err := ps.GetProtocols(pid)
		if err != nil {
			m.errorsTotal.Inc()
			continue
		}

		for _, p := range protos {
			m.connectedPeers.WithLabelValues(string(p)).Inc()
		}
	}
}

// LogSentMessage implements libp2p metrics.Reporter.
func (m *Libp2pMetrics) LogSentMessage(v int64) {
	m.totalOut.Add(float64(v))
}

// LogRecvMessage implements libp2p metrics.Reporter.
func (m *Libp2pMetrics) LogRecvMessage(v int64) {
	m.totalIn.Add(float64(v))
}

// LogSentMessageStream implements libp2p metrics.Reporter.
func (m *Libp2pMetrics) LogSentMessageStream(v int64, proto protocol.ID, pid peer.ID) {
	m.protocolOut.WithLabelValues(string(proto)).Add(float64(v))
	m.recordStream(v, proto, pid, bwcounter.DirOut)
}

// LogRecvMessageStream implements libp2p metrics.Reporter.
func (m *Libp2pMetrics) LogRecvMessageStream(v int64, proto protocol.ID, pid peer.ID) {
	m.protocolIn.WithLabelValues(string(proto)).Add(float64(v))
	m.recordStream(v, proto, pid, bwcounter.DirIn)
}

// recordStream classifies a stream message by scope and updates the bandwidth
// counter and per-peer book-keeping.
func (m *Libp2pMetrics) recordStream(v int64, proto protocol.ID, pid peer.ID, dir bwcounter.Direction) {
	if v <= 0 {
		return
	}
	loopback := m.PeerIsLoopback(pid)
	scope := bwcounter.ScopeRemote
	scopeLabel := "remote"
	if loopback {
		scope = bwcounter.ScopeLoopback
		scopeLabel = "loopback"
	}

	dirLabel := "out"
	if dir == bwcounter.DirIn {
		dirLabel = "in"
	}
	m.scopeBytes.WithLabelValues(dirLabel, scopeLabel).Add(float64(v))
	m.BW.Add(scope, dir, string(proto), v)

	m.peerBytesMu.Lock()
	e, ok := m.peerBytes[pid]
	if !ok {
		e = &peerBytesEntry{}
		m.peerBytes[pid] = e
	}
	if dir == bwcounter.DirIn {
		e.In += uint64(v)
	} else {
		e.Out += uint64(v)
	}
	e.Loopback = loopback
	e.LastActive = time.Now()
	m.peerBytesMu.Unlock()
}

// PeerIsLoopback reports whether the peer currently has at least one loopback
// connection. Falls back to inspecting the host's live connections if the
// Notifiee hasn't recorded the peer yet (covers the brief window between
// Connect and the Notifiee callback).
func (m *Libp2pMetrics) PeerIsLoopback(pid peer.ID) bool {
	m.peerScopeMu.RLock()
	loopback, ok := m.peerScope[pid]
	m.peerScopeMu.RUnlock()
	if ok {
		return loopback
	}
	if m.h == nil {
		return false
	}
	return anyLoopbackConn(m.h.Network().ConnsToPeer(pid))
}

// PeerBytesSnapshotEntry is one row in PeerBytesSnapshot.
type PeerBytesSnapshotEntry struct {
	PeerID     peer.ID
	In         uint64
	Out        uint64
	LastActive time.Time
	Loopback   bool
}

// Total returns In+Out.
func (e PeerBytesSnapshotEntry) Total() uint64 { return e.In + e.Out }

// PeerBytesSnapshot returns the top-N peers by total bytes (in+out), sorted
// descending. N <= 0 returns all peers.
func (m *Libp2pMetrics) PeerBytesSnapshot(n int) []PeerBytesSnapshotEntry {
	m.peerBytesMu.Lock()
	rows := make([]PeerBytesSnapshotEntry, 0, len(m.peerBytes))
	for pid, e := range m.peerBytes {
		rows = append(rows, PeerBytesSnapshotEntry{
			PeerID:     pid,
			In:         e.In,
			Out:        e.Out,
			LastActive: e.LastActive,
			Loopback:   e.Loopback,
		})
	}
	m.peerBytesMu.Unlock()
	sort.Slice(rows, func(i, j int) bool {
		return rows[i].Total() > rows[j].Total()
	})
	if n > 0 && len(rows) > n {
		rows = rows[:n]
	}
	return rows
}

// network.Notifiee implementation: keeps peerScope in sync with the host's
// connection state so that LogSent/RecvMessageStream can classify scope in O(1).

// Listen implements network.Notifiee.
func (m *Libp2pMetrics) Listen(network.Network, multiaddr.Multiaddr) {}

// ListenClose implements network.Notifiee.
func (m *Libp2pMetrics) ListenClose(network.Network, multiaddr.Multiaddr) {}

// Connected implements network.Notifiee.
func (m *Libp2pMetrics) Connected(_ network.Network, c network.Conn) {
	pid := c.RemotePeer()
	loopback := manet.IsIPLoopback(c.RemoteMultiaddr())
	m.peerScopeMu.Lock()
	if loopback {
		// Once any connection is loopback, treat the peer as loopback for as
		// long as that conn is alive. Disconnected will recompute when it goes.
		m.peerScope[pid] = true
	} else if _, ok := m.peerScope[pid]; !ok {
		m.peerScope[pid] = false
	}
	m.peerScopeMu.Unlock()
}

// Disconnected implements network.Notifiee.
func (m *Libp2pMetrics) Disconnected(net network.Network, c network.Conn) {
	pid := c.RemotePeer()
	conns := net.ConnsToPeer(pid)
	m.peerScopeMu.Lock()
	if len(conns) == 0 {
		delete(m.peerScope, pid)
	} else {
		m.peerScope[pid] = anyLoopbackConn(conns)
	}
	m.peerScopeMu.Unlock()
}

func anyLoopbackConn(conns []network.Conn) bool {
	for _, c := range conns {
		if manet.IsIPLoopback(c.RemoteMultiaddr()) {
			return true
		}
	}
	return false
}

// GetBandwidthForPeer implements libp2p metrics.Reporter.
func (m *Libp2pMetrics) GetBandwidthForPeer(peer.ID) metrics.Stats {
	panic("BUG: this is not implemented and must never be called")
}

// GetBandwidthForProtocol implements libp2p metrics.Reporter.
func (m *Libp2pMetrics) GetBandwidthForProtocol(protocol.ID) metrics.Stats {
	panic("BUG: this is not implemented and must never be called")
}

// GetBandwidthTotals implements libp2p metrics.Reporter.
func (m *Libp2pMetrics) GetBandwidthTotals() metrics.Stats {
	panic("BUG: this is not implemented and must never be called")
}

// GetBandwidthByPeer implements libp2p metrics.Reporter.
func (m *Libp2pMetrics) GetBandwidthByPeer() map[peer.ID]metrics.Stats {
	panic("BUG: this is not implemented and must never be called")
}

// GetBandwidthByProtocol implements libp2p metrics.Reporter.
func (m *Libp2pMetrics) GetBandwidthByProtocol() map[protocol.ID]metrics.Stats {
	panic("BUG: this is not implemented and must never be called")
}
