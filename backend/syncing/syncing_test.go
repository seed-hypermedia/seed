package syncing

import (
	"testing"
)

func TestSync(t *testing.T) {
	t.Skip("TODO(hm24): include back when delegations substitutes and changes are implemented")
	/*
	   t.Parallel()

	   alice := makeTestNode(t, "alice")
	   bob := makeTestNode(t, "bob")
	   ctx := context.Background()

	   require.NoError(t, alice.Connect(ctx, bob.AddrInfo()))

	   entity := hyper.NewEntity("foo")

	   	blob, err := entity.CreateChange(entity.NextTimestamp(), alice.Account, getDelegation(ctx, alice.Device, alice.Blobs), map[string]any{
	   		"name": "alice",
	   	})

	   require.NoError(t, err)
	   require.NoError(t, alice.Blobs.SaveBlob(ctx, blob))

	   res, err := bob.Syncer.SyncAll(ctx)
	   require.NoError(t, err)
	   require.Equalf(t, int64(0), res.NumSyncFailed, "unexpected number of sync failures: %v", res.Errs)
	   require.Equal(t, int64(1), res.NumSyncOK, "unexpected number of successful syncs")

	   	{
	   		blk, err := bob.Blobs.IPFSBlockstoreReader().Get(ctx, blob.CID)
	   		require.NoError(t, err)

	   		require.Equal(t, blob.Data, blk.RawData(), "bob must sync alice's change intact")
	   	}
	*/
}
