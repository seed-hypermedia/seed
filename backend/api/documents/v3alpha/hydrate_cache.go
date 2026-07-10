package documents

import (
	"context"
	"seed/backend/api/documents/v3alpha/docmodel"
	documents "seed/backend/genproto/documents/v3alpha"
	"seed/backend/util/singleflight"

	lru "github.com/hashicorp/golang-lru/v2"
	"google.golang.org/protobuf/proto"
)

// hydrateCacheSize bounds the number of distinct (document-version) entries we
// keep hydrated in memory. Entries are keyed by the content-addressed version,
// so each entry is immutable; the LRU only evicts to bound memory. A few
// hundred entries comfortably covers the hot set (the top ~26 documents drive
// ~60% of read load in production) while staying well within the daemon's
// memory budget.
const hydrateCacheSize = 2048

// hydrateCache memoizes the expensive Document.Hydrate materialization.
//
// Hydration replays a document's entire block-move op-log to rebuild the tree
// state (docmodel.treeOpSet.State -> isAncestor), which is superlinear in the
// document's edit history and dominates read-path CPU. A resolved document
// version is content-addressed and therefore immutable, so the hydrated proto
// for a given (iri, version) never changes and is safe to cache indefinitely.
//
// singleflight collapses concurrent identical hydrations (in production the
// same hot version is requested hundreds of times per minute) into a single
// computation whose result is shared by all waiters.
type hydrateCache struct {
	lru *lru.Cache[string, *documents.Document]
	sf  singleflight.Group[string, *documents.Document]
}

func newHydrateCache() *hydrateCache {
	c, err := lru.New[string, *documents.Document](hydrateCacheSize)
	if err != nil {
		// lru.New only errors on a non-positive size, which is a compile-time
		// constant here, so this can never happen.
		panic(err)
	}
	return &hydrateCache{lru: c}
}

// get returns the hydrated proto for doc, computing it at most once per
// version across all concurrent callers. iri is the document's hm:// URL, used
// together with the resolved version to form the immutable cache key. The
// returned proto is a defensive clone: cache entries are shared and must never
// be mutated by callers.
func (c *hydrateCache) get(ctx context.Context, iri string, doc *docmodel.Document) (*documents.Document, error) {
	version := doc.Version().String()
	if version == "" {
		// No committed version (shouldn't happen on a read path, but be safe):
		// skip the cache entirely rather than share an unkeyable entry.
		return doc.Hydrate(ctx)
	}

	key := iri + "@" + version

	if cached, ok := c.lru.Get(key); ok {
		return proto.Clone(cached).(*documents.Document), nil
	}

	result, err, _ := c.sf.Do(key, func() (*documents.Document, error) {
		if cached, ok := c.lru.Get(key); ok {
			return cached, nil
		}
		hydrated, err := doc.Hydrate(ctx)
		if err != nil {
			return nil, err
		}
		c.lru.Add(key, hydrated)
		return hydrated, nil
	})
	if err != nil {
		return nil, err
	}

	return proto.Clone(result).(*documents.Document), nil
}
