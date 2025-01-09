package blob

import (
	"context"
	"seed/backend/util/dqb"
	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"
)

var unreadsKey = struct{}{}

// ContextWithUnreadsTracking returns a new context with unreads tracking enabled.
func ContextWithUnreadsTracking(ctx context.Context) context.Context {
	return context.WithValue(ctx, unreadsKey, true)
}

func unreadsTrackingEnabled(ctx context.Context) bool {
	return ctx.Value(unreadsKey) != nil
}

func ensureUnread(conn *sqlite.Conn, iri IRI) error {
	return sqlitex.Exec(conn, qEnsureUnread(), nil, string(iri))
}

var qEnsureUnread = dqb.Str(`
	INSERT OR IGNORE INTO unread_resources (iri)
	VALUES (?);
`)

func deleteFromUnreads(conn *sqlite.Conn, iri IRI) error {
	return sqlitex.Exec(conn, qDeleteFromUnreads(), nil, string(iri))
}

var qDeleteFromUnreads = dqb.Str(`
	DELETE FROM unread_resources WHERE iri = ?;
`)

// SetReadStatus marks the resource as read.
func (idx *Index) SetReadStatus(ctx context.Context, iri IRI, wantRead bool) error {
	conn, release, err := idx.db.Conn(ctx)
	if err != nil {
		return err
	}
	defer release()

	if wantRead {
		return deleteFromUnreads(conn, iri)
	}

	return ensureUnread(conn, iri)
}
