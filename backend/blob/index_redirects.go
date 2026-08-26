package blob

import (
	"encoding/json"
	"fmt"

	"seed/backend/util/dqb"
	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"
)

// maxRedirectHops bounds every redirect walk, matching the redirect_ancestors CTEs
// used by the comment listing queries.
const maxRedirectHops = 16

// ResolveRedirects follows document redirects forward from each of the given IRIs
// and reports where each moved document currently lives.
//
// A comment (and every other blob) records the IRI its target had at write time.
// When that document is later moved, the recorded IRI keeps pointing at the old
// path, whose latest generation is now a redirect. This helper walks that chain
// ($db.redirect of the latest generation, up to maxRedirectHops, cycle-safe) and
// returns a map from each IRI that has moved to the IRI at the end of its chain.
// IRIs that are unknown, or whose document has not moved, are absent from the map.
func ResolveRedirects(conn *sqlite.Conn, iris []string) (map[string]string, error) {
	if len(iris) == 0 {
		return nil, nil
	}

	seed, err := json.Marshal(iris)
	if err != nil {
		return nil, fmt.Errorf("failed to encode redirect seed: %w", err)
	}

	resolved := make(map[string]string)
	if err := sqlitex.Exec(conn, qResolveRedirects(), func(stmt *sqlite.Stmt) error {
		resolved[stmt.ColumnText(0)] = stmt.ColumnText(1)
		return nil
	}, string(seed), maxRedirectHops); err != nil {
		return nil, err
	}

	return resolved, nil
}

// The walk is seeded only from the requested IRIs, so its cost is bounded by the
// number of inputs times the chain length, regardless of how many documents in the
// database have ever been moved. The CROSS JOINs pin the recursive step to drive
// from the chain row, so each hop is a primary-key lookup in document_attributes
// followed by a unique-index lookup in resources; left to itself the planner
// walks the whole document_attributes_by_key range of redirects instead.
// The bare `iri` column in the final SELECT comes from the row holding MAX(depth),
// which SQLite guarantees for a single MAX() aggregate.
var qResolveRedirects = dqb.Str(`
	WITH RECURSIVE
	redirect_key AS (
		SELECT id FROM document_attribute_keys WHERE key = '$db.redirect'
	),
	chain(origin, resource, iri, depth) AS (
		SELECT r.iri, r.id, r.iri, 0
		FROM json_each(:iris) AS seed
		JOIN resources r ON r.iri = seed.value

		UNION ALL

		SELECT c.origin, r.id, r.iri, c.depth + 1
		FROM chain c
		CROSS JOIN document_attributes da
			ON da.resource = c.resource
			AND da.key = (SELECT id FROM redirect_key)
			AND da.kind = 's'
		CROSS JOIN resources r ON r.iri = da.value
		WHERE r.id != c.resource
		AND c.depth < :max_hops
	)
	SELECT origin, iri, MAX(depth) AS depth
	FROM chain
	GROUP BY origin
	HAVING depth > 0;
`)
