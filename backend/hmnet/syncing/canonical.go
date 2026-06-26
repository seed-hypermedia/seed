package syncing

import (
	"context"

	"github.com/multiformats/go-multicodec"
)

type protocolVersionCtxKey struct{}

// WithProtocolVersion tags a context with the wire protocol version negotiated
// for the current stream. The reconcile handler reads it to decide whether to
// advertise the codec-canonical set. Exported so the network layer can tag the
// context of streams accepted on the canonical protocol listener.
func WithProtocolVersion(ctx context.Context, v string) context.Context {
	return context.WithValue(ctx, protocolVersionCtxKey{}, v)
}

// protocolVersionFromContext returns the negotiated protocol version, defaulting
// to the legacy version when none was tagged (so behavior is unchanged until
// negotiation populates it).
func protocolVersionFromContext(ctx context.Context) string {
	if v, ok := ctx.Value(protocolVersionCtxKey{}).(string); ok && v != "" {
		return v
	}
	return ProtocolVersionLegacy
}

// Wire protocol versions relevant to RBSR set advertisement.
//
// Under the legacy version a blob is advertised under whatever codec it was
// stored with, so the same content held as raw on one peer and dag-pb on
// another produces different CIDs — hence different per-item hashes and a
// different whole-set fingerprint, even though the content is identical. The
// canonical version rewrites the advertised codec so identical content yields
// identical fingerprints across peers. See [canonicalCodecFor].
const (
	ProtocolVersionLegacy    = "0.9.2"
	ProtocolVersionCanonical = "0.9.3"
)

// canonicalCodecFor maps a stored codec to the codec advertised under the
// canonical protocol: dag-pb collapses to raw (identical multihash and bytes —
// only the codec tag differs), everything else passes through unchanged. This
// is applied only at the advertisement boundary; stored blobs are untouched,
// and retrieval is multihash-keyed, so rewriting the advertised codec has no
// retrieval impact.
func canonicalCodecFor(codec int64) int64 {
	if multicodec.Code(uint64(codec)) == multicodec.DagPb { //nolint:gosec
		return int64(multicodec.Raw)
	}
	return codec
}

// codecForProtocol returns the codec a scope advertises for the given protocol
// version: canonicalized under the canonical protocol, verbatim otherwise.
func codecForProtocol(codec int64, protocolVersion string) int64 {
	if protocolVersion == ProtocolVersionCanonical {
		return canonicalCodecFor(codec)
	}
	return codec
}
