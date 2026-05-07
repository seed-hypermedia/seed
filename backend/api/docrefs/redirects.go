// Package docrefs contains helpers for resolving document resource references.
package docrefs

import (
	"seed/backend/util/dqb"
	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"
)

const maxCanonicalRedirectHops = 16

var qLatestDocumentRedirect = dqb.Str(`
	SELECT dg.metadata->>'$."$db.redirect".v'
	FROM resources r
	JOIN document_generations dg ON dg.resource = r.id
	WHERE r.iri = :iri
	ORDER BY dg.generation DESC
	LIMIT 1
`)

// ResolveCanonicalDocumentIRI follows document redirects from iri to the current canonical IRI.
// It returns ok=false when the redirect chain loops or exceeds the hop limit, because there is no
// unambiguous canonical document in that case.
func ResolveCanonicalDocumentIRI(conn *sqlite.Conn, iri string) (canonical string, ok bool, err error) {
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
