package activity

import (
	context "context"
	"encoding/json"
	"fmt"
	"seed/backend/api/entities/v1alpha"
	"seed/backend/blob"
	"seed/backend/core"
	activity "seed/backend/genproto/activity/v1alpha"
	entity_proto "seed/backend/genproto/entities/v1alpha"
	"seed/backend/logging"
	"seed/backend/storage"
	"seed/backend/util/cleanup"
	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"
	"slices"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/multiformats/go-multihash"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/types/known/timestamppb"
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

func TestListEventsDefaultsToClaimedTimeOrder(t *testing.T) {
	alice := newTestServer(t, "alice")
	ctx := context.Background()

	author, err := core.DecodePrincipal("z6Mkv1LjkRosErBhmqrkmb5sDxXNs6EzBDSD8ktywpYLLGuC")
	require.NoError(t, err)

	require.NoError(t, alice.db.WithTx(ctx, func(conn *sqlite.Conn) error {
		if err := sqlitex.Exec(conn, `INSERT INTO public_keys (id, principal) VALUES (1, ?);`, nil, []byte(author)); err != nil {
			return err
		}
		if err := insertActivityProfileEvent(conn, 1, 1, author.String()+"/newer-claimed", 2_000); err != nil {
			return err
		}
		return insertActivityProfileEvent(conn, 2, 2, author.String()+"/older-claimed", 1_000)
	}))

	events, err := alice.ListEvents(ctx, &activity.ListEventsRequest{
		PageSize:        1,
		FilterEventType: []string{"Profile"},
	})
	require.NoError(t, err)
	require.Len(t, events.Events, 1)
	require.Equal(t, int64(1), events.Events[0].GetNewBlob().GetBlobId())
	require.NotEmpty(t, events.NextPageToken)

	nextPage, err := alice.ListEvents(ctx, &activity.ListEventsRequest{
		PageSize:        1,
		PageToken:       events.NextPageToken,
		FilterEventType: []string{"Profile"},
	})
	require.NoError(t, err)
	require.Len(t, nextPage.Events, 1)
	require.Equal(t, int64(2), nextPage.Events[0].GetNewBlob().GetBlobId())
}

func TestListEventsOrdersByLocalObservationWhenRequested(t *testing.T) {
	alice := newTestServer(t, "alice")
	ctx := context.Background()

	author, err := core.DecodePrincipal("z6Mkv1LjkRosErBhmqrkmb5sDxXNs6EzBDSD8ktywpYLLGuC")
	require.NoError(t, err)

	require.NoError(t, alice.db.WithTx(ctx, func(conn *sqlite.Conn) error {
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
		Order:           activity.FeedOrder_FEED_ORDER_OBSERVED_TIME,
	})
	require.NoError(t, err)
	require.Len(t, events.Events, 1)
	require.Equal(t, int64(2), events.Events[0].GetNewBlob().GetBlobId())
	require.NotEmpty(t, events.NextPageToken)

	nextPage, err := alice.ListEvents(ctx, &activity.ListEventsRequest{
		PageSize:        1,
		PageToken:       events.NextPageToken,
		FilterEventType: []string{"Profile"},
		Order:           activity.FeedOrder_FEED_ORDER_OBSERVED_TIME,
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

	require.NoError(t, alice.db.WithTx(ctx, func(conn *sqlite.Conn) error {
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
		Order:           activity.FeedOrder_FEED_ORDER_OBSERVED_TIME,
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
		Order:           activity.FeedOrder_FEED_ORDER_OBSERVED_TIME,
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

func TestListEventsPaginationDoesNotSkipWindowWhenOldMentionEntersPage(t *testing.T) {
	alice := newTestServer(t, "alice")
	ctx := context.Background()

	author, err := core.DecodePrincipal("z6Mkv1LjkRosErBhmqrkmb5sDxXNs6EzBDSD8ktywpYLLGuC")
	require.NoError(t, err)

	// Fixture mirroring the production incident (seed-hypermedia/seed#863):
	// the main (blobs) query and the mentions query are each limited to
	// PageSize, but the mentions scan reaches much deeper in time. When the
	// in-memory dedup drops one of the main events from the first page, an
	// old mention slips into the page, and the next-page token — the minimum
	// cursor of the page — jumps below every not-yet-emitted main event,
	// silently skipping them on all subsequent pages.
	//
	// Timeline: seven Profile events at ts 6000..1000; blobs 2 and 3 share a
	// resource and timestamp so dedup drops one; a single comment/Embed
	// mention sits far in the past at ts=500.
	commentTime := time.UnixMilli(500).UTC().Round(blob.ClockPrecision)
	commentTSID := blob.NewTSID(commentTime, []byte("old comment"))
	commentAttrs := fmt.Sprintf(`{"tsid":%q}`, commentTSID.String())
	commentHash, err := multihash.Sum([]byte("old comment"), multihash.SHA2_256, -1)
	require.NoError(t, err)

	require.NoError(t, alice.db.WithTx(ctx, func(conn *sqlite.Conn) error {
		if err := sqlitex.Exec(conn, `INSERT INTO public_keys (id, principal) VALUES (1, ?);`, nil, []byte(author)); err != nil {
			return err
		}
		if err := insertActivityProfileEvent(conn, 1, 1, author.String()+"/p1", 6_000); err != nil {
			return err
		}
		if err := insertActivityProfileEvent(conn, 2, 2, author.String()+"/p2", 5_000); err != nil {
			return err
		}
		if err := insertActivityProfileEventForResource(conn, 3, 2, 5_000); err != nil {
			return err
		}
		if err := insertActivityProfileEvent(conn, 4, 4, author.String()+"/p4", 4_000); err != nil {
			return err
		}
		if err := insertActivityProfileEvent(conn, 5, 5, author.String()+"/p5", 3_000); err != nil {
			return err
		}
		if err := insertActivityProfileEvent(conn, 6, 6, author.String()+"/p6", 2_000); err != nil {
			return err
		}
		if err := insertActivityProfileEvent(conn, 7, 7, author.String()+"/p7", 1_000); err != nil {
			return err
		}
		if err := sqlitex.Exec(conn, `INSERT INTO blobs (id, multihash, codec, data, size, insert_time) VALUES (10, ?, ?, ?, 1, 10);`, nil, []byte(commentHash), int64(0x71), []byte{1}); err != nil {
			return err
		}
		if err := sqlitex.Exec(conn, `INSERT INTO structural_blobs (id, type, ts, author, resource, extra_attrs) VALUES (10, 'Comment', ?, 1, 1, ?);`, nil, commentTime.UnixMilli(), commentAttrs); err != nil {
			return err
		}
		return sqlitex.Exec(conn, `INSERT INTO resource_links (source, target, type, is_pinned, extra_attrs) VALUES (10, 4, 'comment/Embed', 0, '{}');`, nil)
	}))

	// Page through the feed exactly like the frontend does (PageSize 5,
	// claimed-time order) and collect every delivered main blob id.
	var gotBlobIDs []int64
	var gotMention bool
	var token string
	for range 10 {
		page, err := alice.ListEvents(ctx, &activity.ListEventsRequest{
			PageSize:        5,
			PageToken:       token,
			FilterEventType: []string{"Profile", "comment/Embed"},
		})
		require.NoError(t, err)
		for _, e := range page.Events {
			if nb := e.GetNewBlob(); nb != nil {
				gotBlobIDs = append(gotBlobIDs, nb.GetBlobId())
			} else if e.GetNewMention() != nil {
				gotMention = true
			}
		}
		if page.NextPageToken == "" {
			break
		}
		token = page.NextPageToken
	}

	for _, id := range []int64{1, 4, 5, 6, 7} {
		require.Contains(t, gotBlobIDs, id, "blob %d must be delivered by pagination", id)
	}
	require.True(t, gotMention, "the old mention must eventually be delivered")
}

func TestListEventsEmitsNextTokenWhenTruncationCutsUnderFullFetches(t *testing.T) {
	alice := newTestServer(t, "alice")
	ctx := context.Background()

	author, err := core.DecodePrincipal("z6Mkv1LjkRosErBhmqrkmb5sDxXNs6EzBDSD8ktywpYLLGuC")
	require.NoError(t, err)

	// Both DB fetches return fewer rows than PageSize (4 main events, 2
	// mentions), but the merged list (6) still exceeds PageSize (5). The
	// truncated tail must stay reachable via a next-page token instead of
	// dead-ending.
	mkComment := func(conn *sqlite.Conn, blobID int64, millis int64) error {
		commentTime := time.UnixMilli(millis).UTC().Round(blob.ClockPrecision)
		tsid := blob.NewTSID(commentTime, []byte(fmt.Sprintf("comment-%d", blobID)))
		attrs := fmt.Sprintf(`{"tsid":%q}`, tsid.String())
		hash, err := multihash.Sum([]byte(fmt.Sprintf("comment-%d", blobID)), multihash.SHA2_256, -1)
		if err != nil {
			return err
		}
		if err := sqlitex.Exec(conn, `INSERT INTO blobs (id, multihash, codec, data, size, insert_time) VALUES (?, ?, ?, ?, 1, ?);`, nil, blobID, []byte(hash), int64(0x71), []byte{1}, blobID); err != nil {
			return err
		}
		if err := sqlitex.Exec(conn, `INSERT INTO structural_blobs (id, type, ts, author, resource, extra_attrs) VALUES (?, 'Comment', ?, 1, 1, ?);`, nil, blobID, commentTime.UnixMilli(), attrs); err != nil {
			return err
		}
		return sqlitex.Exec(conn, `INSERT INTO resource_links (source, target, type, is_pinned, extra_attrs) VALUES (?, 2, 'comment/Embed', 0, '{}');`, nil, blobID)
	}

	require.NoError(t, alice.db.WithTx(ctx, func(conn *sqlite.Conn) error {
		if err := sqlitex.Exec(conn, `INSERT INTO public_keys (id, principal) VALUES (1, ?);`, nil, []byte(author)); err != nil {
			return err
		}
		for i, millis := range []int64{6_000, 5_000, 4_000, 3_000} {
			id := int64(i + 1)
			if err := insertActivityProfileEvent(conn, id, id, author.String()+"/p"+strconv.FormatInt(id, 10), millis); err != nil {
				return err
			}
		}
		if err := mkComment(conn, 10, 2_000); err != nil {
			return err
		}
		return mkComment(conn, 11, 1_000)
	}))

	var gotMentions int
	var gotBlobs int
	var token string
	for range 10 {
		page, err := alice.ListEvents(ctx, &activity.ListEventsRequest{
			PageSize:        5,
			PageToken:       token,
			FilterEventType: []string{"Profile", "comment/Embed"},
		})
		require.NoError(t, err)
		for _, e := range page.Events {
			if e.GetNewBlob() != nil {
				gotBlobs++
			} else if e.GetNewMention() != nil {
				gotMentions++
			}
		}
		if page.NextPageToken == "" {
			break
		}
		token = page.NextPageToken
	}

	require.Equal(t, 4, gotBlobs, "all main events must be delivered")
	require.Equal(t, 2, gotMentions, "both mentions must be delivered even when truncation cuts the first page")
}

func TestListEventsObservedOrderDoesNotSkipWindowWhenOldMentionEntersPage(t *testing.T) {
	alice := newTestServer(t, "alice")
	ctx := context.Background()

	author, err := core.DecodePrincipal("z6Mkv1LjkRosErBhmqrkmb5sDxXNs6EzBDSD8ktywpYLLGuC")
	require.NoError(t, err)

	// Observed-order counterpart of
	// TestListEventsPaginationDoesNotSkipWindowWhenOldMentionEntersPage. Here
	// the pagination cursor is the blob id (not the structural ts), and
	// sortFeedEvents takes a different branch, so the coverage clamp must be
	// exercised in this ordering too. The old mention therefore needs the
	// *lowest* blob id (oldest in observed order): comment blob 1, seven
	// Profile blobs 2..8 (blobs 7 and 8 share a resource so dedup drops one).
	// The main scan (LIMIT 5) only reaches blob id 4, so without the clamp the
	// deduped page lets the comment's cursor (id 1) poison the token and skips
	// blobs 2 and 3 forever.
	commentTime := time.UnixMilli(500).UTC().Round(blob.ClockPrecision)
	commentTSID := blob.NewTSID(commentTime, []byte("old comment"))
	commentAttrs := fmt.Sprintf(`{"tsid":%q}`, commentTSID.String())
	commentHash, err := multihash.Sum([]byte("old comment"), multihash.SHA2_256, -1)
	require.NoError(t, err)

	require.NoError(t, alice.db.WithTx(ctx, func(conn *sqlite.Conn) error {
		if err := sqlitex.Exec(conn, `INSERT INTO public_keys (id, principal) VALUES (1, ?);`, nil, []byte(author)); err != nil {
			return err
		}
		if err := insertActivityProfileEvent(conn, 2, 2, author.String()+"/p2", 2_000); err != nil {
			return err
		}
		if err := insertActivityProfileEvent(conn, 3, 3, author.String()+"/p3", 3_000); err != nil {
			return err
		}
		if err := insertActivityProfileEvent(conn, 4, 4, author.String()+"/p4", 4_000); err != nil {
			return err
		}
		if err := insertActivityProfileEvent(conn, 5, 5, author.String()+"/p5", 5_000); err != nil {
			return err
		}
		if err := insertActivityProfileEvent(conn, 6, 6, author.String()+"/p6", 6_000); err != nil {
			return err
		}
		if err := insertActivityProfileEvent(conn, 7, 7, author.String()+"/p7", 7_000); err != nil {
			return err
		}
		// blob 8 shares resource 7 + ts with blob 7 so dedup drops one on page 1.
		if err := insertActivityProfileEventForResource(conn, 8, 7, 7_000); err != nil {
			return err
		}
		if err := sqlitex.Exec(conn, `INSERT INTO blobs (id, multihash, codec, data, size, insert_time) VALUES (1, ?, ?, ?, 1, 1);`, nil, []byte(commentHash), int64(0x71), []byte{1}); err != nil {
			return err
		}
		if err := sqlitex.Exec(conn, `INSERT INTO structural_blobs (id, type, ts, author, resource, extra_attrs) VALUES (1, 'Comment', ?, 1, 2, ?);`, nil, commentTime.UnixMilli(), commentAttrs); err != nil {
			return err
		}
		return sqlitex.Exec(conn, `INSERT INTO resource_links (source, target, type, is_pinned, extra_attrs) VALUES (1, 2, 'comment/Embed', 0, '{}');`, nil)
	}))

	var gotBlobIDs []int64
	var gotMention bool
	var token string
	for range 10 {
		page, err := alice.ListEvents(ctx, &activity.ListEventsRequest{
			PageSize:        5,
			PageToken:       token,
			FilterEventType: []string{"Profile", "comment/Embed"},
			Order:           activity.FeedOrder_FEED_ORDER_OBSERVED_TIME,
		})
		require.NoError(t, err)
		for _, e := range page.Events {
			if nb := e.GetNewBlob(); nb != nil {
				gotBlobIDs = append(gotBlobIDs, nb.GetBlobId())
			} else if e.GetNewMention() != nil {
				gotMention = true
			}
		}
		if page.NextPageToken == "" {
			break
		}
		token = page.NextPageToken
	}

	// blob 7 is dropped by dedup; every other Profile blob must survive
	// pagination, including the 2 and 3 the poisoned token used to skip.
	for _, id := range []int64{2, 3, 4, 5, 6} {
		require.Contains(t, gotBlobIDs, id, "blob %d must be delivered by pagination", id)
	}
	require.True(t, gotMention, "the old mention must eventually be delivered")
}

func TestListEventsEmitsNextTokenWhenClampEmptiesPage(t *testing.T) {
	alice := newTestServer(t, "alice")
	ctx := context.Background()

	author, err := core.DecodePrincipal("z6Mkv1LjkRosErBhmqrkmb5sDxXNs6EzBDSD8ktywpYLLGuC")
	require.NoError(t, err)

	// Regression guard for the empty-page dead-end: the main scan fills its
	// limit with 5 Profile events that all live on one resource, and a comment
	// mention marks that resource deleted, so the deleted/dedup filter wipes
	// every above-floor event. The only survivor is the deleted-marker comment
	// itself, which sits below the coverage floor and is therefore clamped —
	// emptying the page. Because the main fetch was full, more rows remain, so
	// ListEvents must still emit a next-page token instead of dead-ending; the
	// comment is then delivered on the following page.
	commentTime := time.UnixMilli(500).UTC().Round(blob.ClockPrecision)
	commentTSID := blob.NewTSID(commentTime, []byte("marker comment"))
	commentAttrs := fmt.Sprintf(`{"tsid":%q,"deleted":"1"}`, commentTSID.String())
	commentHash, err := multihash.Sum([]byte("marker comment"), multihash.SHA2_256, -1)
	require.NoError(t, err)

	require.NoError(t, alice.db.WithTx(ctx, func(conn *sqlite.Conn) error {
		if err := sqlitex.Exec(conn, `INSERT INTO public_keys (id, principal) VALUES (1, ?);`, nil, []byte(author)); err != nil {
			return err
		}
		// Five Profile events (blob ids 2..6) all on resource 100, distinct ts
		// so they do not dedup among themselves.
		if err := insertActivityProfileEvent(conn, 2, 100, author.String()+"/dead", 2_000); err != nil {
			return err
		}
		for i, millis := range []int64{3_000, 4_000, 5_000, 6_000} {
			if err := insertActivityProfileEventForResource(conn, int64(i+3), 100, millis); err != nil {
				return err
			}
		}
		// Comment mention (blob id 1) targets resource 100 and is flagged
		// deleted, so filterDeletedAndDedupEvents drops all five Profile events.
		if err := sqlitex.Exec(conn, `INSERT INTO blobs (id, multihash, codec, data, size, insert_time) VALUES (1, ?, ?, ?, 1, 1);`, nil, []byte(commentHash), int64(0x71), []byte{1}); err != nil {
			return err
		}
		if err := sqlitex.Exec(conn, `INSERT INTO structural_blobs (id, type, ts, author, resource, extra_attrs) VALUES (1, 'Comment', ?, 1, 100, ?);`, nil, commentTime.UnixMilli(), commentAttrs); err != nil {
			return err
		}
		return sqlitex.Exec(conn, `INSERT INTO resource_links (source, target, type, is_pinned, extra_attrs) VALUES (1, 100, 'comment/Embed', 0, '{}');`, nil)
	}))

	var gotMention bool
	var pages int
	var token string
	for range 10 {
		page, err := alice.ListEvents(ctx, &activity.ListEventsRequest{
			PageSize:        5,
			PageToken:       token,
			FilterEventType: []string{"Profile", "comment/Embed"},
			Order:           activity.FeedOrder_FEED_ORDER_OBSERVED_TIME,
		})
		require.NoError(t, err)
		pages++
		for _, e := range page.Events {
			if e.GetNewMention() != nil {
				gotMention = true
			}
		}
		if page.NextPageToken == "" {
			break
		}
		token = page.NextPageToken
	}

	require.True(t, gotMention,
		"the clamped comment must still be delivered: an emptied page must emit a token, not dead-end")
	require.Greater(t, pages, 1, "the first page is emptied by the clamp, so a second page must be requested")
}

func TestListEventsCommentMentionSourceDocumentUsesCommentTarget(t *testing.T) {
	alice := newTestServer(t, "alice")
	ctx := context.Background()

	author, err := core.DecodePrincipal("z6Mkv1LjkRosErBhmqrkmb5sDxXNs6EzBDSD8ktywpYLLGuC")
	require.NoError(t, err)
	mentioned, err := core.DecodePrincipal("z6Mkj6fUDHMAvGm1MRqtjrBH5vLX5gQnDYh2f74NRFfccbVt")
	require.NoError(t, err)

	sourceDocument := "hm://" + author.String() + "/project-plan"
	mentionedProfile := "hm://" + mentioned.String() + "/:profile"
	commentTime := time.UnixMilli(2_000).UTC().Round(blob.ClockPrecision)
	commentTSID := blob.NewTSID(commentTime, []byte("comment mentions profile"))
	commentAttrs := fmt.Sprintf(`{"tsid":%q}`, commentTSID.String())
	commentHash, err := multihash.Sum([]byte("comment mentions profile"), multihash.SHA2_256, -1)
	require.NoError(t, err)

	require.NoError(t, alice.db.WithTx(ctx, func(conn *sqlite.Conn) error {
		if err := sqlitex.Exec(conn, `INSERT INTO public_keys (id, principal) VALUES (1, ?), (2, ?);`, nil, []byte(author), []byte(mentioned)); err != nil {
			return err
		}
		if err := sqlitex.Exec(conn, `INSERT INTO resources (id, iri, owner, create_time) VALUES (1, ?, 1, 0), (2, ?, 2, 0);`, nil, sourceDocument, mentionedProfile); err != nil {
			return err
		}
		if err := sqlitex.Exec(conn, `INSERT INTO blobs (id, multihash, codec, data, size, insert_time) VALUES (10, ?, ?, ?, 1, 10);`, nil, []byte(commentHash), int64(0x71), []byte{1}); err != nil {
			return err
		}
		if err := sqlitex.Exec(conn, `INSERT INTO structural_blobs (id, type, ts, author, resource, extra_attrs) VALUES (10, 'Comment', ?, 1, 1, ?);`, nil, commentTime.UnixMilli(), commentAttrs); err != nil {
			return err
		}
		return sqlitex.Exec(conn, `INSERT INTO resource_links (source, target, type, is_pinned, extra_attrs) VALUES (10, 2, 'comment/Embed', 0, '{"a":"comment-block"}');`, nil)
	}))

	events, err := alice.ListEvents(ctx, &activity.ListEventsRequest{PageSize: 10})
	require.NoError(t, err)

	var mention = (*activity.Event)(nil)
	for _, event := range events.Events {
		if event.GetNewMention().GetSourceType() == "comment/Embed" {
			mention = event
			break
		}
	}
	require.NotNil(t, mention, "expected comment profile mention in unfiltered activity feed")
	require.Equal(t, sourceDocument, mention.GetNewMention().GetSourceDocument())
	require.Equal(t, mentionedProfile, mention.GetNewMention().GetTarget())
}

func TestListEventsCommentExtraAttrsContainsTarget(t *testing.T) {
	alice := newTestServer(t, "alice")
	ctx := context.Background()

	author, err := core.DecodePrincipal("z6Mkv1LjkRosErBhmqrkmb5sDxXNs6EzBDSD8ktywpYLLGuC")
	require.NoError(t, err)

	targetIRI := "hm://" + author.String() + "/doc/path"

	require.NoError(t, alice.db.WithTx(ctx, func(conn *sqlite.Conn) error {
		if err := sqlitex.Exec(conn, `INSERT INTO public_keys (id, principal) VALUES (1, ?);`, nil, []byte(author)); err != nil {
			return err
		}

		hash, err := multihash.Sum([]byte("comment-blob"), multihash.SHA2_256, -1)
		if err != nil {
			return err
		}
		if err := sqlitex.Exec(conn, `INSERT INTO blobs (id, multihash, codec, data, size, insert_time) VALUES (?, ?, ?, ?, ?, ?);`, nil, int64(1), []byte(hash), int64(0x55), []byte{1}, int64(1), int64(1)); err != nil {
			return err
		}

		if err := sqlitex.Exec(conn, `INSERT INTO resources (id, iri, owner, genesis_blob, create_time) VALUES (1, ?, 1, ?, 0);`, nil, targetIRI, int64(1)); err != nil {
			return err
		}
		if err := sqlitex.Exec(conn, `INSERT INTO document_generations (resource, generation, genesis, genesis_change_time) VALUES (1, 0, ?, 0);`, nil, targetIRI); err != nil {
			return err
		}

		ts := time.UnixMilli(1_700_000_000_000).Round(blob.ClockPrecision)
		tsid := blob.NewTSID(ts, []byte("comment"))
		extraAttrs := fmt.Sprintf(`{"tsid":%q}`, tsid.String())

		return sqlitex.Exec(conn, `INSERT INTO structural_blobs (id, type, ts, author, genesis_blob, resource, extra_attrs) VALUES (?, 'Comment', ?, 1, ?, 1, ?);`, nil, int64(1), ts.UnixMilli(), int64(1), extraAttrs)
	}))

	resp, err := alice.ListEvents(ctx, &activity.ListEventsRequest{
		PageSize:        10,
		FilterEventType: []string{"Comment"},
	})
	require.NoError(t, err)
	require.Len(t, resp.Events, 1)

	evt := resp.Events[0].GetNewBlob()

	// Resource should be the comment's own IRI, not the target.
	require.Contains(t, evt.GetResource(), "hm://"+author.String()+"/")

	// ExtraAttrs should contain the target document IRI.
	var attrs map[string]any
	require.NoError(t, json.Unmarshal([]byte(evt.GetExtraAttrs()), &attrs))
	require.Equal(t, targetIRI, attrs["target"])
}

func TestListEventsOrdersSameBlobMentionsByLinkID(t *testing.T) {
	alice := newTestServer(t, "alice")
	ctx := context.Background()

	author, err := core.DecodePrincipal("z6Mkv1LjkRosErBhmqrkmb5sDxXNs6EzBDSD8ktywpYLLGuC")
	require.NoError(t, err)

	sourceDocument := "hm://" + author.String() + "/project-plan"
	earlyTarget := "hm://" + author.String() + "/early-target"
	lateTarget := "hm://" + author.String() + "/late-target"
	commentTime := time.UnixMilli(2_000).UTC().Round(blob.ClockPrecision)
	commentTSID := blob.NewTSID(commentTime, []byte("comment mentions two docs"))
	commentAttrs := fmt.Sprintf(`{"tsid":%q}`, commentTSID.String())
	commentHash, err := multihash.Sum([]byte("comment mentions two docs"), multihash.SHA2_256, -1)
	require.NoError(t, err)

	require.NoError(t, alice.db.WithTx(ctx, func(conn *sqlite.Conn) error {
		if err := sqlitex.Exec(conn, `INSERT INTO public_keys (id, principal) VALUES (1, ?);`, nil, []byte(author)); err != nil {
			return err
		}
		if err := sqlitex.Exec(conn, `INSERT INTO blobs (id, multihash, codec, data, size, insert_time) VALUES (10, ?, ?, ?, 1, 10);`, nil, []byte(commentHash), int64(0x71), []byte{1}); err != nil {
			return err
		}
		if err := sqlitex.Exec(conn, `INSERT INTO resources (id, iri, owner, genesis_blob, create_time) VALUES (1, ?, 1, 10, 0), (2, ?, 1, NULL, 0), (3, ?, 1, NULL, 0);`, nil, sourceDocument, earlyTarget, lateTarget); err != nil {
			return err
		}
		if err := sqlitex.Exec(conn, `INSERT INTO structural_blobs (id, type, ts, author, resource, genesis_blob, extra_attrs) VALUES (10, 'Comment', ?, 1, 1, 10, ?);`, nil, commentTime.UnixMilli(), commentAttrs); err != nil {
			return err
		}
		if err := sqlitex.Exec(conn, `INSERT INTO resource_links (id, source, target, type, is_pinned, extra_attrs) VALUES (30, 10, 3, 'comment/Embed', 0, '{"a":"late-link"}');`, nil); err != nil {
			return err
		}
		return sqlitex.Exec(conn, `INSERT INTO resource_links (id, source, target, type, is_pinned, extra_attrs) VALUES (20, 10, 2, 'comment/Embed', 0, '{"a":"early-link"}');`, nil)
	}))

	events, err := alice.ListEvents(ctx, &activity.ListEventsRequest{
		PageSize:        10,
		FilterEventType: []string{"Comment", "comment/Embed"},
	})
	require.NoError(t, err)
	require.Len(t, events.Events, 3)
	require.NotNil(t, events.Events[0].GetNewBlob())
	require.Equal(t, earlyTarget, events.Events[1].GetNewMention().GetTarget())
	require.Equal(t, lateTarget, events.Events[2].GetNewMention().GetTarget())
}

func TestSortFeedEventsUsesSameBlobTieBreakers(t *testing.T) {
	events := []*activity.Event{
		{Data: &activity.Event_NewMention{NewMention: &entity_proto.Mention{Target: "hm://target-b"}}},
		{Data: &activity.Event_NewBlob{NewBlob: &activity.NewBlobEvent{Cid: "newer"}}},
		{Data: &activity.Event_NewBlob{NewBlob: &activity.NewBlobEvent{Cid: "same-blob"}}},
		{Data: &activity.Event_NewMention{NewMention: &entity_proto.Mention{Target: "hm://target-a"}}},
	}
	cursors := []feedCursor{
		{cursorValue: 10, blobID: 10, kind: feedCursorKindMention, linkID: 30, key: "target-b"},
		{cursorValue: 11, blobID: 11, kind: feedCursorKindBlob, key: "newer"},
		{cursorValue: 10, blobID: 10, kind: feedCursorKindBlob, key: "same-blob"},
		{cursorValue: 10, blobID: 10, kind: feedCursorKindMention, linkID: 20, key: "target-a"},
	}

	sortFeedEvents(events, cursors, true)

	var got []string
	for _, event := range events {
		if nb := event.GetNewBlob(); nb != nil {
			got = append(got, "blob:"+nb.GetCid())
			continue
		}
		got = append(got, "mention:"+event.GetNewMention().GetTarget())
	}
	require.Equal(t, []string{
		"blob:newer",
		"blob:same-blob",
		"mention:hm://target-a",
		"mention:hm://target-b",
	}, got)
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

func mkBlobEvent(resource, blobType, author string, evtMillis int64, blobID int64) (*activity.Event, feedCursor) {
	return &activity.Event{
			Data: &activity.Event_NewBlob{NewBlob: &activity.NewBlobEvent{
				Cid:      strconv.FormatInt(blobID, 10),
				BlobType: blobType,
				Author:   author,
				Resource: resource,
				BlobId:   blobID,
			}},
			Account:   author,
			EventTime: timestamppb.New(time.UnixMilli(evtMillis)),
		}, feedCursor{
			cursorValue: evtMillis,
			blobID:      blobID,
			kind:        feedCursorKindBlob,
			key:         strconv.FormatInt(blobID, 10),
		}
}

func mkMentionEvent(target, source, sourceType, author string, evtMillis, blobID int64) (*activity.Event, feedCursor) {
	return &activity.Event{
			Data: &activity.Event_NewMention{NewMention: &entity_proto.Mention{
				Source:     source,
				SourceType: sourceType,
				Target:     target,
			}},
			Account:   author,
			EventTime: timestamppb.New(time.UnixMilli(evtMillis)),
		}, feedCursor{
			cursorValue: evtMillis,
			blobID:      blobID,
			kind:        feedCursorKindMention,
			key:         target + "|" + source,
		}
}

func TestFilterDeletedAndDedupEvents_EmptyInputs(t *testing.T) {
	out, cursors := filterDeletedAndDedupEvents(nil, nil, nil, nil, false)
	require.Empty(t, out)
	require.Empty(t, cursors)
}

func TestFilterDeletedAndDedupEvents_FiltersExactDeletedTargets(t *testing.T) {
	e1, c1 := mkBlobEvent("hm://acc/keep", "Ref", "alice", 200, 1)
	e2, c2 := mkBlobEvent("hm://acc/drop", "Ref", "alice", 100, 2)
	out, cursors := filterDeletedAndDedupEvents(
		[]*activity.Event{e1, e2},
		[]feedCursor{c1, c2},
		[]string{"hm://acc/drop"},
		nil,
		false,
	)
	require.Len(t, out, 1)
	require.Equal(t, "hm://acc/keep", out[0].GetNewBlob().GetResource())
	require.Len(t, cursors, 1)
}

func TestFilterDeletedAndDedupEvents_SubstringMatchOnMovedResources(t *testing.T) {
	// A blob whose IRI contains the OldIri of a deleted moved resource is dropped;
	// a moved resource that's not flagged deleted is ignored.
	e1, c1 := mkBlobEvent("hm://acc/keep", "Ref", "alice", 300, 1)
	e2, c2 := mkBlobEvent("hm://acc/old-path/child", "Ref", "alice", 200, 2)
	moved := []entities.MovedResource{
		{OldIri: "hm://acc/old-path", NewIri: "hm://acc/new-path", IsDeleted: true},
		{OldIri: "hm://acc/other-old", NewIri: "hm://acc/other-new", IsDeleted: false},
	}
	out, _ := filterDeletedAndDedupEvents(
		[]*activity.Event{e1, e2},
		[]feedCursor{c1, c2},
		nil,
		moved,
		false,
	)
	require.Len(t, out, 1)
	require.Equal(t, "hm://acc/keep", out[0].GetNewBlob().GetResource())
}

func TestFilterDeletedAndDedupEvents_DedupesBlobsByKey(t *testing.T) {
	// Same (Resource, BlobType, Account, EventTime) collapses; different event time survives.
	e1, c1 := mkBlobEvent("hm://acc/r", "Ref", "alice", 100, 1)
	e2, c2 := mkBlobEvent("hm://acc/r", "Ref", "alice", 100, 2)
	e3, c3 := mkBlobEvent("hm://acc/r", "Ref", "alice", 200, 3)
	out, cursors := filterDeletedAndDedupEvents(
		[]*activity.Event{e1, e2, e3},
		[]feedCursor{c1, c2, c3},
		nil,
		nil,
		false,
	)
	require.Len(t, out, 2)
	require.Len(t, cursors, 2)
}

func TestFilterDeletedAndDedupEvents_DedupesMentionsByGroupKey(t *testing.T) {
	// Two mentions identical on (Target, TargetVersion, TargetFragment, Source)
	// collapse via the seenMentionGroup path even when Account / EventTime differ.
	share := func() *activity.Event {
		return &activity.Event{
			Data: &activity.Event_NewMention{NewMention: &entity_proto.Mention{
				Target:         "hm://acc/target",
				TargetVersion:  "v1",
				TargetFragment: "f",
				Source:         "hm://acc/source",
				SourceType:     "doc/link",
			}},
			Account:   "alice",
			EventTime: timestamppb.New(time.UnixMilli(100)),
		}
	}
	e1 := share()
	e2 := share()
	e2.Account = "bob"
	e2.EventTime = timestamppb.New(time.UnixMilli(200))
	c1 := feedCursor{cursorValue: 200, blobID: 1, kind: feedCursorKindMention}
	c2 := feedCursor{cursorValue: 100, blobID: 2, kind: feedCursorKindMention}
	out, _ := filterDeletedAndDedupEvents(
		[]*activity.Event{e1, e2},
		[]feedCursor{c1, c2},
		nil,
		nil,
		true,
	)
	require.Len(t, out, 1)
}

func TestFilterDeletedAndDedupEvents_PreservesUnknownEventTypes(t *testing.T) {
	bare := &activity.Event{Account: "carol", EventTime: timestamppb.New(time.UnixMilli(50))}
	c := feedCursor{cursorValue: 50, blobID: 99, kind: feedCursorKindBlob}
	out, _ := filterDeletedAndDedupEvents(
		[]*activity.Event{bare},
		[]feedCursor{c},
		[]string{"hm://acc/something"},
		nil,
		false,
	)
	require.Len(t, out, 1)
	require.Same(t, bare, out[0])
}

// filterDeletedAndDedupEventsLegacy is the pre-refactor algorithm preserved
// here for benchmark comparison only. Do not call from production code.
//
//nolint:gocyclo // mirrors the old inline code; complexity is intentional.
func filterDeletedAndDedupEventsLegacy(
	events []*activity.Event,
	cursors []feedCursor,
	deletedList []string,
	movedResources []entities.MovedResource,
	orderByObserved bool,
) ([]*activity.Event, []feedCursor) {
	for _, movedResource := range movedResources {
		for _, e := range events {
			if _, ok := e.Data.(*activity.Event_NewMention); ok {
				if strings.Contains(e.Data.(*activity.Event_NewMention).NewMention.Source, movedResource.OldIri) {
					if movedResource.IsDeleted {
						deletedList = append(deletedList, e.Data.(*activity.Event_NewMention).NewMention.Source)
					}
				}
				continue
			}
			if _, ok := e.Data.(*activity.Event_NewBlob); !ok {
				continue
			}
			if strings.Contains(e.Data.(*activity.Event_NewBlob).NewBlob.Resource, movedResource.OldIri) {
				if movedResource.IsDeleted {
					deletedList = append(deletedList, e.Data.(*activity.Event_NewBlob).NewBlob.Resource)
				}
			}
		}
	}

	nonDeleted := make([]*activity.Event, 0, len(events))
	nonDeletedCursors := make([]feedCursor, 0, len(cursors))
	for i, e := range events {
		if _, ok := e.Data.(*activity.Event_NewMention); ok {
			if !slices.Contains(deletedList, e.Data.(*activity.Event_NewMention).NewMention.Source) {
				nonDeleted = append(nonDeleted, e)
				nonDeletedCursors = append(nonDeletedCursors, cursors[i])
			}
			continue
		}
		if _, ok := e.Data.(*activity.Event_NewBlob); !ok {
			nonDeleted = append(nonDeleted, e)
			nonDeletedCursors = append(nonDeletedCursors, cursors[i])
			continue
		}
		if !slices.Contains(deletedList, e.Data.(*activity.Event_NewBlob).NewBlob.Resource) {
			nonDeleted = append(nonDeleted, e)
			nonDeletedCursors = append(nonDeletedCursors, cursors[i])
		}
	}

	sortFeedEvents(nonDeleted, nonDeletedCursors, orderByObserved)

	seen := make(map[string]struct{})
	seenMentionGroup := make(map[string]struct{})
	for i := 0; i < len(nonDeleted); i++ {
		e := nonDeleted[i]
		if _, ok := e.Data.(*activity.Event_NewMention); ok {
			m := e.Data.(*activity.Event_NewMention).NewMention
			groupKey := m.Target + "\x00" + m.TargetVersion + "\x00" + m.TargetFragment + "\x00" + m.Source
			if _, ok := seenMentionGroup[groupKey]; ok {
				nonDeleted = append(nonDeleted[:i], nonDeleted[i+1:]...)
				nonDeletedCursors = append(nonDeletedCursors[:i], nonDeletedCursors[i+1:]...)
				i--
				continue
			}
			seenMentionGroup[groupKey] = struct{}{}
			key := fmt.Sprintf("%s:%s:%s:%d", m.Target, m.SourceType, e.Account, e.EventTime.AsTime().UnixNano())
			if _, ok := seen[key]; ok {
				nonDeleted = append(nonDeleted[:i], nonDeleted[i+1:]...)
				nonDeletedCursors = append(nonDeletedCursors[:i], nonDeletedCursors[i+1:]...)
				i--
			} else {
				seen[key] = struct{}{}
			}
			continue
		}
		if _, ok := e.Data.(*activity.Event_NewBlob); ok {
			key := fmt.Sprintf("%s:%s:%s:%d",
				e.Data.(*activity.Event_NewBlob).NewBlob.Resource,
				e.Data.(*activity.Event_NewBlob).NewBlob.BlobType,
				e.Account,
				e.EventTime.AsTime().UnixNano())
			if _, ok := seen[key]; ok {
				nonDeleted = append(nonDeleted[:i], nonDeleted[i+1:]...)
				nonDeletedCursors = append(nonDeletedCursors[:i], nonDeletedCursors[i+1:]...)
				i--
			} else {
				seen[key] = struct{}{}
			}
			continue
		}
	}
	return nonDeleted, nonDeletedCursors
}

func BenchmarkFilterDeletedAndDedupEventsLegacy(b *testing.B) {
	events, cursors, deletedTargets, moved := bench_filterDedupFixtures()
	b.ReportAllocs()
	for b.Loop() {
		eventsCopy := make([]*activity.Event, len(events))
		copy(eventsCopy, events)
		cursorsCopy := make([]feedCursor, len(cursors))
		copy(cursorsCopy, cursors)
		filterDeletedAndDedupEventsLegacy(eventsCopy, cursorsCopy, deletedTargets, moved, false)
	}
}

func bench_filterDedupFixtures() ([]*activity.Event, []feedCursor, []string, []entities.MovedResource) {
	const (
		nEvents         = 500
		duplicateStride = 4
		nDeletedTargets = 10
		nMovedResources = 4
	)
	events := make([]*activity.Event, nEvents)
	cursors := make([]feedCursor, nEvents)
	for i := range nEvents {
		evtMillis := int64(1_000_000 + (i / duplicateStride))
		resource := "hm://acc/res-" + strconv.Itoa(i%(nEvents/duplicateStride))
		if i%2 == 0 {
			events[i], cursors[i] = mkBlobEvent(resource, "Ref", "alice", evtMillis, int64(i+1))
		} else {
			events[i], cursors[i] = mkMentionEvent(resource, resource+"#src", "doc/link", "alice", evtMillis, int64(i+1))
		}
	}
	deletedTargets := make([]string, nDeletedTargets)
	for i := range deletedTargets {
		deletedTargets[i] = "hm://acc/res-" + strconv.Itoa(i)
	}
	moved := make([]entities.MovedResource, nMovedResources)
	for i := range moved {
		moved[i] = entities.MovedResource{
			OldIri:    "hm://acc/moved-" + strconv.Itoa(i),
			NewIri:    "hm://acc/moved-new-" + strconv.Itoa(i),
			IsDeleted: i%2 == 0,
		}
	}
	return events, cursors, deletedTargets, moved
}

func BenchmarkFilterDeletedAndDedupEvents(b *testing.B) {
	const (
		nEvents         = 500
		duplicateStride = 4
		nDeletedTargets = 10
		nMovedResources = 4
	)
	events := make([]*activity.Event, nEvents)
	cursors := make([]feedCursor, nEvents)
	for i := range nEvents {
		evtMillis := int64(1_000_000 + (i / duplicateStride))
		resource := "hm://acc/res-" + strconv.Itoa(i%(nEvents/duplicateStride))
		if i%2 == 0 {
			events[i], cursors[i] = mkBlobEvent(resource, "Ref", "alice", evtMillis, int64(i+1))
		} else {
			events[i], cursors[i] = mkMentionEvent(resource, resource+"#src", "doc/link", "alice", evtMillis, int64(i+1))
		}
	}
	deletedTargets := make([]string, nDeletedTargets)
	for i := range deletedTargets {
		deletedTargets[i] = "hm://acc/res-" + strconv.Itoa(i)
	}
	moved := make([]entities.MovedResource, nMovedResources)
	for i := range moved {
		moved[i] = entities.MovedResource{
			OldIri:    "hm://acc/moved-" + strconv.Itoa(i),
			NewIri:    "hm://acc/moved-new-" + strconv.Itoa(i),
			IsDeleted: i%2 == 0,
		}
	}

	b.ReportAllocs()
	for b.Loop() {
		eventsCopy := make([]*activity.Event, len(events))
		copy(eventsCopy, events)
		cursorsCopy := make([]feedCursor, len(cursors))
		copy(cursorsCopy, cursors)
		filterDeletedAndDedupEvents(eventsCopy, cursorsCopy, deletedTargets, moved, false)
	}
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
