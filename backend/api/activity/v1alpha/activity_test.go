package activity

import (
	context "context"
	activity "seed/backend/genproto/activity/v1alpha"
	"seed/backend/storage"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestListEvents(t *testing.T) {
	alice := newTestServer(t, "alice")
	ctx := context.Background()

	req := &activity.ListEventsRequest{
		PageSize:  5,
		PageToken: "",
	}
	events, err := alice.ListEvents(ctx, req)
	require.NoError(t, err)
	require.NotNil(t, events)
	require.Len(t, events.Events, 0)
}

// TODO: update profile idempotent no change

func newTestServer(t *testing.T, name string) *Server {
	db := storage.MakeTestDB(t)
	return NewServer(db)
}
