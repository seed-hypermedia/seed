package activity

import (
	context "context"
	"fmt"
	"seed/backend/blob"
	"seed/backend/core"
	activity "seed/backend/genproto/activity/v1alpha"
	"seed/backend/logging"
	"seed/backend/storage"
	"seed/backend/util/cleanup"
	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"
	"testing"
	"time"

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

func TestListEventsEmitsNextTokenWhenDedupShortensPage(t *testing.T) {
	alice := newTestServer(t, "alice")
	ctx := context.Background()

	author, err := core.DecodePrincipal("z6Mkv1LjkRosErBhmqrkmb5sDxXNs6EzBDSD8ktywpYLLGuC")
	require.NoError(t, err)

	require.NoError(t, alice.db.WithSave(ctx, func(conn *sqlite.Conn) error {
		if err := sqlitex.Exec(conn, `INSERT INTO public_keys (id, principal) VALUES (1, ?);`, nil, []byte(author)); err != nil {
			return err
		}
		// id=1: standalone resource — must be reachable on page 2.
		if err := insertActivityProfileEvent(conn, 1, 1, author.String()+"/standalone", 1_000); err != nil {
			return err
		}
		// id=2 and id=3 share resource+ts → the in-memory dedup loop drops one when both land on page 1.
		if err := insertActivityProfileEvent(conn, 2, 2, author.String()+"/duplicate", 2_000); err != nil {
			return err
		}
		return insertActivityProfileEventForResource(conn, 3, 2, 2_000)
	}))

	// Page 1: PageSize=2. DB returns id=3 and id=2 (sorted DESC); dedup drops id=2 since
	// it shares the (resource, type, account, EventTime) key with id=3.
	page1, err := alice.ListEvents(ctx, &activity.ListEventsRequest{
		PageSize:        2,
		FilterEventType: []string{"Profile"},
	})
	require.NoError(t, err)
	require.Len(t, page1.Events, 1)
	require.Equal(t, int64(3), page1.Events[0].GetNewBlob().GetBlobId())
	require.NotEmpty(t, page1.NextPageToken,
		"next page token must be present when DB returned a full batch but post-filtering shortened the page")

	page2, err := alice.ListEvents(ctx, &activity.ListEventsRequest{
		PageSize:        2,
		PageToken:       page1.NextPageToken,
		FilterEventType: []string{"Profile"},
	})
	require.NoError(t, err)
	// Dedup is intra-page, so id=2 re-surfaces alongside id=1 — that's a separate
	// (pre-existing) cross-page dedup concern. The point of this test is that id=1,
	// which was previously unreachable, is now delivered to the client.
	page2IDs := make([]int64, 0, len(page2.Events))
	for _, e := range page2.Events {
		page2IDs = append(page2IDs, e.GetNewBlob().GetBlobId())
	}
	require.Contains(t, page2IDs, int64(1),
		"id=1 must be reachable via pagination after dedup shortens page 1")
}

func TestListEventsCommentMentionSourceDocumentUsesCommentTarget(t *testing.T) {
	alice := newTestServer(t, "alice")
	ctx := context.Background()

	author, err := core.DecodePrincipal("z6Mkv1LjkRosErBhmqrkmb5sDxXNs6EzBDSD8ktywpYLLGuC")
	require.NoError(t, err)
	mentioned, err := core.DecodePrincipal("z6MkrJVnaZkeF1cWQrJ7g4LtpZvZQJtnYFWCKq66P2pyGcGP")
	require.NoError(t, err)
	commentTime := time.UnixMilli(1_000).UTC()
	commentTSID := blob.NewTSID(commentTime, []byte("comment"))

	require.NoError(t, alice.db.WithSave(ctx, func(conn *sqlite.Conn) error {
		if err := sqlitex.Exec(conn, `INSERT INTO public_keys (id, principal) VALUES (1, ?), (2, ?);`, nil, []byte(author), []byte(mentioned)); err != nil {
			return err
		}

		hash, err := multihash.Sum([]byte("comment-blob"), multihash.SHA2_256, -1)
		if err != nil {
			return err
		}
		profileHash, err := multihash.Sum([]byte("profile-resource"), multihash.SHA2_256, -1)
		if err != nil {
			return err
		}
		if err := sqlitex.Exec(conn, `INSERT INTO blobs (id, multihash, codec, data, size, insert_time) VALUES (100, ?, ?, ?, 1, 1), (101, ?, ?, ?, 1, 1);`, nil, []byte(hash), int64(0x55), []byte{1}, []byte(profileHash), int64(0x55), []byte{1}); err != nil {
			return err
		}

		docIRI := "hm://" + author.String() + "/doc"
		mentionedProfileIRI := "hm://" + mentioned.String() + "/:profile"
		if err := sqlitex.Exec(conn, `INSERT INTO resources (id, iri, owner, genesis_blob, create_time) VALUES (10, ?, 1, 100, 0), (20, ?, 2, 101, 0);`, nil, docIRI, mentionedProfileIRI); err != nil {
			return err
		}

		if err := sqlitex.Exec(conn, `INSERT INTO structural_blobs (id, type, ts, author, genesis_blob, resource, extra_attrs) VALUES (100, 'Comment', ?, 1, 100, 10, json_object('tsid', ?));`, nil, commentTime.UnixMilli(), commentTSID.String()); err != nil {
			return err
		}
		return sqlitex.Exec(conn, `INSERT INTO resource_links (source, target, type, is_pinned, extra_attrs) VALUES (100, 20, 'comment/Embed', 0, '{}');`, nil)
	}))

	events, err := alice.ListEvents(ctx, &activity.ListEventsRequest{
		PageSize:        10,
		FilterEventType: []string{"comment/Embed"},
	})
	require.NoError(t, err)
	require.Len(t, events.Events, 1)

	mention := events.Events[0].GetNewMention()
	require.NotNil(t, mention)
	require.Equal(t, "hm://"+author.String()+"/doc", mention.SourceDocument)
	require.Equal(t, "hm://"+mentioned.String()+"/:profile", mention.Target)
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

func insertActivityProfileEventForResource(conn *sqlite.Conn, blobID int64, resourceID int64, eventTimestampMillis int64) error {
	hash, err := multihash.Sum([]byte(fmt.Sprintf("blob-%d", blobID)), multihash.SHA2_256, -1)
	if err != nil {
		return err
	}
	if err := sqlitex.Exec(conn, `INSERT INTO blobs (id, multihash, codec, data, size, insert_time) VALUES (?, ?, ?, ?, ?, ?);`, nil, blobID, []byte(hash), int64(0x55), []byte{1}, int64(1), blobID); err != nil {
		return err
	}
	return sqlitex.Exec(conn, `INSERT INTO structural_blobs (id, type, ts, author, genesis_blob, resource, extra_attrs) VALUES (?, 'Profile', ?, 1, ?, ?, '{}');`, nil, blobID, eventTimestampMillis, blobID, resourceID)
}
