package activity

import (
	context "context"
	activity "seed/backend/genproto/activity/v1alpha"
	"seed/backend/logging"
	"seed/backend/storage"
	"seed/backend/util/cleanup"
	"testing"

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

// TODO: update profile idempotent no change

func newTestServer(t *testing.T, name string) *Server {
	db := storage.MakeTestDB(t)
	var clean cleanup.Stack
	return NewServer(db, logging.New("seed/Activity", "debug"), &clean, nil)
}
