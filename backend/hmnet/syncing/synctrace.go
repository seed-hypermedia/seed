package syncing

import (
	"context"
	"fmt"

	"github.com/peterbourgon/trc"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

// Trace categories for the in-memory eztrc collector, surfaced at the daemon's
// /debug/traces endpoint. Each discovery attempt opens one traceCategoryDiscover
// trace; each peer that attempt syncs with opens one traceCategoryPeer trace.
//
// eztrc categories are fixed strings, so the site IRI is written as the first
// event of every trace rather than encoded into the category. That keeps the
// per-category latency percentiles meaningful while still letting a single
// site's work — and repeated attempts ("start-overs") for the same site — be
// isolated with the trc UI's free-text query (?q=<iri>) or regexp filter.
const (
	traceCategoryDiscover = "sync.discover"
	traceCategoryPeer     = "sync.peer"
)

// markf records a timeline event on the active eztrc trace in ctx (if any) and,
// when log is non-nil and at debug level, emits the same line as a debug log.
// This way a single call site feeds both consumption paths: the live timeline
// at /debug/traces and a plain `seed/syncing=debug` terminal tail.
//
// It is safe to call with a ctx that carries no trace and/or a nil logger.
// When neither sink is active the cost is two cheap checks; the format string is
// only expanded when at least one sink will consume it.
func markf(ctx context.Context, log *zap.Logger, format string, args ...any) {
	if tr, ok := trc.MaybeGet(ctx); ok {
		tr.Tracef(format, args...)
	}
	if log != nil && log.Core().Enabled(zapcore.DebugLevel) {
		log.Debug(fmt.Sprintf(format, args...))
	}
}
