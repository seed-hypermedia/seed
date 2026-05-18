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
	"strings"
	"sync"
	"time"

	telemetrypb "seed/backend/genproto/telemetry/v1alpha"

	"go.uber.org/zap"
	"google.golang.org/grpc"
)

// Stage names emitted by Go and TypeScript. Only stages that have an
// actual emitter on this branch are declared; planned-but-unwired stages
// are intentionally absent so the contract reflects reality. When you
// wire a new emitter, add its constant here and to the emitter site in
// the same commit.
//
// Emitted by:
//   - backend.feed_emitted          : activity.go ListEvents (per NewBlob)
//   - backend.grpc_request_received : documents.go GetDocument/GetAccount entry
//   - backend.grpc_response_sent    : documents.go GetDocument/GetAccount return (deferred)
//   - renderer.link_click           : frontend/apps/desktop telemetry.ts (navigation)
//   - renderer.component_rendered   : frontend/apps/desktop desktop-resource.tsx (after load)
const (
	StageFeedEmitted         = "backend.feed_emitted"
	StageGRPCRequestReceived = "backend.grpc_request_received"
	StageGRPCResponseSent    = "backend.grpc_response_sent"
	StageLinkClick           = "renderer.link_click"
	StageComponentRendered   = "renderer.component_rendered"
)

// initiatingStages are checkpoints that open a fresh generation for a URL
// even if a live generation already exists. Only user-initiated stamps
// belong here: a fresh click is a new journey, but a grpc request fielded
// by the daemon is a downstream step of whatever already started.
//
// Stages not listed here append to the live generation if one exists, or
// open gen 1 if no prior state exists for the key.
var initiatingStages = map[string]struct{}{
	StageLinkClick: {},
}

// Status describes the lifecycle of a single generation.
type Status string

// Status values.
const (
	StatusLive      Status = "live"
	StatusComplete  Status = "complete"
	StatusAbandoned Status = "abandoned"
	// StatusOrphan marks a trace whose only checkpoint is
	// renderer.component_rendered — i.e. the page rendered but we never
	// observed the upstream click or fetch that caused it. Common cases
	// are window restore, React Query cache hits, and deep links that
	// bypass the navigation dispatcher. The page rendered fine; the
	// journey itself just isn't observable end-to-end.
	StatusOrphan Status = "orphan"
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
func (s *Server) RecordCheckpoints(_ context.Context, req *telemetrypb.RecordCheckpointsRequest) (*telemetrypb.RecordCheckpointsResponse, error) {
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

	if !isLive {
		// Existing trace is sealed (complete, abandoned, orphan). Any new
		// stage opens a fresh generation — a new fetch or a new click on
		// the same key is a separate attempt.
		s.openGen(key, stage, ts, state.gen+1)
		return
	}

	if !isInitiating {
		s.appendLocked(tr, stage, ts)
		return
	}

	// Initiating stamp on a live trace. Two cases:
	//   1. The existing trace already has a frontend stage (renderer.* or
	//      main.*). That means the user already started a journey for this
	//      key in this generation, so this is a retry: seal old as
	//      abandoned and open a fresh gen.
	//   2. The existing trace has only backend.* stages (e.g. a sidebar
	//      hook triggered grpc_request_received before the user clicked).
	//      The user's click belongs to *that* journey, not a new one --
	//      append to the existing trace.
	if traceHasFrontendStage(tr) {
		s.sealLocked(tr, StatusAbandoned, ts)
		s.openGen(key, stage, ts, state.gen+1)
		return
	}
	s.appendLocked(tr, stage, ts)
}

// traceHasFrontendStage reports whether the trace already contains a
// checkpoint emitted by the Electron main or React renderer (stage prefix
// main.* or renderer.*). Used to distinguish "user is retrying" from
// "user is starting a journey on a key the daemon already prefetched".
func traceHasFrontendStage(tr *Trace) bool {
	for _, cp := range tr.Checkpoints {
		if strings.HasPrefix(cp.Stage, "renderer.") || strings.HasPrefix(cp.Stage, "main.") {
			return true
		}
	}
	return false
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
		// Single-stage trace: the renderer painted but we never observed
		// any upstream cause (no click, no fetch). Common with window
		// restore, React Query cache hits, and deep links that bypass the
		// navigation dispatcher. Mark orphan rather than complete so the
		// page doesn't dishonestly claim "end-to-end journey observed".
		tr.Status = StatusOrphan
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
		clone := *tr
		clone.lru = nil
		clone.Checkpoints = append([]Checkpoint(nil), tr.Checkpoints...)
		if clone.Status == StatusLive && now.Sub(clone.LastUpdate) > AbandonTimeout {
			clone.Status = StatusAbandoned
		}
		out = append(out, clone)
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
