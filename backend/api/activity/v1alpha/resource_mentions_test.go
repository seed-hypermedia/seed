package activity

import (
	"encoding/json"
	"fmt"
	"seed/backend/core"
	activity "seed/backend/genproto/activity/v1alpha"
	"seed/backend/storage"
	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"
	"testing"

	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/proto"
)

func TestListEventsResourceQueryShapesPreservePagination(t *testing.T) {
	const author = "z6Mkv1LjkRosErBhmqrkmb5sDxXNs6EzBDSD8ktywpYLLGuC"

	principal, err := core.DecodePrincipal(author)
	require.NoError(t, err)
	srv := newTestServer(t, "resource-query-shapes")
	ctx := t.Context()
	require.NoError(t, srv.db.WithTx(ctx, func(conn *sqlite.Conn) error {
		if err := sqlitex.Exec(conn, `INSERT INTO public_keys (id, principal) VALUES (1, ?);`, nil, []byte(principal)); err != nil {
			return err
		}

		for id := int64(1); id <= 24; id++ {
			if err := insertActivityProfileEvent(conn, id, id, fmt.Sprintf("%s/doc%d", author, id), 1000+(id/3)*100); err != nil {
				return err
			}
		}

		for id := int64(1); id <= 24; id++ {
			for offset := int64(0); offset < 2; offset++ {
				if err := sqlitex.Exec(conn, `INSERT INTO resource_links (source, target, type, is_pinned, extra_attrs) VALUES (?, ?, 'doc/Link', ?, '{}');`, nil, id, (id+offset)%24+1, offset); err != nil {
					return err
				}
			}
		}

		return sqlitex.Exec(conn, `INSERT INTO resources (id, iri, owner) VALUES (999, ?, 1);`, nil, "hm://"+author+"/outside")
	}))
	conn, release, err := srv.db.ReadConn(ctx)
	require.NoError(t, err)
	var targets []int

	for id := 1; id <= 24; id++ {
		targets = append(targets, id)
	}

	encodedTargets, err := json.Marshal(targets)
	require.NoError(t, err)
	broad, err := useSourceOrderedMentions(conn, string(encodedTargets), 7)
	require.NoError(t, err)
	require.True(t, broad)
	selective, err := useSourceOrderedMentions(conn, "[1]", 1)
	require.NoError(t, err)
	require.False(t, selective)
	release()

	for _, order := range []activity.FeedOrder{activity.FeedOrder_FEED_ORDER_CLAIMED_TIME, activity.FeedOrder_FEED_ORDER_OBSERVED_TIME} {
		for _, pageSize := range []int32{1, 5, 7} {
			for _, filter := range []string{"hm://" + author + "/doc*", "hm://" + author + "/doc1", "hm://" + author + "/missing"} {
				t.Run(fmt.Sprintf("%s/%d/%s", order, pageSize, filter), func(t *testing.T) {
					readPages := func() []*activity.ListEventsResponse {
						var pages []*activity.ListEventsResponse

						req := &activity.ListEventsRequest{PageSize: pageSize, Order: order, FilterResource: filter}
						for {
							page, err := srv.ListEvents(ctx, req)
							require.NoError(t, err)
							pages = append(pages, page)
							require.Less(t, len(pages), 100)

							if page.NextPageToken == "" {
								return pages
							}

							require.NotEqual(t, req.PageToken, page.NextPageToken)
							req.PageToken = page.NextPageToken
						}
					}
					got := readPages()
					// A high unrelated link ID raises the total estimate without
					// changing the filtered rows, forcing the legacy target-first path.
					require.NoError(t, srv.db.WithTx(ctx, func(conn *sqlite.Conn) error {
						return sqlitex.Exec(conn, `INSERT INTO resource_links (id, source, target, type) VALUES (1000000, 1, 999, 'doc/Link');`, nil)
					}))
					want := readPages()
					require.NoError(t, srv.db.WithTx(ctx, func(conn *sqlite.Conn) error {
						return sqlitex.Exec(conn, `DELETE FROM resource_links WHERE id = 1000000;`, nil)
					}))
					require.Len(t, got, len(want))
					for i := range want {
						require.True(t, proto.Equal(want[i], got[i]), "page %d: want %v, got %v", i, want[i], got[i])
					}
				})
			}
		}
	}
}

func TestUseSourceOrderedMentions(t *testing.T) {
	db := storage.MakeTestDB(t)
	conn, release, err := db.ReadConn(t.Context())
	require.NoError(t, err)
	defer release()
	got, err := useSourceOrderedMentions(conn, "[]", 30)
	require.NoError(t, err)
	require.False(t, got)
	_, err = useSourceOrderedMentions(conn, "invalid json", 30)
	require.Error(t, err)
}
