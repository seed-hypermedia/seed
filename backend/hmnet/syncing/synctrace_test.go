package syncing

import (
	"context"
	"strings"
	"testing"

	"github.com/peterbourgon/trc"
	"github.com/peterbourgon/trc/eztrc"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"go.uber.org/zap/zaptest/observer"
)

func TestMarkfEmitsToTraceAndLog(t *testing.T) {
	t.Parallel()

	core, logs := observer.New(zapcore.DebugLevel)
	log := zap.New(core)

	ctx, tr := eztrc.New(context.Background(), "test.markf.both")
	markf(ctx, log, "hello %d %s", 42, "world")
	tr.Finish()

	// Logged once, fully formatted.
	require.Equal(t, 1, logs.Len())
	require.Equal(t, "hello 42 world", logs.All()[0].Message)

	// Recorded on the trace too.
	require.True(t, hasEvent(tr.Events(), "hello 42 world"), "expected mark on trace events")
}

func TestMarkfRespectsLogLevel(t *testing.T) {
	t.Parallel()

	// Logger sits above debug: the debug-level mark must not be logged, but the
	// trace event must still be recorded.
	core, logs := observer.New(zapcore.InfoLevel)
	log := zap.New(core)

	ctx, tr := eztrc.New(context.Background(), "test.markf.level")
	markf(ctx, log, "debug only")
	tr.Finish()

	require.Equal(t, 0, logs.Len(), "debug mark should be suppressed at info level")
	require.True(t, hasEvent(tr.Events(), "debug only"))
}

func TestMarkfNilSafe(t *testing.T) {
	t.Parallel()

	// No trace in context and no logger: must not panic, must not record.
	require.NotPanics(t, func() {
		markf(context.Background(), nil, "no sinks %d", 1)
	})
}

// TestSyncTraceCategoriesSearchable proves the /debug/traces consumption path:
// a sync.discover trace carrying the site IRI plus the RBSR/bitswap marks is
// retained in the global collector and can be isolated by category + IRI query
// (exactly what an operator does in the trc UI).
func TestSyncTraceCategoriesSearchable(t *testing.T) {
	t.Parallel()

	const iri = "hm://synctracetestresource"

	ctx, tr := eztrc.New(context.Background(), traceCategoryDiscover)
	markf(ctx, nil, "discover start: iri=%s recursive=true depthOne=false", iri)
	markf(ctx, nil, "round 1: sent 1 ranges, rpc=12ms [new_conn], +5 wants +0 haves, cumulative 5 wants")
	markf(ctx, nil, "bitswap fetch start: requesting 5 blobs")
	markf(ctx, nil, "bitswap complete: got 5/5 blobs in 30ms (last block 1ms ago)")
	tr.Finish()

	resp, err := eztrc.Collector().Search(context.Background(), &trc.SearchRequest{
		Filter: trc.Filter{Category: traceCategoryDiscover, Query: iri},
		Limit:  trc.SearchLimitMax,
	})
	require.NoError(t, err)
	require.NotEmpty(t, resp.Traces, "expected the sync.discover trace to be searchable by IRI")

	var matched bool
	for _, st := range resp.Traces {
		if hasEvent(st.Events(), iri) && hasEvent(st.Events(), "bitswap fetch start") {
			matched = true
			break
		}
	}
	require.True(t, matched, "matched trace should contain the IRI and the bitswap fetch-start mark")
}

// TestMarkfIncludesLoggerFields locks the grep contract for the seed/synctrace
// log path: structured fields on the trace logger (iri, peer) must appear on
// every emitted mark line, so the flat log can be filtered to one site/peer.
func TestMarkfIncludesLoggerFields(t *testing.T) {
	t.Parallel()

	core, logs := observer.New(zapcore.DebugLevel)
	log := zap.New(core).With(
		zap.String("iri", "hm://abc123"),
		zap.String("peer", "12D3KooWxyz"),
	)

	markf(context.Background(), log, "round %d: +%d wants", 1, 5)

	require.Equal(t, 1, logs.Len())
	e := logs.All()[0]
	require.Equal(t, "round 1: +5 wants", e.Message)
	fields := e.ContextMap()
	require.Equal(t, "hm://abc123", fields["iri"])
	require.Equal(t, "12D3KooWxyz", fields["peer"])
}

func hasEvent(events []trc.Event, substr string) bool {
	for _, e := range events {
		if strings.Contains(e.What, substr) {
			return true
		}
	}
	return false
}
