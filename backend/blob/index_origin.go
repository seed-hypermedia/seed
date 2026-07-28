package blob

import (
	"context"

	"seed/backend/util/ctxkey"
)

var networkOriginKey = ctxkey.New("blob.NetworkOrigin", false)

// ContextWithNetworkOrigin marks a context as carrying blobs that arrived from
// the network, as opposed to ones this node just authored. The sync ingress
// paths set it; everything else (publish, device linking, reindex) leaves it
// off.
//
// Both sync performance metrics need the distinction. Counting a local publish
// as "synced" would inflate write throughput with bytes that never crossed the
// network, and a locally authored blob's arrival delay is meaningless — we
// wrote it ourselves, so it would report ~0 and drag every percentile down.
func ContextWithNetworkOrigin(ctx context.Context) context.Context {
	return networkOriginKey.WithValue(ctx, true)
}

func networkOrigin(ctx context.Context) bool {
	return networkOriginKey.Value(ctx)
}

var syncSiteKey = ctxkey.New("blob.SyncSite", "")

// ContextWithSyncSite tags a context with the space whose sync pulled these
// blobs.
//
// It exists for media. Raw blocks never reach the indexer, so unlike structural
// blobs they can't learn their space from what they contain — a raw block is
// reached by walking links out of a document that is long out of scope by the
// time the block lands in the blockstore. But the discovery session that caused
// the fetch does know its space, so it passes it down here. The attribution is
// therefore "the space whose catch-up pulled these bytes", which is the
// question the per-site breakdown is meant to answer.
func ContextWithSyncSite(ctx context.Context, space string) context.Context {
	if space == "" {
		return ctx
	}
	return syncSiteKey.WithValue(ctx, space)
}

func syncSite(ctx context.Context) string {
	return syncSiteKey.Value(ctx)
}
