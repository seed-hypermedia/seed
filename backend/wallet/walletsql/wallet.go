package walletsql

import (
	"errors"
	"fmt"
	"seed/backend/blob"
	"seed/backend/core"
	"seed/backend/storage"
	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"
	"seed/backend/util/sqlitegen"
	"strings"
)

const (
	idcharLength = 64

	// NotEnoughBalance can be used to check the typical API error of not having enough balance.
	NotEnoughBalance = "not enough balance"
)

var (
	// ErrDuplicateIndex is thrown when db identifies a duplicate entry on a unique key.
	ErrDuplicateIndex = errors.New("duplicate entry")
	// ErrNoDefaultWallet is thrown when there is not a default wallet for a certain account.
	ErrNoDefaultWallet = errors.New("No default wallet set")
)

// Wallet is the representation of a lightning wallet.
type Wallet struct {
	ID      string `mapstructure:"id"`
	Account string `mapstructure:"account"`
	Address string `marstructure:"address"`
	Name    string `mapstructure:"name"`
	Type    string `mapstructure:"type"`
}

// GetWallet retrieves information about the specific wallet identified with id string
// id is the string representation of the credential hash of the lndhub wallet or the
// string representation of the public key in an lnd wallet. In case there isn't any
// wallet identified with id an error will be returned.
func GetWallet(conn *sqlite.Conn, walletID string) (Wallet, error) {
	if len(walletID) != idcharLength {
		return Wallet{}, fmt.Errorf("wallet id must be a %d character string. Got %d", idcharLength, len(walletID))
	}

	wallet, err := getWallet(conn, walletID)
	if err != nil {
		return Wallet{}, err
	}
	if wallet.WalletsID == "" {
		return Wallet{}, fmt.Errorf("No wallet found with id %s", walletID)
	}
	principal, err := blob.DbGetPublicKeyByID(conn, wallet.WalletsAccount)
	if err != nil {
		return Wallet{}, fmt.Errorf("Problem getting the wallet's account %s", walletID)
	}
	ret := Wallet{
		ID:      wallet.WalletsID,
		Address: wallet.WalletsAddress,
		Name:    wallet.WalletsName,
		Type:    wallet.WalletsType,
		Account: core.Principal(principal).String(),
	}

	return ret, err
}

// ListWallets returns the ids, types and names of all wallets.
// If there are no wallets, an empty slice will be returned
// If there are wallets to show, ListWallets will return up
// to limit wallets. In case limit <=0, ListWallets will return
// all wallets available. If accounts is not blank then ListWallets
// will return only wallets for that account.
func ListWallets(conn *sqlite.Conn, account string, limit int) ([]Wallet, error) {
	var resultArray []Wallet

	res, err := listWallets(conn, "", int64(limit))
	if err != nil {
		return resultArray, err
	}

	for _, s := range res {
		principal, err := blob.DbGetPublicKeyByID(conn, s.WalletsAccount)
		if err != nil {
			return resultArray, fmt.Errorf("Problem getting the wallet's account %s", s.WalletsID)
		}
		acc := core.Principal(principal).String()
		if account != "" && account != acc {
			continue
		}
		resultArray = append(resultArray,
			Wallet{
				ID:      s.WalletsID,
				Address: s.WalletsAddress,
				Name:    s.WalletsName,
				Type:    s.WalletsType,
				Account: acc,
			})
	}

	return resultArray, err
}

// InsertWallet creates a new wallet record in the database given a
// valid Wallet with all fields properly set. If this is the first
// wallet, then it becomes default automatically. If token is not known at creation time
// it can be null. Login and password, however have to be valid credentials.
func InsertWallet(conn *sqlite.Conn, wallet Wallet, login, password, token []byte) error {
	if len(wallet.ID) != idcharLength {
		return fmt.Errorf("wallet id must be a %d character string. Got %d", idcharLength, len(wallet.ID))
	}
	principal, err := core.DecodePrincipal(wallet.Account)
	if err != nil {
		return fmt.Errorf("Could not decode provided account %s: %w", wallet.Account, err)
	}
	accountID, err := blob.DbPublicKeysLookupID(conn, principal)
	if err != nil {
		return fmt.Errorf("Problem finding provided account %s : %w", wallet.Account, err)
	}
	if accountID == 0 {
		accountID, err = blob.DbPublicKeysInsert(conn, principal)
		if err != nil {
			return fmt.Errorf("Error inserting new account %s: %w", principal.String(), err)
		}
	}
	if err := insertWallet(conn, wallet.ID, accountID, wallet.Address, strings.ToLower(wallet.Type),
		login, password, token, wallet.Name); err != nil {
		if strings.Contains(err.Error(), "UNIQUE constraint failed") {
			return fmt.Errorf("couldn't insert wallet: %w", ErrDuplicateIndex)
		}
		return fmt.Errorf("couldn't insert wallet: %w", err)
	}

	//If the previously inserted was the first one, then it should be the default as well
	if _, err := GetDefaultWallet(conn, principal.String()); err != nil {
		if errors.Is(err, ErrNoDefaultWallet) {
			query := createSetDefaultWalletQuery(wallet.Account, wallet.ID)
			if err := sqlitex.Exec(conn, query, nil); err != nil {
				return fmt.Errorf("couldn't set newly created wallet to default: %w", err)
			}
			return nil
		}
		_ = removeWallet(conn, wallet.ID)
		return fmt.Errorf("couldn't set default wallet")
	}
	return nil
}

// GetDefaultWallet gets the user's default wallet. If the user didn't manually
// update the default wallet, then the first wallet ever created is the default
// wallet. It will remain default until manually changed. There is a default wallet per account.
func GetDefaultWallet(conn *sqlite.Conn, account string) (w Wallet, err error) {
	query := createGetDefaultWalletQuery(account)
	var acc int64
	if err = sqlitex.Exec(conn, query, func(stmt *sqlite.Stmt) error {
		w.ID = stmt.ColumnText(0)
		acc = stmt.ColumnInt64(1)
		w.Address = stmt.ColumnText(2)
		w.Name = stmt.ColumnText(3)
		w.Type = stmt.ColumnText(4)
		return nil
	}); err != nil {
		return w, fmt.Errorf("Could not get default wallet: %w", err)
	}
	principal, err := blob.DbGetPublicKeyByID(conn, acc)
	if err != nil {
		return w, fmt.Errorf("Could not decode default wallet account: %w", err)
	}
	if principal == nil {
		return w, ErrNoDefaultWallet
	}
	w.Account = core.Principal(principal).String()
	return w, err
}

// UpdateDefaultWallet sets the default wallet to the one that matches newIdx
// previous default wallet is replaced by the new one so only one can be
// the default at any given time. The default wallet is the first wallet ever
// created until manually changed.
func UpdateDefaultWallet(conn *sqlite.Conn, account, newID string) (Wallet, error) {
	var err error

	if len(newID) != idcharLength {
		return Wallet{}, fmt.Errorf("wallet id must be a %d character string. Got %d", idcharLength, len(newID))
	}

	defaultWallet, err := GetWallet(conn, newID)
	if err != nil {
		return Wallet{}, fmt.Errorf("cannot make %s default: %w", newID, err)
	}
	if defaultWallet.Account != account {
		return Wallet{}, fmt.Errorf("New default wallet id %s does not belong to account %s. Please, import that wallet first in the account", newID, account)
	}
	query := createSetDefaultWalletQuery(account, newID)
	if err := sqlitex.Exec(conn, query, nil); err != nil {
		return Wallet{}, fmt.Errorf("cannot set %s as default wallet: %w", newID, err)
	}

	return defaultWallet, nil
}

// UpdateWalletName updates an existing wallet's name with the one provided.
// If the wallet represented by the id id does not exist, this function
// returns error. nil otherwise, along with the updated wallet.
func UpdateWalletName(conn *sqlite.Conn, walletID string, newName string) (Wallet, error) {
	if len(walletID) != idcharLength {
		return Wallet{}, fmt.Errorf("wallet id must be a %d character string. Got %d", idcharLength, len(walletID))
	}

	if err := updateWalletName(conn, newName, walletID); err != nil {
		return Wallet{}, err
	}

	return GetWallet(conn, walletID)
}

// RemoveWallet deletes the wallet with index id. If that wallet was the default
// wallet, a random wallet will be chosen as new default. Although it is advised
// that the user manually changes the default wallet after removing the previous
// default.
func RemoveWallet(conn *sqlite.Conn, id string) error {
	if len(id) != idcharLength {
		return fmt.Errorf("wallet id must be a %d character string. Got %d", idcharLength, len(id))
	}
	wallet2delete, err := getWallet(conn, id)
	if err != nil {
		return fmt.Errorf("couldn't find wallet for deletion, probably already deleted")
	}
	principal, err := blob.DbGetPublicKeyByID(conn, wallet2delete.WalletsAccount)
	if err != nil {
		return fmt.Errorf("Problem getting the wallet's account %s", wallet2delete.WalletsID)
	}
	defaultWallet, err := GetDefaultWallet(conn, core.Principal(principal).String())
	if err != nil {
		return fmt.Errorf("couldn't get default wallet while deleting walletID %s", id)
	}

	if err := removeWallet(conn, id); err != nil {
		return fmt.Errorf("couldn't remove wallet: %w", err)
	}

	//If the previously deleted was the default, then we should set a new default
	if defaultWallet.ID == id {
		newDefaultWallet, err := ListWallets(conn, core.Principal(principal).String(), 1)
		if err != nil {
			return fmt.Errorf("couldn't get wallet count")
		}

		if len(newDefaultWallet) != 0 {
			principal, err := core.DecodePrincipal(newDefaultWallet[0].Account)
			if err != nil {
				return fmt.Errorf("Could not decode provided account %s: %w", newDefaultWallet[0].Account, err)
			}

			query := createSetDefaultWalletQuery(core.Principal(principal).String(), newDefaultWallet[0].ID)
			if err := sqlitex.Exec(conn, query, nil); err != nil {
				return fmt.Errorf("couldn't pick a wallet to be the new default after deleting the old one")
			}
		} else {
			query := createRemoveDefaultWalletQuery(core.Principal(principal).String())
			if err := sqlitex.Exec(conn, query, nil); err != nil {
				return fmt.Errorf("couldn't remove default wallet after deleting the last one")
			}
		}
	}

	return nil
}

func createRemoveDefaultWalletQuery(account string) string {
	cond := "SELECT json_remove(json((SELECT " + storage.KVValue + " FROM " + storage.T_KV + " WHERE " + storage.KVKey + "='" + DefaultWalletKey + "')),'$." + sqlitegen.Column(account) + "') FROM " + storage.T_KV + " WHERE " + storage.KVKey + " = '" + DefaultWalletKey + "'"
	return "INSERT OR REPLACE INTO " + storage.T_KV + "(" + storage.KVKey.ShortName() + ", " + storage.KVValue.ShortName() + ") VALUES ('" + DefaultWalletKey + "',(" + cond.String() + "));"
}

func createSetDefaultWalletQuery(account, walletID string) string {
	cond := "CASE WHEN (SELECT json(" + storage.KVValue + ") from " + storage.T_KV + " WHERE " + storage.KVKey + "='" + DefaultWalletKey + "') IS NOT NULL THEN json_set((SELECT json(" + storage.KVValue + ") FROM " + storage.T_KV + " WHERE " + storage.KVKey + "='" + DefaultWalletKey + "'),'$." + sqlitegen.Column(account) + "','" + sqlitegen.Column(walletID) + "') ELSE json_set('{}','$." + sqlitegen.Column(account) + "','" + sqlitegen.Column(walletID) + "') END"
	return "INSERT OR REPLACE INTO " + storage.T_KV + "(" + storage.KVKey.ShortName() + ", " + storage.KVValue.ShortName() + ") VALUES ('" + DefaultWalletKey + "'," + cond.String() + ");"
}

func createGetDefaultWalletQuery(account string) string {
	cond := "SELECT json_extract(json((SELECT " + storage.KVValue + " FROM " + storage.T_KV + " WHERE " + storage.KVKey + "='" + DefaultWalletKey + "')),'$." + sqlitegen.Column(account) + "') FROM " + storage.T_KV + " WHERE " + storage.KVKey + " = '" + DefaultWalletKey + "')"
	return ("SELECT " + storage.WalletsID + ", " + storage.WalletsAccount + ", " + storage.WalletsAddress + ", " + storage.WalletsName + ", " + storage.WalletsType + " FROM " + sqlitegen.Column(storage.T_Wallets) + " WHERE " + storage.WalletsID + " = (" + cond + ";").String()
}
