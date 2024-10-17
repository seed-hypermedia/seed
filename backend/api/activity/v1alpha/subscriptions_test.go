package activity

import (
	context "context"
	activity "seed/backend/genproto/activity/v1alpha"
	"seed/backend/syncing"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestListSubscriptions(t *testing.T) {
	alice := newTestServer(t, "alice")
	alice.SetSyncer(&helper{})
	ctx := context.Background()

	req := &activity.ListSubscriptionsRequest{
		PageSize:  5,
		PageToken: "",
	}
	res, err := alice.ListSubscriptions(ctx, req)
	require.NoError(t, err)
	require.NotNil(t, res)
	require.Len(t, res.Subscriptions, 0)
	_, err = alice.Subscribe(ctx, &activity.SubscribeRequest{
		Account:   "fake_acc",
		Recursive: false,
	})
	require.Error(t, err)
}

type helper struct{}

func (h *helper) SyncSubscribedContent(ctx context.Context, _ ...*activity.Subscription) (syncing.SyncResult, error) {
	return syncing.SyncResult{}, nil
}
