package wallet

import (
	"context"
	"seed/backend/blob"
	"seed/backend/config"
	"seed/backend/core"
	"seed/backend/core/coretest"
	"seed/backend/lndhub"
	"seed/backend/lndhub/lndhubsql"
	"seed/backend/logging"
	"seed/backend/mttnet"
	"seed/backend/storage"
	"seed/backend/testutil"
	"seed/backend/util/future"
	"seed/backend/wallet/walletsql"
	"testing"
	"time"

	"seed/backend/util/sqlite/sqlitex"

	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
)

func TestModifyWallets(t *testing.T) {
	testutil.Manual(t)
	var err error
	var defaultWallet walletsql.Wallet
	ctx := context.Background()
	alice := makeTestService(t, "alice")
	aliceAcc, err := alice.net.AccountForDevice(ctx, alice.net.AddrInfo().ID)
	uri, err := alice.ExportWallet(ctx, "")
	require.NoError(t, err)
	seedWallet, err := alice.InsertWallet(ctx, uri, "default", aliceAcc.String())
	require.Error(t, err, "We must register the account first.")

	require.Eventually(t, func() bool { defaultWallet, err = alice.GetDefaultWallet(ctx); return err == nil }, 7*time.Second, 2*time.Second)
	require.Equal(t, seedWallet, defaultWallet)
	require.Eventually(t, func() bool {
		conn, release, err := alice.pool.Conn(ctx)
		require.NoError(t, err)
		defer release()
		_, err = lndhubsql.GetToken(conn, defaultWallet.ID)
		return err == nil
	}, 3*time.Second, 1*time.Second)
	require.EqualValues(t, lndhubsql.LndhubGoWalletType, defaultWallet.Type)
	err = alice.DeleteWallet(ctx, defaultWallet.ID)
	require.Error(t, err)
	const newName = "new wallet name"
	_, err = alice.UpdateWalletName(ctx, defaultWallet.ID, newName)
	require.NoError(t, err)

	wallets, err := alice.ListWallets(ctx, true)
	require.NoError(t, err)
	require.EqualValues(t, 1, len(wallets))
	require.EqualValues(t, newName, wallets[0].Name)
}

func TestRequestLndHubInvoice(t *testing.T) {
	testutil.Manual(t)
	ctx := context.Background()
	var err error
	alice := makeTestService(t, "alice")
	aliceAcc, err := alice.net.AccountForDevice(ctx, alice.net.AddrInfo().ID)
	aliceURI, err := alice.ExportWallet(ctx, "")

	bob := makeTestService(t, "bob")
	bobAcc, err := bob.net.AccountForDevice(ctx, bob.net.AddrInfo().ID)
	require.NoError(t, err)
	_, err = alice.InsertWallet(ctx, aliceURI, "default", aliceAcc.String())
	require.NoError(t, err)
	bobURI, err := bob.ExportWallet(ctx, "")
	require.NoError(t, err)
	_, err = bob.InsertWallet(ctx, bobURI, "default", bobAcc.String())
	require.NoError(t, err)

	var amt uint64 = 23
	var wrongAmt uint64 = 24
	var memo = "test invoice"

	var payreq string
	var defaultWallet walletsql.Wallet
	require.Eventually(t, func() bool { defaultWallet, err = bob.GetDefaultWallet(ctx); return err == nil }, 7*time.Second, 3*time.Second)
	require.Eventually(t, func() bool {
		conn, release, err := bob.pool.Conn(ctx)
		require.NoError(t, err)
		defer release()
		_, err = lndhubsql.GetToken(conn, defaultWallet.ID)
		return err == nil
	}, 3*time.Second, 1*time.Second)
	require.Eventually(t, func() bool {
		payreq, err = alice.RequestRemoteInvoice(ctx, bobAcc.String(), int64(amt), &memo)
		return err == nil
	}, 8*time.Second, 2*time.Second)
	invoice, err := lndhub.DecodeInvoice(payreq)
	require.NoError(t, err)
	require.EqualValues(t, amt, invoice.MilliSat.ToSatoshis())
	require.EqualValues(t, memo, *invoice.Description)
	_, err = alice.PayInvoice(ctx, payreq, nil, &wrongAmt)
	require.ErrorIs(t, err, lndhubsql.ErrQtyMissmatch)
	_, err = alice.PayInvoice(ctx, payreq, nil, &amt)
	require.ErrorIs(t, err, lndhubsql.ErrNotEnoughBalance)
}

func TestRequestP2PInvoice(t *testing.T) {
	testutil.Manual(t)

	alice := makeTestService(t, "alice")
	bob := makeTestService(t, "bob")
	ctx := context.Background()

	bobAccount, err := bob.net.AccountForDevice(ctx, bob.net.AddrInfo().ID)
	require.NoError(t, err)
	require.NoError(t, alice.net.Connect(ctx, bob.net.AddrInfo()))

	var amt uint64 = 23
	var wrongAmt uint64 = 24
	var memo = "test invoice"
	var payreq string
	require.Eventually(t, func() bool {
		payreq, err = alice.RequestRemoteInvoice(ctx, bobAccount.String(), int64(amt), &memo)
		return err == nil
	}, 8*time.Second, 2*time.Second)
	invoice, err := lndhub.DecodeInvoice(payreq)
	require.NoError(t, err)
	require.EqualValues(t, amt, invoice.MilliSat.ToSatoshis())
	require.EqualValues(t, memo, *invoice.Description)
	_, err = alice.PayInvoice(ctx, payreq, nil, &wrongAmt)
	require.ErrorIs(t, err, lndhubsql.ErrQtyMissmatch)
	_, err = alice.PayInvoice(ctx, payreq, nil, &amt)
	require.ErrorIs(t, err, lndhubsql.ErrNotEnoughBalance)
}

func makeTestService(t *testing.T, name string) *Service {
	u := coretest.NewTester(name)
	db := storage.MakeTestMemoryDB(t)
	device := u.Device
	ks := core.NewMemoryKeyStore()

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
	ctx, cancel := context.WithCancel(context.Background())

	t.Cleanup(cancel)

	srv := New(ctx, logging.New("seed/wallet", "debug"), db, node, false)

	return srv
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
