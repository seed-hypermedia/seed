package blob

import (
	"context"
	"seed/backend/util/dqb"
	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"
)

func ensureUnread(conn *sqlite.Conn, iri IRI) error {
	return sqlitex.Exec(conn, qEnsureUnread(), nil, string(iri))
}

// SetReadStatus marks the resource as read.
func (idx *Index) SetReadStatus(ctx context.Context, iri IRI, wantRead, isRecursive bool) error {
	conn, release, err := idx.db.Conn(ctx)
	if err != nil {
		return err
	}
	defer release()

	var q string
	switch {
	case wantRead, !isRecursive:
		q = qDeleteFromUnreads()
	case wantRead, isRecursive:
		q = qDeleteFromUnreadsRecursive()
	case !wantRead, !isRecursive:
		q = qEnsureUnread()
	case !wantRead, isRecursive:
		q = qEnsureUnreadRecursive()
	}

	var args []any
	if isRecursive {
		args = []any{string(iri), string(iri) + "/*"}
	} else {
		args = []any{string(iri)}
	}

	return sqlitex.Exec(conn, q, nil, args...)
}

var qDeleteFromUnreads = dqb.Str(`
	DELETE FROM unread_resources WHERE iri = ?;
`)

var qEnsureUnread = dqb.Str(`
	INSERT OR IGNORE INTO unread_resources (iri)
	VALUES (?);
`)

var qDeleteFromUnreadsRecursive = dqb.Str(`
	DELETE FROM unread_resources
	WHERE iri = :iri OR iri GLOB :iriGlob;
`)

var qEnsureUnreadRecursive = dqb.Str(`
	INSERT OR IGNORE INTO unread_resources (iri)
	SELECT r.iri FROM resources r
	WHERE r.iri = :iri OR r.iri GLOB :iriGlob;
`)

var unreadsKey = struct{}{}

// ContextWithUnreadsTracking returns a new context with unreads tracking enabled.
func ContextWithUnreadsTracking(ctx context.Context) context.Context {
	return context.WithValue(ctx, unreadsKey, true)
}

func unreadsTrackingEnabled(ctx context.Context) bool {
	return ctx.Value(unreadsKey) != nil
}
