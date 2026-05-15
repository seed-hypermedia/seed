package activity

import (
	context "context"
	"seed/backend/core"
	activity "seed/backend/genproto/activity/v1alpha"
	"seed/backend/logging"
	"seed/backend/storage"
	"seed/backend/util/cleanup"
	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"
	"testing"

	"github.com/multiformats/go-multihash"
	"github.com/stretchr/testify/require"
)

func TestListEvents(t *testing.T) {
	alice := newTestServer(t, "alice")
	ctx := context.Background()

	// Invalid author principal
	_, err := alice.ListEvents(ctx, &activity.ListEventsRequest{
		PageSize:      10,
		FilterAuthors: []string{"invalid-principal"},
	})
	require.Error(t, err)

	// Invalid resource format
	_, err = alice.ListEvents(ctx, &activity.ListEventsRequest{
		PageSize:       10,
		FilterResource: "not-a-resource",
	})
	require.Error(t, err)

	// Invalid event type (see allowlist in the server)
	_, err = alice.ListEvents(ctx, &activity.ListEventsRequest{
		PageSize:        10,
		FilterEventType: []string{"invalid-type"},
	})
	require.Error(t, err)

	events, err := alice.ListEvents(ctx, &activity.ListEventsRequest{
		PageSize:  5,
		PageToken: "",
	})
	require.NoError(t, err)
	require.NotNil(t, events)
	require.Len(t, events.Events, 0)
}

func TestListEventsOrdersByLocalObservation(t *testing.T) {
	alice := newTestServer(t, "alice")
	ctx := context.Background()

	author, err := core.DecodePrincipal("z6Mkv1LjkRosErBhmqrkmb5sDxXNs6EzBDSD8ktywpYLLGuC")
	require.NoError(t, err)

	require.NoError(t, alice.db.WithSave(ctx, func(conn *sqlite.Conn) error {
		if err := sqlitex.Exec(conn, `INSERT INTO public_keys (id, principal) VALUES (1, ?);`, nil, []byte(author)); err != nil {
			return err
		}
		if err := insertActivityProfileEvent(conn, 1, 1, author.String()+"/older-observed", 2_000); err != nil {
			return err
		}
		return insertActivityProfileEvent(conn, 2, 2, author.String()+"/newer-observed", 1_000)
	}))

	events, err := alice.ListEvents(ctx, &activity.ListEventsRequest{
		PageSize:        1,
		FilterEventType: []string{"Profile"},
	})
	require.NoError(t, err)
	require.Len(t, events.Events, 1)
	require.Equal(t, int64(2), events.Events[0].GetNewBlob().GetBlobId())
	require.NotEmpty(t, events.NextPageToken)

	nextPage, err := alice.ListEvents(ctx, &activity.ListEventsRequest{
		PageSize:        1,
		PageToken:       events.NextPageToken,
		FilterEventType: []string{"Profile"},
	})
	require.NoError(t, err)
	require.Len(t, nextPage.Events, 1)
	require.Equal(t, int64(1), nextPage.Events[0].GetNewBlob().GetBlobId())
}

// TODO: update profile idempotent no change

func newTestServer(t *testing.T, name string) *Server {
	db := storage.MakeTestDB(t)
	var clean cleanup.Stack
	return NewServer(db, logging.New("seed/Activity", "debug"), &clean, nil)
}

func insertActivityProfileEvent(conn *sqlite.Conn, blobID int64, resourceID int64, resourcePath string, eventTimestampMillis int64) error {
	hash, err := multihash.Sum([]byte(resourcePath), multihash.SHA2_256, -1)
	if err != nil {
		return err
	}
	resourceIRI := "hm://" + resourcePath
	if err := sqlitex.Exec(conn, `INSERT INTO blobs (id, multihash, codec, data, size, insert_time) VALUES (?, ?, ?, ?, ?, ?);`, nil, blobID, []byte(hash), int64(0x55), []byte{1}, int64(1), blobID); err != nil {
		return err
	}
	if err := sqlitex.Exec(conn, `INSERT INTO resources (id, iri, owner, genesis_blob, create_time) VALUES (?, ?, 1, ?, 0);`, nil, resourceID, resourceIRI, blobID); err != nil {
		return err
	}
	if err := sqlitex.Exec(conn, `INSERT INTO document_generations (resource, generation, genesis, genesis_change_time) VALUES (?, 0, ?, 0);`, nil, resourceID, resourceIRI); err != nil {
		return err
	}
	return sqlitex.Exec(conn, `INSERT INTO structural_blobs (id, type, ts, author, genesis_blob, resource, extra_attrs) VALUES (?, 'Profile', ?, 1, ?, ?, '{}');`, nil, blobID, eventTimestampMillis, blobID, resourceID)
}
