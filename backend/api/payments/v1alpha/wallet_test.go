package payments

import (
	"context"
	"seed/backend/blob"
	"seed/backend/config"
	"seed/backend/core"
	"seed/backend/core/coretest"
	payments "seed/backend/genproto/payments/v1alpha"
	"seed/backend/lndhub/lndhubsql"
	"seed/backend/logging"
	"seed/backend/mttnet"
	"seed/backend/storage"
	"seed/backend/testutil"
	"seed/backend/util/future"
	"testing"
	"time"

	"seed/backend/util/sqlite/sqlitex"

	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
)

func TestModifyWallets(t *testing.T) {
	testutil.Manual(t)
	ctx := context.Background()
	alice := makeTestService(t, "alice")
	aliceAccs, err := alice.ks.ListKeys(ctx)
	require.NoError(t, err)
	require.Len(t, aliceAccs, 1)
	alicePk := aliceAccs[0].PublicKey.String()
	require.NoError(t, err)
	seedWallet, err := alice.CreateWallet(ctx, &payments.CreateWalletRequest{
		Account: alicePk,
		Name:    "myWallet",
	})
	require.NoError(t, err)
	defaultWallet, err := alice.GetDefaultWallet(ctx, &payments.GetDefaultWalletRequest{Account: seedWallet.Account})
	require.NoError(t, err)
	require.Equal(t, seedWallet, defaultWallet)
	require.Eventually(t, func() bool {
		conn, release, err := alice.pool.Conn(ctx)
		require.NoError(t, err)
		defer release()
		_, err = lndhubsql.GetToken(conn, defaultWallet.Id)
		return err == nil
	}, 3*time.Second, 1*time.Second)
	require.EqualValues(t, lndhubsql.LndhubGoWalletType, defaultWallet.Type)
	_, err = alice.RemoveWallet(ctx, &payments.WalletRequest{Id: defaultWallet.Id})
	require.Error(t, err)
	const newName = "new wallet name"
	_, err = alice.UpdateWalletName(ctx, &payments.UpdateWalletNameRequest{Id: defaultWallet.Id, Name: newName})
	require.NoError(t, err)

	wallets, err := alice.ListWallets(ctx, &payments.ListWalletsRequest{Account: seedWallet.Account})
	require.NoError(t, err)
	require.EqualValues(t, 1, len(wallets.Wallets))
	require.EqualValues(t, newName, wallets.Wallets[0].Name)
}

func makeTestService(t *testing.T, name string) *Server {
	ctx, cancel := context.WithCancel(context.Background())
	u := coretest.NewTester(name)
	db := storage.MakeTestMemoryDB(t)
	device := u.Device
	ks := core.NewMemoryKeyStore()
	require.NoError(t, ks.StoreKey(ctx, device.Principal().String(), device))
	node, closenode := makeTestPeer(t, u, device, ks, db)
	t.Cleanup(closenode)
	/*
		conn, release, err := db.Conn(context.Background())
		require.NoError(t, err)
		defer release()

		signature, err := u.Account.Sign([]byte(lndhub.SigningMessage))
		require.NoError(t, err)

		require.NoError(t, lndhubsql.SetLoginSignature(conn, hex.EncodeToString(signature)))
	*/

	t.Cleanup(cancel)

	return NewServer(logging.New("seed/wallet", "debug"), db, node, ks, false)
}

func makeTestPeer(t *testing.T, u coretest.Tester, device core.KeyPair, ks core.KeyStore, db *sqlitex.Pool) (*mttnet.Node, context.CancelFunc) {
	idx := blob.NewIndex(db, logging.New("seed/hyper", "debug"), nil)

	n, err := mttnet.New(config.P2P{
		NoRelay:        true,
		BootstrapPeers: nil,
		NoMetrics:      true,
	}, device, ks, db, idx, zap.NewNop())
	require.NoError(t, err)

	errc := make(chan error, 1)
	ctx, cancel := context.WithCancel(context.Background())
	f := future.New[*mttnet.Node]()
	require.NoError(t, f.Resolve(n))
	go func() {
		errc <- n.Start(ctx)
	}()

	t.Cleanup(func() {
		require.NoError(t, <-errc)
	})

	select {
	case <-n.Ready():
	case err := <-errc:
		require.NoError(t, err)
	}

	return n, cancel
}
