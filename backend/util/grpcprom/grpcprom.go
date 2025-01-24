// Package grpcprom provides prometheus metrics for grpc clients and servers.
// It exposes the metrics from the popular github.com/grpc-ecosystem/go-grpc-middleware/providers/prometheus package,
// in addition to some custom metrics defined in this package.
package grpcprom

import (
	"context"
	"strings"

	grpcprom "github.com/grpc-ecosystem/go-grpc-middleware/providers/prometheus"
	"github.com/prometheus/client_golang/prometheus"
	"google.golang.org/grpc/stats"
)

// ClientMetrics is a prometheus collector for client metrics,
// and a grpc stats handler for collecting more metrics about the client.
type ClientMetrics struct {
	*grpcprom.ClientMetrics
	*statsHandler
}

// NewClientMetrics creates a new ClientMetrics.
func NewClientMetrics() *ClientMetrics {
	return &ClientMetrics{
		ClientMetrics: grpcprom.NewClientMetrics(),
		statsHandler: &statsHandler{
			recv: prometheus.NewCounterVec(
				prometheus.CounterOpts{
					Name: "grpc_client_bytes_received_total",
					Help: "Total number of bytes received by the client.",
				},
				[]string{"grpc_service", "grpc_method"},
			),
			sent: prometheus.NewCounterVec(
				prometheus.CounterOpts{
					Name: "grpc_client_bytes_sent_total",
					Help: "Total number of bytes sent by the client.",
				},
				[]string{"grpc_service", "grpc_method"},
			),
		},
	}
}

// Describe implements prometheus.Collector.
func (m *ClientMetrics) Describe(ch chan<- *prometheus.Desc) {
	m.ClientMetrics.Describe(ch)
	m.statsHandler.recv.Describe(ch)
	m.statsHandler.sent.Describe(ch)
}

// Collect implements prometheus.Collector.
func (m *ClientMetrics) Collect(ch chan<- prometheus.Metric) {
	m.ClientMetrics.Collect(ch)
	m.statsHandler.recv.Collect(ch)
	m.statsHandler.sent.Collect(ch)
}

// ServerMetrics is a prometheus collector for server metrics.
type ServerMetrics struct {
	*grpcprom.ServerMetrics
	*statsHandler
}

// NewServerMetrics creates a new ServerMetrics,
// and a grpc stats handler for collecting more metrics about the server.
func NewServerMetrics() *ServerMetrics {
	return &ServerMetrics{
		ServerMetrics: grpcprom.NewServerMetrics(),
		statsHandler: &statsHandler{
			recv: prometheus.NewCounterVec(
				prometheus.CounterOpts{
					Name: "grpc_server_bytes_received_total",
					Help: "Total number of bytes received by the server.",
				},
				[]string{"grpc_service", "grpc_method"},
			),
			sent: prometheus.NewCounterVec(
				prometheus.CounterOpts{
					Name: "grpc_server_bytes_sent_total",
					Help: "Total number of bytes sent by the server.",
				},
				[]string{"grpc_service", "grpc_method"},
			),
		},
	}
}

// Describe implements prometheus.Collector.
func (m *ServerMetrics) Describe(ch chan<- *prometheus.Desc) {
	m.ServerMetrics.Describe(ch)
	m.statsHandler.recv.Describe(ch)
	m.statsHandler.sent.Describe(ch)
}

// Collect implements prometheus.Collector.
func (m *ServerMetrics) Collect(ch chan<- prometheus.Metric) {
	m.ServerMetrics.Collect(ch)
	m.statsHandler.recv.Collect(ch)
	m.statsHandler.sent.Collect(ch)
}

type statsHandler struct {
	sent *prometheus.CounterVec
	recv *prometheus.CounterVec
}

var serviceInfoKey = struct{}{}

type serviceInfo struct {
	Service string
	Method  string
}

func (h *statsHandler) TagRPC(ctx context.Context, info *stats.RPCTagInfo) context.Context {
	fullName := info.FullMethodName[1:] // remove the leading slash
	idx := strings.Index(fullName, "/")

	var sinfo serviceInfo
	if idx >= 0 {
		sinfo.Service = fullName[:idx]
		sinfo.Method = fullName[idx+1:]
	} else {
		sinfo.Service = "unknown"
		sinfo.Method = "unknown"
	}

	return context.WithValue(ctx, serviceInfoKey, sinfo)
}

func (h *statsHandler) HandleRPC(ctx context.Context, s stats.RPCStats) {
	sinfo, ok := ctx.Value(serviceInfoKey).(serviceInfo)
	if !ok {
		panic("BUG: stats handler isn't tagged with service info")
	}

	switch st := s.(type) {
	case *stats.InPayload:
		h.recv.WithLabelValues(sinfo.Service, sinfo.Method).Add(float64(st.WireLength))
	case *stats.OutPayload:
		h.sent.WithLabelValues(sinfo.Service, sinfo.Method).Add(float64(st.WireLength))
	}
}

func (h *statsHandler) TagConn(ctx context.Context, info *stats.ConnTagInfo) context.Context {
	return ctx
}

func (h *statsHandler) HandleConn(ctx context.Context, s stats.ConnStats) {}
