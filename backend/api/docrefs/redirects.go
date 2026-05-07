// Package docrefs contains helpers for resolving document resource references.
package docrefs

import (
	"time"

	"seed/backend/util/dqb"
	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"

	lru "github.com/hashicorp/golang-lru/v2"
)

const maxCanonicalRedirectHops = 16

// DefaultResolverSize and DefaultResolverTTL are the defaults used for the
// per-server canonical-IRI cache. The TTL bounds the staleness window when a
// document is moved while a recently-resolved IRI is still cached. 30s keeps
// the worst-case "stale not-found after a move" window short while letting
// hot-path callers (e.g. ListComments under desktop polling) collapse to a
// single SQL walk per IRI per window.
const (
	DefaultResolverSize = 1024
	DefaultResolverTTL  = 30 * time.Second
)

var qLatestDocumentRedirect = dqb.Str(`
	SELECT dg.metadata->>'$."$db.redirect".v'
	FROM resources r
	JOIN document_generations dg ON dg.resource = r.id
	WHERE r.iri = :iri
	ORDER BY dg.generation DESC
	LIMIT 1
`)

// resolveCanonicalDocumentIRIUncached follows document redirects from iri to the
// current canonical IRI. It returns ok=false when the redirect chain loops or
// exceeds the hop limit, because there is no unambiguous canonical document in
// that case.
//
// Callers should prefer [Resolver.Resolve], which caches results.
func resolveCanonicalDocumentIRIUncached(conn *sqlite.Conn, iri string) (canonical string, ok bool, err error) {
	current := iri
	seen := map[string]struct{}{current: {}}
	followed := 0

	for {
		next, err := latestDocumentRedirect(conn, current)
		if err != nil {
			return "", false, err
		}
		if next == "" {
			return current, true, nil
		}
		if _, exists := seen[next]; exists {
			return "", false, nil
		}
		if followed == maxCanonicalRedirectHops {
			return "", false, nil
		}

		seen[next] = struct{}{}
		current = next
		followed++
	}
}

func latestDocumentRedirect(conn *sqlite.Conn, iri string) (redirectIRI string, err error) {
	err = sqlitex.Exec(conn, qLatestDocumentRedirect(), func(stmt *sqlite.Stmt) error {
		if stmt.ColumnType(0) != sqlite.SQLITE_NULL {
			redirectIRI = stmt.ColumnText(0)
		}
		return nil
	}, iri)
	return redirectIRI, err
}

// resolverEntry holds a cached canonical-IRI lookup with its expiration time.
// Both successful and unsuccessful (loop / hop-limit) results are cached for
// the TTL window so that a malformed redirect chain does not produce a per-call
// SQL hammer either.
type resolverEntry struct {
	canonical string
	ok        bool
	expiresAt time.Time
}

// Resolver wraps [resolveCanonicalDocumentIRIUncached] with a bounded TTL-LRU
// cache. The underlying LRU cache is thread-safe, so no external
// synchronization is needed.
//
// A stampede of concurrent misses on the same IRI is bounded by SQLite read
// concurrency; if profiling later shows the stampede matters, wrap the walker
// in golang.org/x/sync/singleflight here.
type Resolver struct {
	cache *lru.Cache[string, resolverEntry]
	ttl   time.Duration
}

// NewResolver creates a new [Resolver] backed by an LRU of the given size and a
// per-entry TTL. size must be positive; ttl bounds how long a successful or
// unsuccessful lookup is reused before walking the redirect chain again.
func NewResolver(size int, ttl time.Duration) *Resolver {
	c, err := lru.New[string, resolverEntry](size)
	if err != nil {
		panic(err)
	}
	return &Resolver{cache: c, ttl: ttl}
}

// Resolve returns the canonical IRI for iri, walking the redirect chain on
// cache miss and caching the result for the resolver's TTL. Errors from the
// underlying SQL walk are not cached.
func (r *Resolver) Resolve(conn *sqlite.Conn, iri string) (canonical string, ok bool, err error) {
	if e, hit := r.cache.Get(iri); hit && time.Now().Before(e.expiresAt) {
		return e.canonical, e.ok, nil
	}
	canonical, ok, err = resolveCanonicalDocumentIRIUncached(conn, iri)
	if err != nil {
		return "", false, err
	}
	r.cache.Add(iri, resolverEntry{
		canonical: canonical,
		ok:        ok,
		expiresAt: time.Now().Add(r.ttl),
	})
	return canonical, ok, nil
}

// Invalidate drops a single cache entry. Reserved for a future blob-indexer
// hook that triggers on $db.redirect writes; not wired in this change.
func (r *Resolver) Invalidate(iri string) {
	r.cache.Remove(iri)
}
