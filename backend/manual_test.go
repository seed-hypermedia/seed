package backend

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	documentsv3 "seed/backend/api/documents/v3alpha"
	"seed/backend/blob"
	"seed/backend/core/keystore"
	"seed/backend/storage"
	"seed/backend/testutil"
	"seed/backend/util/must"
	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"
	"testing"

	cbornode "github.com/ipfs/go-ipld-cbor"
	"github.com/klauspost/compress/zstd"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
)

func TestDBMigrateManual(t *testing.T) {
	// This is a convenience manual test
	// to verify the database migrations and indexing.
	// Before running the test duplicate your entire production data directory to /tmp/seed-db-migrate-test.
	//
	// Run with -cpuprofile to profile the reindex:
	//   go test ./backend -run TestDBMigrateManual -timeout 60m -v -cpuprofile /tmp/reindex.prof
	testutil.Manual(t)

	dir, err := storage.Open("/tmp/seed-db-migrate-test", nil, keystore.NewMemory(), "debug")
	require.NoError(t, err)
	defer dir.Close()

	db := dir.DB()

	log := must.Do2(zap.NewDevelopment())

	// OpenIndexPendingReindex, not OpenIndex: storage.Open above already ran the
	// migrations, and any migration that calls scheduleReindex leaves
	// last_reindex_time blank — so OpenIndex's inner MaybeReindex would reindex
	// once and the explicit Reindex below would do it all over again. Timings and
	// profiles taken across two passes are meaningless.
	blobs := blob.OpenIndexPendingReindex(db, log)

	// The daemon wires this before the reindex task starts (see daemon.Load), and
	// the reindex derives fallback cover images for every document generation.
	// Without it the deriver is nil and this test silently skips that work,
	// i.e. it does not reproduce what actually runs in production.
	blobs.SetDeriveFirstContentImage(documentsv3.DeriveFirstContentImage)

	require.NoError(t, blobs.Reindex(context.Background()))
}

func TestChangeAttributeValueShapesManual(t *testing.T) {
	testutil.Manual(t)

	home, err := os.UserHomeDir()
	require.NoError(t, err)
	dbPath := filepath.Join(home, "Library", "Application Support", "Seed-local", "daemon", "db", "db.sqlite")
	dbURI := (&url.URL{Scheme: "file", Path: dbPath, RawQuery: "mode=ro&immutable=1"}).String()
	conn, err := sqlite.OpenConn(dbURI, sqlite.SQLITE_OPEN_READONLY|sqlite.SQLITE_OPEN_URI|sqlite.SQLITE_OPEN_NOMUTEX)
	require.NoError(t, err)
	defer conn.Close()

	decoder, err := zstd.NewReader(nil)
	require.NoError(t, err)
	defer decoder.Close()

	var (
		changes, setKeyValues, setAttributeValues int
		arrays, objects                           int
		examples                                  []string
	)
	err = sqlitex.Exec(conn, `
		SELECT b.id, b.data
		FROM blobs b
		JOIN structural_blobs sb ON sb.id = b.id
		WHERE sb.type = 'Change' AND b.size > 0
	`, func(stmt *sqlite.Stmt) error {
		changes++
		change := new(blob.Change)
		data, err := decoder.DecodeAll(stmt.ColumnBytesUnsafe(1), nil)
		if err != nil {
			return fmt.Errorf("decompress change blob %d: %w", stmt.ColumnInt64(0), err)
		}
		if err := cbornode.DecodeInto(data, change); err != nil {
			return fmt.Errorf("decode change blob %d: %w", stmt.ColumnInt64(0), err)
		}

		for operation, err := range change.Ops() {
			if err != nil {
				return fmt.Errorf("decode operation in change blob %d: %w", stmt.ColumnInt64(0), err)
			}
			switch operation := operation.(type) {
			case blob.OpSetKey:
				setKeyValues++
				arrays, objects, examples = countAtomicCompositeValue(arrays, objects, examples, stmt.ColumnInt64(0), "SetKey", operation.Key, operation.Value)
			case blob.OpSetAttributes:
				for _, attribute := range operation.Attrs {
					setAttributeValues++
					arrays, objects, examples = countAtomicCompositeValue(arrays, objects, examples, stmt.ColumnInt64(0), "SetAttributes", fmt.Sprint(attribute.Key), attribute.Value)
				}
			}
		}
		return nil
	})
	require.NoError(t, err)
	t.Logf("scanned %d change blobs; SetKey values: %d; SetAttributes values: %d; atomic arrays: %d; atomic objects: %d", changes, setKeyValues, setAttributeValues, arrays, objects)
	for _, example := range examples {
		t.Log(example)
	}
}

func countAtomicCompositeValue(arrays, objects int, examples []string, blobID int64, operation, key string, value any) (int, int, []string) {
	if value == nil {
		return arrays, objects, examples
	}

	kind := reflect.TypeOf(value).Kind()
	shape := ""
	switch kind {
	case reflect.Array, reflect.Slice:
		arrays++
		shape = "array"
	case reflect.Map:
		objects++
		shape = "object"
	default:
		return arrays, objects, examples
	}
	if len(examples) < 20 {
		examples = append(examples, fmt.Sprintf("%s value: blob=%d operation=%s key=%q type=%T", shape, blobID, operation, key, value))
	}
	return arrays, objects, examples
}
