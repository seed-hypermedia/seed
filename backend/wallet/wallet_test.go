package wallet

import (
	"context"
	"encoding/hex"
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

var testMnemonic = []string{"satisfy", "quit", "charge", "arrest", "prevent", "credit", "wreck", "amount", "swim", "snow", "system", "cluster", "skull", "slight", "dismiss"}
var testMnemonic2 = []string{"hill", "february", "mule", "horse", "rose", "ten", "abandon", "antenna", "soup", "artist", "nerve", "secret"}

func TestModifyWallets(t *testing.T) {
	testutil.Manual(t)
	var err error
	var defaultWallet walletsql.Wallet
	ctx := context.Background()
	alice := makeTestService(t, "alice")
	seedWallet, err := alice.CreateWallet(ctx, testMnemonic, "", "myWallet")
	require.NoError(t, err)
	defaultWallet, err = alice.GetDefaultWallet(ctx, seedWallet.Account)
	require.NoError(t, err)
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

	wallets, err := alice.ListWallets(ctx, seedWallet.Account, true)
	require.NoError(t, err)
	require.EqualValues(t, 1, len(wallets))
	require.EqualValues(t, newName, wallets[0].Name)
}

func TestRequestLndHubInvoice(t *testing.T) {
	testutil.Manual(t)
	ctx := context.Background()
	alice := makeTestService(t, "alice")
	bob := makeTestService(t, "bob")
	bobKp, err := core.AccountFromMnemonic(testMnemonic2, "")
	bobAcc := bobKp.Principal().String()
	require.NoError(t, err)
	alicesWallet, err := alice.CreateWallet(ctx, testMnemonic, "", "myWallet")
	require.NoError(t, err)
	defaultWallet, err := alice.GetDefaultWallet(ctx, alicesWallet.Account)
	require.NoError(t, err)
	require.Equal(t, alicesWallet, defaultWallet)
	_, err = alice.ExportWallet(ctx, alicesWallet.ID)
	require.NoError(t, err)

	login, err := bobKp.Sign([]byte(lndhub.SigningMessage))
	require.NoError(t, err)

	uri := "lndhub.go://" + bobAcc + ":" + hex.EncodeToString(login) + "@https://ln.testnet.mintter.com"
	bobsWallet, err := bob.InsertWallet(ctx, uri, "default", bobAcc)
	require.NoError(t, err)

	var amt uint64 = 23
	var wrongAmt uint64 = 24
	var memo = "test invoice"

	var payreq string

	defaultWallet, err = bob.GetDefaultWallet(ctx, bobAcc)
	require.NoError(t, err)
	require.Equal(t, bobsWallet, defaultWallet)
	require.Eventually(t, func() bool {
		conn, release, err := bob.pool.Conn(ctx)
		require.NoError(t, err)
		defer release()
		_, err = lndhubsql.GetToken(conn, defaultWallet.ID)
		return err == nil
	}, 3*time.Second, 1*time.Second)

	require.Eventually(t, func() bool {
		payreq, err = alice.RequestLud6Invoice(ctx, bobsWallet.Address, bobAcc, int64(amt), &memo)
		return err == nil
	}, 8*time.Second, 2*time.Second)
	invoice, err := lndhub.DecodeInvoice(payreq)
	require.NoError(t, err)
	require.EqualValues(t, amt, invoice.MilliSat.ToSatoshis())
	require.EqualValues(t, memo, *invoice.Description)
	_, err = alice.PayInvoice(ctx, alicesWallet.Account, payreq, nil, &wrongAmt)
	require.ErrorIs(t, err, lndhubsql.ErrQtyMissmatch)
	_, err = alice.PayInvoice(ctx, alicesWallet.Account, payreq, nil, &amt)
	require.ErrorIs(t, err, lndhubsql.ErrNotEnoughBalance)
}

func TestRequestP2PInvoice(t *testing.T) {
	t.Skip("Not implemented, as we don't have contacts (PID->Account) yet")
	testutil.Manual(t)

	alice := makeTestService(t, "alice")
	bob := makeTestService(t, "bob")
	ctx := context.Background()
	aliceAcc, err := alice.net.GetAccountByKeyName(ctx, "main")
	bobAccount, err := bob.net.GetAccountByKeyName(ctx, "main")
	require.NoError(t, err)
	require.NoError(t, alice.net.Connect(ctx, bob.net.AddrInfo()))
	defaultWallet, err := bob.GetDefaultWallet(ctx, bobAccount.String())
	require.NoError(t, err)

	var amt uint64 = 23
	var wrongAmt uint64 = 24
	var memo = "test invoice"
	var payreq string
	require.Eventually(t, func() bool {
		payreq, err = alice.RequestLud6Invoice(ctx, defaultWallet.Address, bobAccount.String(), int64(amt), &memo)
		return err == nil
	}, 8*time.Second, 2*time.Second)
	invoice, err := lndhub.DecodeInvoice(payreq)
	require.NoError(t, err)
	require.EqualValues(t, amt, invoice.MilliSat.ToSatoshis())
	require.EqualValues(t, memo, *invoice.Description)
	_, err = alice.PayInvoice(ctx, aliceAcc.String(), payreq, nil, &wrongAmt)
	require.ErrorIs(t, err, lndhubsql.ErrQtyMissmatch)
	_, err = alice.PayInvoice(ctx, aliceAcc.String(), payreq, nil, &amt)
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
