package payments

import (
	"context"
	"encoding/hex"
	"seed/backend/core"
	payments "seed/backend/genproto/payments/v1alpha"
	"seed/backend/lndhub"
	"seed/backend/lndhub/lndhubsql"
	"seed/backend/testutil"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestRequestLndHubInvoice(t *testing.T) {
	testutil.Manual(t)
	ctx := context.Background()
	alice := makeTestService(t, "alice")
	aliceAccs, err := alice.ks.ListKeys(ctx)
	require.NoError(t, err)
	require.Len(t, aliceAccs, 1)
	alicePk, err := aliceAccs[0].PublicKey.Libp2pKey()
	require.NoError(t, err)
	bob := makeTestService(t, "bob")
	bobAccs, err := bob.ks.ListKeys(ctx)
	require.NoError(t, err)
	require.Len(t, bobAccs, 1)
	bobPk, err := bobAccs[0].PublicKey.Libp2pKey()
	require.NoError(t, err)
	bobKp, err := bob.ks.GetKey(ctx, core.PrincipalFromPubKey(bobPk).String())

	require.NoError(t, err)
	alicesWallet, err := alice.CreateWallet(ctx, &payments.CreateWalletRequest{Account: core.PrincipalFromPubKey(alicePk).String(), Name: "myWallet"})
	require.NoError(t, err)
	defaultWallet, err := alice.GetDefaultWallet(ctx, &payments.GetDefaultWalletRequest{Account: alicesWallet.Account})
	require.NoError(t, err)
	require.Equal(t, alicesWallet, defaultWallet)
	_, err = alice.ExportWallet(ctx, &payments.WalletRequest{Id: alicesWallet.Id})
	require.NoError(t, err)

	login, err := bobKp.Sign([]byte(lndhub.SigningMessage))
	require.NoError(t, err)

	uri := "lndhub.go://" + core.PrincipalFromPubKey(bobPk).String() + ":" + hex.EncodeToString(login) + "@https://ln.testnet.mintter.com"
	bobsWallet, err := bob.ImportWallet(ctx, &payments.ImportWalletRequest{CredentialsUrl: uri, Account: core.PrincipalFromPubKey(bobPk).String(), Name: "default"})
	require.NoError(t, err)

	var amt int64 = 23
	var wrongAmt int64 = 24
	var memo = "test invoice"

	var payreq *payments.Payreq

	defaultWallet, err = bob.GetDefaultWallet(ctx, &payments.GetDefaultWalletRequest{Account: core.PrincipalFromPubKey(bobPk).String()})
	require.NoError(t, err)
	require.Equal(t, bobsWallet, defaultWallet)
	require.Eventually(t, func() bool {
		conn, release, err := bob.pool.Conn(ctx)
		require.NoError(t, err)
		defer release()
		_, err = lndhubsql.GetToken(conn, defaultWallet.Id)
		return err == nil
	}, 3*time.Second, 1*time.Second)

	require.Eventually(t, func() bool {
		payreq, err = alice.RequestLud6Invoice(ctx, &payments.RequestLud6InvoiceRequest{
			URL:    bobsWallet.Address,
			User:   core.PrincipalFromPubKey(bobPk).String(),
			Amount: int64(amt),
			Memo:   memo,
		})
		return err == nil
	}, 8*time.Second, 2*time.Second)
	invoice, err := lndhub.DecodeInvoice(payreq.Payreq)
	require.NoError(t, err)
	require.EqualValues(t, amt, invoice.MilliSat.ToSatoshis())
	require.EqualValues(t, memo, *invoice.Description)
	req := &payments.PayInvoiceRequest{Payreq: payreq.Payreq,
		Account: alicesWallet.Account,
		Amount:  wrongAmt}
	_, err = alice.PayInvoice(ctx, req)
	require.ErrorIs(t, err, lndhubsql.ErrQtyMissmatch)
	req.Amount = amt
	_, err = alice.PayInvoice(ctx, req)
	require.ErrorIs(t, err, lndhubsql.ErrNotEnoughBalance)
}

func TestRequestP2PInvoice(t *testing.T) {
	t.Skip("Not implemented, as we don't have contacts (PID->Account) yet")
	testutil.Manual(t)

	alice := makeTestService(t, "alice")
	bob := makeTestService(t, "bob")
	ctx := context.Background()
	aliceAcc, err := alice.net.GetAccountByKeyName(ctx, "main")
	require.NoError(t, err)
	bobAccount, err := bob.net.GetAccountByKeyName(ctx, "main")
	require.NoError(t, err)
	require.NoError(t, alice.net.Connect(ctx, bob.net.AddrInfo()))
	defaultWallet, err := bob.GetDefaultWallet(ctx, &payments.GetDefaultWalletRequest{Account: bobAccount.String()})
	require.NoError(t, err)

	var amt int64 = 23
	var wrongAmt int64 = 24
	var memo = "test invoice"
	var payreq *payments.Payreq
	req := &payments.RequestLud6InvoiceRequest{
		URL:    defaultWallet.Address,
		User:   bobAccount.String(),
		Amount: int64(amt),
		Memo:   memo,
	}
	require.Eventually(t, func() bool {
		payreq, err = alice.RequestLud6Invoice(ctx, req)
		return err == nil
	}, 8*time.Second, 2*time.Second)
	invoice, err := lndhub.DecodeInvoice(payreq.Payreq)
	require.NoError(t, err)
	require.EqualValues(t, amt, invoice.MilliSat.ToSatoshis())
	require.EqualValues(t, memo, *invoice.Description)
	req2 := &payments.PayInvoiceRequest{Payreq: payreq.Payreq,
		Account: aliceAcc.String(),
		Amount:  wrongAmt}
	_, err = alice.PayInvoice(ctx, req2)
	require.ErrorIs(t, err, lndhubsql.ErrQtyMissmatch)
	req2.Amount = amt
	_, err = alice.PayInvoice(ctx, req2)
	require.ErrorIs(t, err, lndhubsql.ErrNotEnoughBalance)
}
