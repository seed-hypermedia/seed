package lndhub

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"math/rand"
	"net/http"
	"seed/backend/core"
	"seed/backend/storage"
	"seed/backend/testutil"
	"seed/backend/wallet/walletsql"
	"strings"
	"testing"
	"time"

	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"

	"github.com/btcsuite/btcd/btcutil"
	"github.com/stretchr/testify/require"
)

const (
	lndhubDomain    = "ln.testnet.seed.hyper.media"
	lnaddressDomain = "ln.testnet.seed.hyper.media"
	connectionURL   = "https://" + lndhubDomain
)

func TestCreate(t *testing.T) {
	testutil.Manual(t)

	const invoiceAmt = 12543
	const invoiceMemo = "test invoice go"
	var nickname = randStringRunes(8)

	pool, err := makeConn(t)
	require.NoError(t, err)

	conn, release, err := pool.Conn(context.Background())
	require.NoError(t, err)
	defer release()

	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(640)*time.Second)
	defer cancel()
	keypair, err := core.NewKeyPairRandom()
	require.NoError(t, err)
	token, err := keypair.PublicKey.Wrapped().Raw()
	require.NoError(t, err)

	login := keypair.String()
	passwordBytes, err := keypair.Sign([]byte(SigningMessage))
	password := hex.EncodeToString(passwordBytes)
	require.NoError(t, err)
	lndHubClient := NewClient(&http.Client{}, pool, lndhubDomain, lnaddressDomain)
	walletID := credentials2Id("lndhub.go", login, password, lndhubDomain, token)

	makeTestWallet(t, conn, walletsql.Wallet{
		ID:      walletID,
		Address: connectionURL,
		Name:    nickname,
		Type:    "lndhub.go",
		Account: keypair.Principal().String(),
	}, login, password, hex.EncodeToString(token))

	user, err := lndHubClient.Create(ctx, connectionURL, walletID, login, password, nickname, token)
	require.NoError(t, err)
	require.EqualValues(t, login, user.Login)
	require.EqualValues(t, password, user.Password)
	require.EqualValues(t, strings.ToLower(nickname), user.Nickname)
	_, err = lndHubClient.Auth(ctx, walletID)
	require.NoError(t, err)
	var newNickname = randStringRunes(8)
	err = lndHubClient.UpdateNickname(ctx, walletID, strings.ToUpper(newNickname), token)
	require.Error(t, err)
	newNickname = strings.ToLower(newNickname)
	err = lndHubClient.UpdateNickname(ctx, walletID, newNickname, token)
	require.NoError(t, err)
	lnaddress, err := lndHubClient.GetLnAddress(ctx, walletID)
	require.NoError(t, err)
	require.EqualValues(t, newNickname+"@"+lnaddressDomain, lnaddress)
	balance, err := lndHubClient.GetBalance(ctx, walletID)
	require.NoError(t, err)
	require.EqualValues(t, 0, balance)
	payreq, err := lndHubClient.CreateLocalInvoice(ctx, walletID, invoiceAmt, invoiceMemo)
	require.NoError(t, err)
	decodedInvoice, err := DecodeInvoice(payreq)
	require.NoError(t, err)
	require.EqualValues(t, invoiceMemo, *decodedInvoice.Description)
	require.EqualValues(t, invoiceAmt, uint64(decodedInvoice.MilliSat.ToSatoshis()))

	const invoiceMemo2 = "zero invoice test amount"
	_, err = lndHubClient.RequestLud6Invoice(ctx, "https://ln.testnet.seed.hyper.media", newNickname, 0, invoiceMemo2)
	require.Error(t, err)
	const invoiceMemo3 = "non-zero invoice test amount"
	const amt = 233
	payreq, err = lndHubClient.RequestLud6Invoice(ctx, "https://ln.testnet.seed.hyper.media", newNickname, amt, invoiceMemo3)
	require.NoError(t, err)
	decodedInvoice, err = DecodeInvoice(payreq)
	require.NoError(t, err)
	require.EqualValues(t, invoiceMemo3, *decodedInvoice.Description)
	require.EqualValues(t, amt, decodedInvoice.MilliSat.ToSatoshis().ToUnit(btcutil.AmountSatoshi)) // when amt is zero, the result is nil
	invoices, err := lndHubClient.ListReceivedInvoices(ctx, walletID)
	require.NoError(t, err)
	require.GreaterOrEqual(t, len(invoices), 1)
	//TODO: test for invoice metadata
}

func randStringRunes(n int) string {
	var letterRunes = []rune("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ")
	rand.Seed(time.Now().UnixNano())
	b := make([]rune, n)
	for i := range b {
		b[i] = letterRunes[rand.Intn(len(letterRunes))]
	}
	return string(b)
}

func makeTestWallet(t *testing.T, conn *sqlite.Conn, wallet walletsql.Wallet, login, pass, token string) {
	binaryToken := []byte(token)   // TODO: encrypt the token before storing
	binaryLogin := []byte(login)   // TODO: encrypt the login before storing
	binaryPassword := []byte(pass) // TODO: encrypt the password before storing

	require.NoError(t, walletsql.InsertWallet(conn, wallet, binaryLogin, binaryPassword, binaryToken))
}

func makeConn(t *testing.T) (*sqlitex.Pool, error) {
	return storage.MakeTestDB(t), nil
}

func credentials2Id(wType, login, password, domain string, account []byte) string {
	url := wType + "://" + login + ":" + password + "@https://" + domain
	h := sha256.Sum256(append([]byte(url), account...))
	return hex.EncodeToString(h[:])
}
