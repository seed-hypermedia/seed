package wallet

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"seed/backend/core"
	"seed/backend/lndhub"
	"seed/backend/lndhub/lndhubsql"
	"seed/backend/mttnet"
	"seed/backend/wallet/walletsql"
	wallet "seed/backend/wallet/walletsql"
	"strings"

	"seed/backend/util/sqlite/sqlitex"

	"github.com/ipfs/go-cid"
	"go.uber.org/zap"
)

var (
	errAlreadyLndhubgoWallet = errors.New("Only one lndhub.go wallet is allowed and we already had one")
	supportedWallets         = []string{lndhubsql.LndhubWalletType, lndhubsql.LndhubGoWalletType}
	validCredentials         = regexp.MustCompile(`([A-Za-z0-9_\-\.]+):\/\/([0-9A-Za-z]+):([0-9a-f]+)@https:\/\/([A-Za-z0-9_\-\.]+)\/?$`)
)

// AccountID is a handy alias of Cid.
type AccountID = cid.Cid

// Service wraps everything necessary to deliver a wallet service.
type Service struct {
	lightningClient lnclient
	pool            *sqlitex.Pool
	net             *mttnet.Node
	log             *zap.Logger
}

// Credentials struct holds all we need to connect to different lightning nodes (lndhub, LND, core-lightning, ...).
type Credentials struct {
	Domain     string `json:"domain"`
	WalletType string `json:"wallettype"`
	Login      string `json:"login"`
	Password   string `json:"password"`
	Nickname   string `json:"nickname,omitempty"`
}

// New is the constructor of the wallet service. Since it needs to authenticate to the internal wallet provider (lndhub)
// it may take time in case node is offline. This is why it's initialized in a gorutine and calls to the service functions
// will fail until the initial wallet is successfully initialized.
func New(ctx context.Context, log *zap.Logger, db *sqlitex.Pool, net *mttnet.Node, mainnet bool) *Service {
	lndhubDomain := "ln.testnet.mintter.com"
	lnaddressDomain := "ln.testnet.mintter.com"
	if mainnet {
		//lndhubDomain is the domain for internal lndhub calls.
		lndhubDomain = "ln.mintter.com"
		lnaddressDomain = "ln.mintter.com"
	}
	srv := &Service{
		pool: db,
		lightningClient: lnclient{
			Lndhub: lndhub.NewClient(ctx, &http.Client{}, db, lndhubDomain, lnaddressDomain),
		},
		net: net,
		log: log,
	}
	srv.net.SetInvoicer(srv)
	return srv
}

type lnclient struct {
	Lndhub *lndhub.Client
	Lnd    interface{} // TODO: implement LND client
}

// InvoiceRequest holds the necessary fields for the request. Currently hold invoices are not supported, so they're omitted.
type InvoiceRequest struct {
	AmountSats   int64  `help:"The invoice amount in satoshis" default:"0"`
	Memo         string `help:"Optional requested memo to be attached in the invoice" default:""`
	HoldInvoice  bool   `help:"If we request a hold invoice instead of a regular one. If true, then the following field is mandatory" default:"false"`
	PreimageHash []byte `help:"Preimage hash of the requested hold invoice. If HoldInvoice flag is set to false this field is skipped" default:""`
}

// P2PInvoiceRequest requests a remote account to issue an invoice so we can pay it.
// Any of the devices associated with the remote account can issue it. For each
// associated device we found online ,we ask if it can provide an invoice.
// If for some reason, that device cannot create the invoice (insufficient
// inbound liquidity) we ask the next device. We return in the first device that
// can issue the invoice. If none of them can, then an error is raised.
func (srv *Service) P2PInvoiceRequest(ctx context.Context, account core.Principal, request InvoiceRequest) (string, error) {
	return "", fmt.Errorf("Hm-24. Not implemented")
	/*
		me, err := srv.keyStore.GetKey(ctx, srv.keyName)
		if err != nil {
			return "", err
		}
		if me.String() == account.String() {
			err := fmt.Errorf("cannot remotely issue an invoice to myself")
			srv.log.Debug(err.Error())
			return "", err
		}

		var dels []hypersql.KeyDelegationsListResult
		if err := srv.pool.Query(ctx, func(conn *sqlite.Conn) error {
			list, err := hypersql.KeyDelegationsList(conn, account)
			if err != nil {
				return err
			}
			if len(list) == 0 {
				return fmt.Errorf("request invoice: can't find devices for account %s", account)
			}

			dels = list

			return nil
		}); err != nil {
			return "", err
		}

		for _, del := range dels {
			pid, err := core.Principal(del.KeyDelegationsViewDelegate).PeerID()
			if err != nil {
				return "", fmt.Errorf("failed to extract peer ID: %w", err)
			}
			p2pc, err := srv.net.Client(ctx, pid)
			if err != nil {
				continue
			}

			remoteInvoice, err := p2pc.RequestInvoice(ctx, &p2p.RequestInvoiceRequest{
				AmountSats:   request.AmountSats,
				Memo:         request.Memo,
				HoldInvoice:  request.HoldInvoice,
				PreimageHash: request.PreimageHash,
			})

			if err != nil {
				srv.log.Debug("p2p invoice request failed", zap.String("msg", err.Error()))
				return "", fmt.Errorf("p2p invoice request failed")
			}

			if remoteInvoice.PayReq == "" {
				return "", fmt.Errorf("received an empty invoice from remote peer")
			}

			return remoteInvoice.PayReq, nil
		}

		return "", fmt.Errorf("couldn't get remote invoice from any peer")
	*/
}

// CreateWallet creates a seed wallet from a set of mnemonic words. (usually the same as the
// account). If the account was set with a password, then the same password has to be inserted here
func (srv *Service) CreateWallet(ctx context.Context, mnemonics []string, passphrase string, name string) (ret wallet.Wallet, err error) {
	kp, err := core.AccountFromMnemonic(mnemonics, passphrase)
	if err != nil {
		return ret, fmt.Errorf("Provided mnemonics lead to a non valid or non existing account: %w", err)
	}
	signature, err := kp.Sign([]byte(lndhub.SigningMessage))
	if err != nil {
		return ret, fmt.Errorf("Could not sign the login phrase with the provided mnemonics: %w", err)
	}

	creds := Credentials{
		Domain:     srv.lightningClient.Lndhub.GetLndaddressDomain(),
		WalletType: lndhubsql.LndhubGoWalletType,
		Login:      kp.Principal().String(),
		Password:   hex.EncodeToString(signature),
		Nickname:   kp.Principal().String(),
	}
	credentialsURL, err := EncodeCredentialsURL(creds)
	if err != nil {
		return ret, fmt.Errorf("Error generating credentials: %w", err)
	}
	return srv.InsertWallet(ctx, credentialsURL, name, creds.Login)

}

// InsertWallet first tries to connect to the wallet with the provided credentials. On
// success, gets the wallet balance and inserts all that information in the database.
// InsertWallet returns the wallet actually inserted on success. The credentials are stored
// in plain text at the moment.
func (srv *Service) InsertWallet(ctx context.Context, credentialsURL, name, account string) (ret wallet.Wallet, err error) {
	creds, err := DecodeCredentialsURL(credentialsURL)
	if err != nil {
		srv.log.Debug(err.Error())
		return ret, err
	}

	if !isSupported(creds.WalletType) {
		err = fmt.Errorf(" wallet type [%s] not supported. Currently supported: [%v]", creds.WalletType, supportedWallets)
		srv.log.Debug(err.Error())
		return ret, err
	}

	principal, err := core.DecodePrincipal(account)
	if err != nil {
		return ret, fmt.Errorf("Wrong account %s: %w", account, err)
	}
	_, bynaryAcc := principal.Explode()
	if err != nil {
		return ret, fmt.Errorf("Problem getting bytes from public key %s: %w", principal.String(), err)
	}
	ret.ID = URL2Id(credentialsURL, account)

	conn, release, err := srv.pool.Conn(ctx)
	if err != nil {
		return ret, err
	}
	defer release()

	ret.Type = creds.WalletType
	ret.Address = "https://" + creds.Domain
	ret.Name = name
	ret.Account = account
	if creds.WalletType == lndhubsql.LndhubGoWalletType {
		// Only one lndhub.go wallet is allowed
		wallets, err := srv.ListWallets(ctx, account, false)
		if err != nil {
			srv.log.Debug(err.Error())
			return ret, err
		}
		for i := 0; i < len(wallets); i++ {
			if wallets[i].Type == lndhubsql.LndhubGoWalletType && wallets[i].Account == account {
				err = fmt.Errorf("Only one type of %s wallet is allowed per account: %w", lndhubsql.LndhubGoWalletType, errAlreadyLndhubgoWallet)
				srv.log.Debug(err.Error())
				return wallets[i], err
			}
		}
		if creds.Nickname == "" {
			creds.Nickname = creds.Login
		}
		newWallet, err := srv.lightningClient.Lndhub.Create(ctx, ret.Address, ret.ID, creds.Login, creds.Password, creds.Nickname, bynaryAcc)
		if err != nil {
			srv.log.Warn("couldn't insert wallet", zap.String("Login", creds.Login), zap.String("Nickname", creds.Nickname), zap.Error(err))
			return ret, err
		}
		creds.Nickname = newWallet.Nickname
	}

	if err = wallet.InsertWallet(conn, ret, []byte(creds.Login), []byte(creds.Password), bynaryAcc); err != nil {
		srv.log.Debug("couldn't insert wallet", zap.String("msg", err.Error()))
		if errors.Is(err, walletsql.ErrDuplicateIndex) {
			return ret, fmt.Errorf("couldn't insert wallet %s in the database. ID already exists", name)
		}
		return ret, fmt.Errorf("couldn't insert wallet %s in the database", name)
	}

	// Trying to authenticate with the provided credentials
	_, err = srv.lightningClient.Lndhub.Auth(ctx, ret.ID)
	if err != nil {
		_ = wallet.RemoveWallet(conn, ret.ID)
		srv.log.Warn("couldn't authenticate new wallet", zap.String("msg", err.Error()))
		return ret, fmt.Errorf("couldn't authenticate new wallet %s", name)
	}

	return ret, err
}

// ListWallets returns all the wallets available in the database. If includeBalance is true, then
// ListWallets will also include the balance one every lndhub-like wallet. If false,then the call
// is quicker but no balance information will appear. If account is not blank, it will return only
// wallets from that account
func (srv *Service) ListWallets(ctx context.Context, account string, includeBalance bool) ([]wallet.Wallet, error) {
	conn, release, err := srv.pool.Conn(ctx)
	if err != nil {
		return nil, err
	}
	defer release()

	wallets, err := wallet.ListWallets(conn, account, -1)
	if err != nil {
		srv.log.Debug("couldn't list wallets", zap.String("msg", err.Error()))
		return nil, fmt.Errorf("couldn't list wallets")
	}
	for i, w := range wallets {
		if includeBalance && (strings.ToLower(w.Type) == lndhubsql.LndhubWalletType || strings.ToLower(w.Type) == lndhubsql.LndhubGoWalletType) {
			balance, err := srv.lightningClient.Lndhub.GetBalance(ctx, w.ID)
			if err != nil {
				srv.log.Debug("couldn't get balance", zap.String("wallet", w.Name), zap.String("error", err.Error()))
				return nil, fmt.Errorf("couldn't get balance from wallet %s", w.Name)
			}
			wallets[i].Balance = int64(balance)
		}
	}
	return wallets, nil
}

// DeleteWallet removes the wallet given a valid ID string representing
// the url hash in case of Lndhub-type wallet or the pubkey in case of LND.
// If the removed wallet was the default wallet, a random wallet will be
// chosen as new default. Although it is advised that the user manually
// changes the default wallet after removing the previous default.
func (srv *Service) DeleteWallet(ctx context.Context, walletID string) error {
	conn, release, err := srv.pool.Conn(ctx)
	if err != nil {
		return err
	}
	defer release()

	if err := wallet.RemoveWallet(conn, walletID); err != nil {
		return fmt.Errorf("couldn't remove wallet %s", walletID)
	}
	// TODO: remove associated token db entries
	return nil
}

// UpdateWalletName updates an existing wallet's name with the one provided.
// If the wallet represented by the id id does not exist, this function
// returns error. nil otherwise, along with the updated wallet.
func (srv *Service) UpdateWalletName(ctx context.Context, walletID string, newName string) (ret wallet.Wallet, err error) {
	conn, release, err := srv.pool.Conn(ctx)
	if err != nil {
		return ret, err
	}
	defer release()

	if ret, err = wallet.UpdateWalletName(conn, walletID, newName); err != nil {
		srv.log.Debug("couldn't update wallet", zap.String("msg", err.Error()))
		return ret, fmt.Errorf("couldn't update wallet %s", walletID)
	}

	return ret, nil
}

// SetDefaultWallet sets the default wallet to the one that matches walletID.
// Previous default wallet is replaced by the new one so only one can be
// the default at any given time. The default wallet is the first wallet ever
// created until manually changed.
func (srv *Service) SetDefaultWallet(ctx context.Context, account, walletID string) (ret wallet.Wallet, err error) {
	conn, release, err := srv.pool.Conn(ctx)
	if err != nil {
		return ret, err
	}
	defer release()

	ret, err = wallet.UpdateDefaultWallet(conn, account, walletID)
	if err != nil {
		srv.log.Warn("couldn't set default wallet: " + err.Error())
		return ret, err
	}
	return ret, err
}

// ExportWallet returns the wallet credentials in uri format so the user can import it
// to an external app. the uri format is:
// <wallet_type>://<alphanumeric_login>:<alphanumeric_password>@https://<domain>
// lndhub://c227a7fb5c71a22fac33:d2a48ab779aa1b02e858@https://lndhub.io
// If the ID is empty, then the builtin wallet is exported.
func (srv *Service) ExportWallet(ctx context.Context, walletID string) (string, error) {
	conn, release, err := srv.pool.Conn(ctx)
	if err != nil {
		return "", err
	}
	defer release()
	var uri string
	if walletID == "" {
		return "", fmt.Errorf("Wallet ID cannot be empty")
	}
	login, err := lndhubsql.GetLogin(conn, walletID)
	if err != nil {
		srv.log.Debug(err.Error())
		return "", err
	}
	password, err := lndhubsql.GetPassword(conn, walletID)
	if err != nil {
		srv.log.Debug(err.Error())
		return "", err
	}
	url, err := lndhubsql.GetAPIURL(conn, walletID)
	if err != nil {
		srv.log.Debug(err.Error())
		return "", err
	}
	splitURL := strings.Split(url, "//")
	if len(splitURL) != 2 {
		err = fmt.Errorf("Could not export wallet, unexpected url format [%s]", url)
		srv.log.Debug(err.Error())
		return "", err
	}
	uri, err = EncodeCredentialsURL(Credentials{
		Domain:     splitURL[1],
		WalletType: lndhubsql.LndhubWalletType,
		Login:      login,
		Password:   password,
	})

	if err != nil {
		srv.log.Debug("couldn't encode uri: " + err.Error())
		return "", err
	}
	return uri, nil
}

// UpdateLnaddressNickname updates nickname on the lndhub.go database
// The update can fail if the nickname contain special characters or is already taken by another user.
// Since it is a user operation, if the login is a CID, then user must provide a token representing
// the pubkey whose private counterpart created the signature provided in password (like in create).
func (srv *Service) UpdateLnaddressNickname(ctx context.Context, nickname, walletID string) error {
	conn, release, err := srv.pool.Conn(ctx)
	if err != nil {
		return err
	}
	defer release()
	w, err := wallet.GetWallet(conn, walletID)
	if err != nil {
		return fmt.Errorf("Can't get wallet with ID %s: %w", walletID, err)
	}
	if w.Type != lndhubsql.LndhubGoWalletType && w.Type != lndhubsql.LndhubWalletType {
		return fmt.Errorf("Selected wallet does not support lndaddress")
	}
	principal, err := core.DecodePrincipal(w.Account)
	if err != nil {
		return fmt.Errorf("Cant decode account %s: %w", w.Account, err)
	}
	_, token := principal.Explode()

	if err != nil {
		return fmt.Errorf("Wrong account format%s: %w", principal.String(), err)
	}
	err = srv.lightningClient.Lndhub.UpdateNickname(ctx, w.ID, nickname, token)
	if err != nil {
		srv.log.Debug("couldn't update nickname: " + err.Error())
		return err
	}
	return nil
}

// GetDefaultWallet gets the user's default wallet. If the user didn't manually
// update the default wallet, then the first wallet ever created is the default
// wallet. It will remain default until manually changed.
func (srv *Service) GetDefaultWallet(ctx context.Context, account string) (ret wallet.Wallet, err error) {
	conn, release, err := srv.pool.Conn(ctx)
	if err != nil {
		return ret, err
	}
	defer release()

	w, err := wallet.GetDefaultWallet(conn, account)
	if err != nil {
		srv.log.Debug("couldn't getDefaultWallet: " + err.Error())
		return wallet.Wallet{}, err
	}
	return w, nil
}

// ListPaidInvoices returns the invoices that the wallet represented by walletID has paid.
func (srv *Service) ListPaidInvoices(ctx context.Context, walletID string) ([]lndhub.Invoice, error) {
	conn, release, err := srv.pool.Conn(ctx)
	if err != nil {
		return nil, err
	}
	defer release()

	w, err := wallet.GetWallet(conn, walletID)
	if err != nil {
		srv.log.Debug("couldn't list wallets: " + err.Error())
		return nil, fmt.Errorf("couldn't list wallets")
	}
	if strings.ToLower(w.Type) != lndhubsql.LndhubWalletType && strings.ToLower(w.Type) != lndhubsql.LndhubGoWalletType {
		err = fmt.Errorf("Couldn't get invoices form wallet type %s", w.Type)
		srv.log.Debug(err.Error())
		return nil, err
	}
	invoices, err := srv.lightningClient.Lndhub.ListPaidInvoices(ctx, walletID)
	if err != nil {
		srv.log.Debug("couldn't list outgoing invoices: " + err.Error())
		return nil, err
	}
	return invoices, nil
}

// ListReceivednvoices returns the incoming invoices that the wallet represented by walletID has received.
func (srv *Service) ListReceivednvoices(ctx context.Context, walletID string) ([]lndhub.Invoice, error) {
	conn, release, err := srv.pool.Conn(ctx)
	if err != nil {
		return nil, err
	}
	defer release()

	w, err := wallet.GetWallet(conn, walletID)
	if err != nil {
		srv.log.Debug("couldn't list wallets: " + err.Error())
		return nil, fmt.Errorf("couldn't list wallets: %w", err)
	}
	if strings.ToLower(w.Type) != lndhubsql.LndhubWalletType && strings.ToLower(w.Type) != lndhubsql.LndhubGoWalletType {
		err = fmt.Errorf("Couldn't get invoices form wallet type %s", w.Type)
		srv.log.Debug(err.Error())
		return nil, err
	}
	invoices, err := srv.lightningClient.Lndhub.ListReceivedInvoices(ctx, walletID)
	if err != nil {
		srv.log.Debug("couldn't list incoming invoices: " + err.Error())
		return nil, err
	}
	return invoices, nil
}

// RequestThirdPartyInvoice asks a remote peer to issue an invoice. The remote user can be either a lnaddres or a Seed account ID
// First an lndhub invoice request is attempted. If it fails, then a P2P its used to transmit the invoice. In that case,
// Any of the devices associated with the accountID can issue the invoice. The memo field is optional and can be left nil.
func (srv *Service) RequestLud6Invoice(ctx context.Context, remoteURL, remoteUser string, amountSats int64, memo *string) (string, error) {
	invoiceMemo := ""
	if memo != nil {
		invoiceMemo = *memo
	}
	var payReq string
	var err error
	payReq, err = srv.lightningClient.Lndhub.RequestLud6Invoice(ctx, remoteURL, remoteUser, amountSats, invoiceMemo)
	//err = fmt.Errorf("force p2p transmission")
	if err != nil {
		srv.log.Debug("couldn't get invoice via lndhub, trying p2p...", zap.String("error", err.Error()))
		account, err := core.DecodePrincipal(remoteUser)
		if err != nil {
			publicErr := fmt.Errorf("couldn't parse accountID string [%s], If using p2p transmission, remoteUser must be a valid accountID", remoteUser)
			srv.log.Debug("error decoding cid "+publicErr.Error(), zap.String("error", err.Error()))
			return "", publicErr
		}
		payReq, err = srv.P2PInvoiceRequest(ctx, account,
			InvoiceRequest{
				AmountSats:   amountSats,
				Memo:         invoiceMemo,
				HoldInvoice:  false,    // TODO: Add support hold invoices
				PreimageHash: []byte{}, // Only aplicable to hold invoices
			})
		if err != nil {
			srv.log.Debug("couldn't get invoice via p2p", zap.String("error", err.Error()))
			return "", fmt.Errorf("After trying to get the invoice locally Could not request invoice via P2P")
		}
	}

	return payReq, nil
}

// CreateLocalInvoice tries to generate an invoice locally from the default wallet The memo field is optional and can be left nil.
func (srv *Service) CreateLocalInvoice(ctx context.Context, account string, amountSats int64, memo *string) (string, error) {
	invoiceMemo := ""
	if memo != nil {
		invoiceMemo = *memo
	}

	defaultWallet, err := srv.GetDefaultWallet(ctx, account)
	if err != nil {
		return "", fmt.Errorf("could not get default wallet to ask for a local invoice")
	}

	if defaultWallet.Type != lndhubsql.LndhubWalletType && defaultWallet.Type != lndhubsql.LndhubGoWalletType {
		err = fmt.Errorf("Wallet type %s not compatible with local invoice creation", defaultWallet.Type)
		srv.log.Debug("couldn't create local invoice: " + err.Error())
		return "", err
	}
	payreq, err := srv.lightningClient.Lndhub.CreateLocalInvoice(ctx, defaultWallet.ID, amountSats, invoiceMemo)
	if err != nil {
		srv.log.Debug("couldn't create local invoice: " + err.Error())
		return "", err
	}
	return payreq, nil
}

// PayInvoice tries to pay the provided invoice. If a walletID is provided, that wallet will be used instead of the default one
// If amountSats is provided, the invoice will be paid with that amount. This amount should be equal to the amount on the invoice
// unless the amount on the invoice is 0.
func (srv *Service) PayInvoice(ctx context.Context, account string, payReq string, walletID *string, amountSats *uint64) (string, error) {
	var walletToPay wallet.Wallet
	var err error
	var amountToPay uint64

	conn, release, err := srv.pool.Conn(ctx)
	if err != nil {
		return "", err
	}
	defer release()

	if walletID != nil {
		walletToPay, err = wallet.GetWallet(conn, *walletID)
		if err != nil {
			publicErr := fmt.Errorf("couldn't get wallet %s", *walletID)
			srv.log.Debug(publicErr.Error(), zap.String("msg", err.Error()))
			return "", publicErr
		}
	} else {
		walletToPay, err = srv.GetDefaultWallet(ctx, account)
		if err != nil {
			return "", fmt.Errorf("couldn't get default wallet to pay")
		}
	}

	if !isSupported(walletToPay.Type) {
		err = fmt.Errorf("wallet type [%s] not supported to pay. Currently supported: [%v]", walletToPay.Type, supportedWallets)
		srv.log.Debug(err.Error())
		return "", err
	}

	if amountSats == nil || *amountSats == 0 {
		invoice, err := lndhub.DecodeInvoice(payReq)
		if err != nil {
			publicError := fmt.Errorf("couldn't decode invoice [%s], please make sure it is a bolt-11 compatible invoice", payReq)
			srv.log.Debug(publicError.Error(), zap.String("msg", err.Error()))
			return "", publicError
		}
		amountToPay = uint64(invoice.MilliSat.ToSatoshis())
	} else {
		amountToPay = *amountSats
	}

	if err = srv.lightningClient.Lndhub.PayInvoice(ctx, walletToPay.ID, payReq, amountToPay); err != nil {
		if strings.Contains(err.Error(), wallet.NotEnoughBalance) {
			return "", fmt.Errorf("couldn't pay invoice with wallet [%s]: %w", walletToPay.Name, lndhubsql.ErrNotEnoughBalance)
		}
		if errors.Is(err, lndhubsql.ErrQtyMissmatch) {
			return "", fmt.Errorf("couldn't pay invoice, quantity in invoice differs from amount to pay [%d] :%w", amountToPay, lndhubsql.ErrQtyMissmatch)
		}
		srv.log.Debug("couldn't pay invoice", zap.String("msg", err.Error()))
		return "", fmt.Errorf("couldn't pay invoice")
	}

	return walletToPay.ID, nil
}

// GetLnAddress gets the account-wide ln address in the form of <nickname>@<domain> .
// Since it is a user operation, if the login is a CID, then user must provide a token representing
// the pubkey whose private counterpart created the signature provided in password (like in create).
func (srv *Service) GetLnAddress(ctx context.Context, account string) (string, error) {
	lnaddress, err := srv.lightningClient.Lndhub.GetLnAddress(ctx, account)
	if err != nil {
		srv.log.Debug("couldn't get lnaddress", zap.String("msg", err.Error()))
		return "", fmt.Errorf("couldn't get lnaddress")
	}
	return lnaddress, nil
}

// DecodeCredentialsURL takes a credential string of the form
// <wallet_type>://<alphanumeric_login>:<alphanumeric_password>@https://<domain>
// lndhub://c227a7fb5c71a22fac33:d2a48ab779aa1b02e858@https://lndhub.io
func DecodeCredentialsURL(url string) (Credentials, error) {
	credentials := Credentials{}

	res := validCredentials.FindStringSubmatch(url)
	if res == nil || len(res) != 5 {
		if res != nil {
			return credentials, fmt.Errorf("credentials contained more than necessary fields. it should be " +
				"<wallet_type>://<alphanumeric_login>:<alphanumeric_password>@https://<domain>")
		}
		return credentials, fmt.Errorf("couldn't parse credentials, probably wrong format. it should be " +
			"<wallet_type>://<alphanumeric_login>:<alphanumeric_password>@https://<domain>")
	}
	credentials.WalletType = strings.ToLower(res[1])
	credentials.Login = res[2]
	credentials.Password = res[3]
	credentials.Domain = res[4]
	return credentials, nil
}

// URL2Id constructs a unique and collision-free ID out of a credentials URL and account.
func URL2Id(url string, account string) string {
	h := sha256.Sum256(append([]byte(url), []byte(account)...))
	return hex.EncodeToString(h[:])
}

// EncodeCredentialsURL generates a credential URL out of credential parameters.
// the resulting url will have this format
// <wallet_type>://<alphanumeric_login>:<alphanumeric_password>@https://<domain>
func EncodeCredentialsURL(creds Credentials) (string, error) {
	url := creds.WalletType + "://" + creds.Login + ":" + creds.Password + "@https://" + creds.Domain
	_, err := DecodeCredentialsURL(url)
	return url, err
}

func isSupported(walletType string) bool {
	var supported bool
	for _, supWalletType := range supportedWallets {
		if walletType == supWalletType {
			supported = true
			break
		}
	}
	return supported
}
