package activity

import (
	context "context"
	activity "seed/backend/genproto/activity/v1alpha"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestListSubscriptions(t *testing.T) {
	alice := newTestServer(t, "alice")
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
