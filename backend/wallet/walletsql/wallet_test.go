package walletsql

import (
	"context"
	"seed/backend/storage"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

const (
	id1      = "2bd1fb78d1fbc89ea80629500b58b6f50da462b36c9fdc893776593f33cb6d46"
	account1 = "z6Mkw6sXCVij4x7RnqKfp2CB9PH7gMscFRaL8vur2vdrfopq"
	address1 = "https://lndhub.io"
	name1    = "my LND wallet"
	type1    = "LND"

	id2      = "fcbe2645d60556c3842971934ee836eec07898fa8357597c37fd86377fa95478"
	account2 = "z6MkfnTm9rs3KYGb1ZJN1R4GBNCGAk1xBojhjmfpU8RkdUnc"
	address2 = "https://lndhub.io"
	name2    = "my LNDHub wallet"
	type2    = "LNDHUB"

	id3      = "6e703a77440228295fb18cfaf9ca5fcb80a110354d346a6ad8525464d7cd8178"
	account3 = "z6MktoFgiExx97vBehL2V99Pqv1qifiWJbEdd1pUaPAib2nM"
	name3    = "my LNDHub.go wallet"
	type3    = "lndhub.go"

	id4 = "6e703a77440228295fb18cfaf9ca5fcb80a110354d346a6ad8525464d7cd8174"
)

var (
	login = []byte("f7b32cb8ae914a1706b94bbe46d304e3")
	pass  = []byte("4f671cadcf0e5977559ed7727b2ee2f4f")
	token = []byte("4f671cadcf0e5977559ed7727b2ee2f4f7b32ca8ae914a1703b94bbe4fd304e3")
)

func TestQueries(t *testing.T) {
	pool := storage.MakeTestDB(t)
	conn, release, err := pool.Conn(context.Background())
	require.NoError(t, err)
	defer release()

	{
		err = InsertWallet(conn, Wallet{
			ID:      id1,
			Account: account1,
			Address: address1,
			Name:    name1,
			Type:    type1,
		}, login, pass, nil)
		require.NoError(t, err)

		got, err := getWallet(conn, id1)
		require.NoError(t, err)

		require.Equal(t, id1, got.WalletsID)
		require.Equal(t, address1, got.WalletsAddress)
		require.Equal(t, name1, got.WalletsName)
		require.Equal(t, strings.ToLower(type1), got.WalletsType)

		defaultWallet, err := GetDefaultWallet(conn, account1)
		require.NoError(t, err)
		require.Equal(t, defaultWallet.ID, got.WalletsID)

		defaultWallet, err = GetDefaultWallet(conn, account2)
		require.Error(t, err)

		err = InsertWallet(conn, Wallet{
			ID:      id2,
			Account: account2,
			Address: address2,
			Name:    name2,
			Type:    type2,
		}, login, pass, token)
		require.NoError(t, err)

		got2, err := getWallet(conn, id2)
		require.NoError(t, err)

		defaultWallet, err = GetDefaultWallet(conn, account2)
		require.NoError(t, err)
		require.Equal(t, defaultWallet.ID, got2.WalletsID)

		got, err = getWallet(conn, id2)
		require.NoError(t, err)

		require.Equal(t, id2, got.WalletsID)
		require.Equal(t, address2, got.WalletsAddress)
		require.Equal(t, name2, got.WalletsName)
		require.Equal(t, strings.ToLower(type2), got.WalletsType)

		err = InsertWallet(conn, Wallet{
			ID:      id2,
			Account: account2,
			Name:    name2,
			Type:    type2,
		}, login, pass, nil)
		require.Error(t, err)

		_, err = UpdateDefaultWallet(conn, account1, id2)
		require.Error(t, err)

		err = InsertWallet(conn, Wallet{
			ID:      id4,
			Account: account1,
			Name:    name2,
			Type:    type2,
		}, login, pass, nil)
		require.NoError(t, err)

		_, err = UpdateDefaultWallet(conn, account1, id2)
		require.Error(t, err)

		newDefaultWallet, err := UpdateDefaultWallet(conn, account1, id4)
		require.NoError(t, err)

		require.Equal(t, newDefaultWallet.ID, id4)

		nwallets, err := getWalletCount(conn)
		require.NoError(t, err)
		require.Equal(t, int64(3), nwallets.Count)

		require.NoError(t, RemoveWallet(conn, newDefaultWallet.ID))
		defaultWallet, err = GetDefaultWallet(conn, account2)
		require.NoError(t, err)
		require.Equal(t, defaultWallet.ID, id2)

		newwallet1, err := UpdateWalletName(conn, id1, name2)
		require.NoError(t, err)
		require.Equal(t, newwallet1.Name, name2)

		err = InsertWallet(conn, Wallet{
			ID:      id3,
			Account: account3,
			Name:    name3,
			Type:    type3,
		}, login, pass, token)
		require.NoError(t, err)

		newDefaultWallet, err = UpdateDefaultWallet(conn, account3, id3)
		require.NoError(t, err)
		require.Equal(t, id3, newDefaultWallet.ID)

		nwallets, err = getWalletCount(conn)
		require.NoError(t, err)
		require.Equal(t, int64(3), nwallets.Count)
		require.NoError(t, RemoveWallet(conn, id1))
		require.NoError(t, RemoveWallet(conn, id2))
		require.NoError(t, RemoveWallet(conn, id3), "we should remove the default wallet even though there is no one left")
	}
}
