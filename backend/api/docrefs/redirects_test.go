package docrefs

import (
	"path/filepath"
	"testing"

	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"

	"github.com/stretchr/testify/require"
)

func TestResolveCanonicalDocumentIRI(t *testing.T) {
	conn := newTestConn(t)
	insertResource(t, conn, 1, "hm://space/old", `{"$db.redirect":{"v":"hm://space/mid"}}`)
	insertResource(t, conn, 2, "hm://space/mid", `{"$db.redirect":{"v":"hm://space/current"}}`)
	insertResource(t, conn, 3, "hm://space/current", `{}`)

	canonical, ok, err := ResolveCanonicalDocumentIRI(conn, "hm://space/old")
	require.NoError(t, err)
	require.True(t, ok)
	require.Equal(t, "hm://space/current", canonical)

	canonical, ok, err = ResolveCanonicalDocumentIRI(conn, "hm://space/current")
	require.NoError(t, err)
	require.True(t, ok)
	require.Equal(t, "hm://space/current", canonical)
}

func TestResolveCanonicalDocumentIRI_Loop(t *testing.T) {
	conn := newTestConn(t)
	insertResource(t, conn, 1, "hm://space/a", `{"$db.redirect":{"v":"hm://space/b"}}`)
	insertResource(t, conn, 2, "hm://space/b", `{"$db.redirect":{"v":"hm://space/a"}}`)

	canonical, ok, err := ResolveCanonicalDocumentIRI(conn, "hm://space/a")
	require.NoError(t, err)
	require.False(t, ok)
	require.Empty(t, canonical)
}

func TestResolveCanonicalDocumentIRI_DepthExceeded(t *testing.T) {
	conn := newTestConn(t)
	for i := 0; i <= maxCanonicalRedirectHops+1; i++ {
		iri := "hm://space/doc-" + string(rune('a'+i))
		metadata := `{}`
		if i <= maxCanonicalRedirectHops {
			nextIRI := "hm://space/doc-" + string(rune('a'+i+1))
			metadata = `{"$db.redirect":{"v":"` + nextIRI + `"}}`
		}
		insertResource(t, conn, int64(i+1), iri, metadata)
	}

	canonical, ok, err := ResolveCanonicalDocumentIRI(conn, "hm://space/doc-a")
	require.NoError(t, err)
	require.False(t, ok)
	require.Empty(t, canonical)
}

func newTestConn(t *testing.T) *sqlite.Conn {
	t.Helper()
	conn, err := sqlite.OpenConn(filepath.Join(t.TempDir(), "test.db"))
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, conn.Close()) })
	require.NoError(t, sqlitex.ExecScript(conn, `
		CREATE TABLE resources (
			id INTEGER PRIMARY KEY,
			iri TEXT UNIQUE NOT NULL
		);
		CREATE TABLE document_generations (
			resource INTEGER NOT NULL,
			generation INTEGER NOT NULL,
			genesis TEXT NOT NULL,
			metadata JSON NOT NULL DEFAULT ('{}'),
			PRIMARY KEY (resource, generation, genesis)
		) WITHOUT ROWID;
	`))
	return conn
}

func insertResource(t *testing.T, conn *sqlite.Conn, id int64, iri string, metadata string) {
	t.Helper()
	require.NoError(t, sqlitex.Exec(conn, `INSERT INTO resources (id, iri) VALUES (?, ?)`, nil, id, iri))
	require.NoError(t, sqlitex.Exec(conn, `INSERT INTO document_generations (resource, generation, genesis, metadata) VALUES (?, 1, ?, ?)`, nil, id, iri, metadata))
}
