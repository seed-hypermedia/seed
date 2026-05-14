// Package telemetry implements the Telemetry gRPC service and an in-memory
// ring buffer of journey traces.
//
// A "journey" is the wall-clock sequence of checkpoints a single
// hm://<account>/<path>?v=<version> URL takes from arriving in the daemon to
// being painted in the desktop UI. Both the Go daemon and the Electron
// processes record checkpoints against the same correlation key (the URL),
// and this package joins them so /debug/journeys can show the full timeline.
//
// The wire schema (proto) is intentionally minimal: emitters send only
// (key, stage, ts). All of the policy — initiating-vs-continuing
// classification, generation assignment on retries, abandonment timeouts,
// percentile aggregation — lives in this package and runs at read time, so
// the emitter hot path is one mutex-protected append.
package telemetry

import (
	"container/list"
	"context"
	"sort"
	"sync"
	"time"

	telemetrypb "seed/backend/genproto/telemetry/v1alpha"

	"go.uber.org/zap"
	"google.golang.org/grpc"
)

// Stage names emitted by Go and TypeScript. Keep both sides in sync.
const (
	StageBlobIndexed           = "backend.blob_indexed"
	StageFeedEmitted           = "backend.feed_emitted"
	StageGRPCRequestReceived   = "backend.grpc_request_received"
	StageGRPCResponseSent      = "backend.grpc_response_sent"
	StageFeedEventReceived     = "main.feed_event_received"
	StageInvalidationBroadcast = "main.invalidation_broadcast"
	StageSupersededBy          = "main.superseded_by"
	StageInvalidationReceived  = "renderer.invalidation_received"
	StageRefetchStart          = "renderer.refetch_start"
	StageGRPCCallStart         = "renderer.grpc_call_start"
	StageGRPCCallEnd           = "renderer.grpc_call_end"
	StageCacheUpdated          = "renderer.cache_updated"
	StageComponentRendered     = "renderer.component_rendered"
)

// initiatingStages are checkpoints that open a fresh generation for a URL
// even if a live generation already exists. They're stamped when an attempt
// for the URL begins from "the outside" (a peer pushed a new blob, an RPC
// arrived, a renderer started a fetch).
var initiatingStages = map[string]struct{}{
	StageBlobIndexed:         {},
	StageGRPCRequestReceived: {},
	StageGRPCCallStart:       {},
}

// Status describes the lifecycle of a single generation.
type Status string

// Status values.
const (
	StatusLive       Status = "live"
	StatusComplete   Status = "complete"
	StatusAbandoned  Status = "abandoned"
	StatusCoalesced  Status = "coalesced"
)

// AbandonTimeout is how long a generation may sit idle before being
// classified as abandoned. Plan-locked at 30s.
const AbandonTimeout = 30 * time.Second

// DefaultMaxTraces caps the in-memory ring at this many generations.
// Plan-locked at 500.
const DefaultMaxTraces = 500

// Checkpoint is a single (stage, time) sample.
type Checkpoint struct {
	Stage string
	TS    time.Time
}

// Trace is one generation of a URL's journey.
type Trace struct {
	Key         string
	Gen         int
	Status      Status
	Checkpoints []Checkpoint
	LastUpdate  time.Time

	lru *list.Element // back-pointer into the LRU list
}

// urlState tracks the latest generation observed for a URL.
type urlState struct {
	gen   int
	trace *Trace
}

// Server implements the gRPC Telemetry service and owns the ring buffer.
type Server struct {
	telemetrypb.UnimplementedTelemetryServer

	log *zap.Logger

	mu        sync.Mutex
	traces    map[string]*Trace // keyed by Key#Gen
	perURL    map[string]*urlState
	lru       *list.List // *Trace, MRU at front
	maxTraces int

	// Now is injectable for tests. Defaults to time.Now.
	Now func() time.Time
}

// NewServer constructs a Telemetry server with the default capacity.
func NewServer(log *zap.Logger) *Server {
	return NewServerWithCapacity(log, DefaultMaxTraces)
}

// NewServerWithCapacity constructs a Telemetry server with a custom ring size.
func NewServerWithCapacity(log *zap.Logger, maxTraces int) *Server {
	if maxTraces <= 0 {
		maxTraces = DefaultMaxTraces
	}
	return &Server{
		log:       log,
		traces:    make(map[string]*Trace, maxTraces),
		perURL:    make(map[string]*urlState, maxTraces),
		lru:       list.New(),
		maxTraces: maxTraces,
		Now:       time.Now,
	}
}

// RegisterServer registers the gRPC service with the given registrar.
func (s *Server) RegisterServer(rpc grpc.ServiceRegistrar) {
	telemetrypb.RegisterTelemetryServer(rpc, s)
}

// RecordCheckpoints implements the gRPC RecordCheckpoints method. Called by
// Electron main and renderer processes.
func (s *Server) RecordCheckpoints(ctx context.Context, req *telemetrypb.RecordCheckpointsRequest) (*telemetrypb.RecordCheckpointsResponse, error) {
	if req == nil || len(req.Checkpoints) == 0 {
		return &telemetrypb.RecordCheckpointsResponse{}, nil
	}
	for _, cp := range req.Checkpoints {
		if cp == nil || cp.Key == "" || cp.Stage == "" {
			continue
		}
		s.RecordCheckpoint(cp.Key, cp.Stage, time.Unix(0, cp.TsUnixNanos))
	}
	return &telemetrypb.RecordCheckpointsResponse{}, nil
}

// RecordCheckpoint is the in-process emitter API. Go callers use this; the
// gRPC service translates external calls into this same path. Cheap: one
// mutex acquisition + a few map lookups + a slice append.
func (s *Server) RecordCheckpoint(key, stage string, ts time.Time) {
	if key == "" || stage == "" {
		return
	}
	if ts.IsZero() {
		ts = s.Now()
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	state, ok := s.perURL[key]
	if !ok {
		s.openGen(key, stage, ts, 1)
		return
	}

	tr := state.trace
	isInitiating := isInitiating(stage)
	isLive := tr.Status == StatusLive

	if stage == StageSupersededBy {
		// Special-case: a superseded_by stamp seals the existing gen as
		// coalesced (if still live) and is *not* itself appended to a trace.
		// If the current gen is already terminal there's nothing to do.
		if isLive {
			s.sealLocked(tr, StatusCoalesced, ts)
		}
		return
	}

	if !isInitiating && isLive {
		s.appendLocked(tr, stage, ts)
		return
	}

	if isLive {
		// initiating stamp arriving while a live gen exists: seal the old
		// (abandoned because it never reached component_rendered) and open
		// a fresh gen.
		s.sealLocked(tr, StatusAbandoned, ts)
	}
	s.openGen(key, stage, ts, state.gen+1)
}

func (s *Server) openGen(key, stage string, ts time.Time, gen int) {
	tr := &Trace{
		Key:         key,
		Gen:         gen,
		Status:      StatusLive,
		Checkpoints: []Checkpoint{{Stage: stage, TS: ts}},
		LastUpdate:  ts,
	}
	tr.lru = s.lru.PushFront(tr)
	s.traces[traceID(key, gen)] = tr
	s.perURL[key] = &urlState{gen: gen, trace: tr}

	if stage == StageComponentRendered {
		// Single-stage trace, e.g. cached render with no preceding fetch. Seal
		// immediately so we don't keep it as "live" forever.
		tr.Status = StatusComplete
	}

	s.evictLocked()
}

func (s *Server) appendLocked(tr *Trace, stage string, ts time.Time) {
	tr.Checkpoints = append(tr.Checkpoints, Checkpoint{Stage: stage, TS: ts})
	tr.LastUpdate = ts
	if tr.lru != nil {
		s.lru.MoveToFront(tr.lru)
	}
	if stage == StageComponentRendered {
		tr.Status = StatusComplete
	}
}

func (s *Server) sealLocked(tr *Trace, status Status, _ time.Time) {
	if tr.Status != StatusLive {
		return
	}
	tr.Status = status
}

func (s *Server) evictLocked() {
	for s.lru.Len() > s.maxTraces {
		elem := s.lru.Back()
		if elem == nil {
			return
		}
		tr := elem.Value.(*Trace)
		s.lru.Remove(elem)
		delete(s.traces, traceID(tr.Key, tr.Gen))

		// Only clear perURL if this was the latest gen.
		if st, ok := s.perURL[tr.Key]; ok && st.trace == tr {
			delete(s.perURL, tr.Key)
		}
	}
}

// Snapshot returns a copy of all retained traces, with abandoned-by-timeout
// classification applied at read time. The result is sorted by LastUpdate
// (most recent first).
func (s *Server) Snapshot() []Trace {
	s.mu.Lock()
	defer s.mu.Unlock()

	now := s.Now()
	out := make([]Trace, 0, len(s.traces))
	for _, tr := range s.traces {
		copy := *tr
		copy.lru = nil
		copy.Checkpoints = append([]Checkpoint(nil), tr.Checkpoints...)
		if copy.Status == StatusLive && now.Sub(copy.LastUpdate) > AbandonTimeout {
			copy.Status = StatusAbandoned
		}
		out = append(out, copy)
	}
	sort.Slice(out, func(i, j int) bool {
		return out[i].LastUpdate.After(out[j].LastUpdate)
	})
	return out
}

// SweepAbandoned upgrades any live trace older than AbandonTimeout to
// abandoned status. Idempotent. Mostly useful for tests; the HTML handler
// derives status lazily via Snapshot, so production code doesn't need to
// call this.
func (s *Server) SweepAbandoned() {
	s.mu.Lock()
	defer s.mu.Unlock()

	now := s.Now()
	for _, tr := range s.traces {
		if tr.Status == StatusLive && now.Sub(tr.LastUpdate) > AbandonTimeout {
			tr.Status = StatusAbandoned
		}
	}
}

// Reset clears all retained traces. Used by tests.
func (s *Server) Reset() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.traces = make(map[string]*Trace, s.maxTraces)
	s.perURL = make(map[string]*urlState, s.maxTraces)
	s.lru = list.New()
}

// isInitiating reports whether a stage opens a fresh generation when it
// arrives.
func isInitiating(stage string) bool {
	_, ok := initiatingStages[stage]
	return ok
}

func traceID(key string, gen int) string {
	// Stable enough for an in-memory map; using a separator that can't appear
	// in a CID-pinned hm:// URL.
	return key + "#" + itoa(gen)
}

// itoa is a small allocation-free int-to-string for non-negative generation
// numbers. We expect single- or double-digit gens in normal use.
func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var buf [20]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	return string(buf[i:])
}
