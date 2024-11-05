package payments

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"seed/backend/core"
	payments "seed/backend/genproto/payments/v1alpha"
	"seed/backend/lndhub"
	"seed/backend/lndhub/lndhubsql"
	"seed/backend/mttnet"
	"seed/backend/wallet/walletsql"
	"strings"

	"seed/backend/util/sqlite/sqlitex"

	"github.com/ipfs/go-cid"
	"go.uber.org/zap"
	"google.golang.org/grpc"
	"google.golang.org/protobuf/types/known/emptypb"
)

var (
	errAlreadyLndhubgoWallet = errors.New("Only one lndhub.go wallet is allowed and we already had one")
	supportedWallets         = []string{lndhubsql.LndhubWalletType, lndhubsql.LndhubGoWalletType}
	validCredentials         = regexp.MustCompile(`([A-Za-z0-9_\-\.]+):\/\/([0-9A-Za-z]+):([0-9a-f]+)@https:\/\/([A-Za-z0-9_\-\.]+)\/?$`)
)

// AccountID is a handy alias of Cid.
type AccountID = cid.Cid

// Server wraps everything necessary to deliver a wallet service.
type Server struct {
	lightningClient lnclient
	pool            *sqlitex.Pool
	net             *mttnet.Node
	log             *zap.Logger
	ks              core.KeyStore
}

// Credentials struct holds all we need to connect to different lightning nodes (lndhub, LND, core-lightning, ...).
type Credentials struct {
	Domain     string `json:"domain"`
	WalletType string `json:"wallettype"`
	Login      string `json:"login"`
	Password   string `json:"password"`
	Nickname   string `json:"nickname,omitempty"`
}

// NewServer is the constructor of the wallet service.
func NewServer(log *zap.Logger, db *sqlitex.Pool, net *mttnet.Node, ks core.KeyStore, mainnet bool) *Server {
	lndhubDomain := "ln.testnet.mintter.com"
	lnaddressDomain := "ln.testnet.mintter.com"
	if mainnet {
		//lndhubDomain is the domain for internal lndhub calls.
		lndhubDomain = "ln.mintter.com"
		lnaddressDomain = "ln.mintter.com"
	}
	srv := &Server{
		pool: db,
		lightningClient: lnclient{
			Lndhub: lndhub.NewClient(&http.Client{}, db, lndhubDomain, lnaddressDomain),
		},
		net: net,
		log: log,
		ks:  ks,
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

// RegisterServer registers the server with the gRPC server.
func (srv *Server) RegisterServer(rpc grpc.ServiceRegistrar) {
	payments.RegisterWalletsServer(rpc, srv)
	payments.RegisterInvoicesServer(rpc, srv)
}

// P2PInvoiceRequest requests a remote account to issue an invoice so we can pay it.
// Any of the devices associated with the remote account can issue it. For each
// associated device we found online ,we ask if it can provide an invoice.
// If for some reason, that device cannot create the invoice (insufficient
// inbound liquidity) we ask the next device. We return in the first device that
// can issue the invoice. If none of them can, then an error is raised.
func (srv *Server) P2PInvoiceRequest(_ context.Context, account core.Principal, request InvoiceRequest) (string, error) {
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
// account). If the account was set with a password, then the same password has to be inserted here.
func (srv *Server) CreateWallet(ctx context.Context, in *payments.CreateWalletRequest) (ret *payments.Wallet, err error) {
	kp, err := srv.ks.GetKey(ctx, in.Account)
	if err != nil {
		return ret, fmt.Errorf("Problems with provided account: %w", err)
	}
	signature, err := kp.Sign([]byte(lndhub.SigningMessage))
	if err != nil {
		return ret, fmt.Errorf("Could not sign the login phrase with the provided account: %w", err)
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
	return srv.ImportWallet(ctx, &payments.ImportWalletRequest{
		CredentialsUrl: credentialsURL,
		Account:        creds.Login,
		Name:           in.Name,
	})

}

// ImportWallet first tries to connect to the wallet with the provided credentials.
// ImportWallet returns the wallet actually inserted on success. The credentials are stored
// in plain text at the moment.
func (srv *Server) ImportWallet(ctx context.Context, in *payments.ImportWalletRequest) (*payments.Wallet, error) {
	ret := &payments.Wallet{}
	creds, err := DecodeCredentialsURL(in.CredentialsUrl)
	if err != nil {
		srv.log.Debug(err.Error())
		return ret, err
	}

	if !isSupported(creds.WalletType) {
		err = fmt.Errorf(" wallet type [%s] not supported. Currently supported: [%v]", creds.WalletType, supportedWallets)
		srv.log.Debug(err.Error())
		return ret, err
	}

	principal, err := core.DecodePrincipal(in.Account)
	if err != nil {
		return ret, fmt.Errorf("Wrong account %s: %w", in.Account, err)
	}
	_, bynaryAcc := principal.Explode()
	if err != nil {
		return ret, fmt.Errorf("Problem getting bytes from public key %s: %w", principal.String(), err)
	}
	ret.Id = URL2Id(in.CredentialsUrl, in.Account)

	conn, release, err := srv.pool.Conn(ctx)
	if err != nil {
		return ret, err
	}
	defer release()

	ret.Type = creds.WalletType
	ret.Address = "https://" + creds.Domain
	ret.Name = in.Name
	ret.Account = in.Account
	if creds.WalletType == lndhubsql.LndhubGoWalletType {
		// Only one lndhub.go wallet is allowed
		wallets, err := srv.ListWallets(ctx, &payments.ListWalletsRequest{Account: in.Account})
		if err != nil {
			srv.log.Debug(err.Error())
			return ret, err
		}
		for i := 0; i < len(wallets.Wallets); i++ {
			if wallets.Wallets[i].Type == lndhubsql.LndhubGoWalletType && wallets.Wallets[i].Account == in.Account {
				err = fmt.Errorf("Only one type of %s wallet is allowed per account: %w", lndhubsql.LndhubGoWalletType, errAlreadyLndhubgoWallet)
				srv.log.Debug(err.Error())
				return ret, err
			}
		}
		if creds.Nickname == "" {
			creds.Nickname = creds.Login
		}
		newWallet, err := srv.lightningClient.Lndhub.Create(ctx, ret.Address, ret.Id, creds.Login, creds.Password, creds.Nickname, bynaryAcc)
		if err != nil {
			srv.log.Warn("couldn't insert wallet", zap.String("Login", creds.Login), zap.String("Nickname", creds.Nickname), zap.Error(err))
			return ret, err
		}
		creds.Nickname = newWallet.Nickname
	}
	wallet2insert := walletsql.Wallet{
		ID:      ret.Id,
		Account: ret.Account,
		Address: ret.Address,
		Name:    ret.Name,
		Type:    ret.Type,
	}
	if err = walletsql.InsertWallet(conn, wallet2insert, []byte(creds.Login), []byte(creds.Password), bynaryAcc); err != nil {
		srv.log.Debug("couldn't insert wallet", zap.String("msg", err.Error()))
		if errors.Is(err, walletsql.ErrDuplicateIndex) {
			return ret, fmt.Errorf("couldn't insert wallet %s in the database. ID already exists", in.Name)
		}
		return ret, fmt.Errorf("couldn't insert wallet %s in the database", in.Name)
	}

	// Trying to authenticate with the provided credentials
	_, err = srv.lightningClient.Lndhub.Auth(ctx, ret.Id)
	if err != nil {
		_ = walletsql.RemoveWallet(conn, ret.Id)
		srv.log.Warn("couldn't authenticate new wallet", zap.String("msg", err.Error()))
		return ret, fmt.Errorf("couldn't authenticate new wallet %s", in.Name)
	}
	return ret, err
}

// ListWallets returns all the wallets available in the database. If includeBalance is true, then
// ListWallets will also include the balance one every lndhub-like wallet. If false,then the call
// is quicker but no balance information will appear. If account is not blank, it will return only
// wallets from that account.
func (srv *Server) ListWallets(ctx context.Context, in *payments.ListWalletsRequest) (*payments.ListWalletsResponse, error) {
	ret := &payments.ListWalletsResponse{Wallets: []*payments.Wallet{}}
	conn, release, err := srv.pool.Conn(ctx)
	if err != nil {
		return nil, err
	}
	defer release()

	wallets, err := walletsql.ListWallets(conn, in.Account, -1)
	if err != nil {
		srv.log.Debug("couldn't list wallets", zap.String("msg", err.Error()))
		return nil, fmt.Errorf("couldn't list wallets")
	}
	for _, w := range wallets {
		ret.Wallets = append(ret.Wallets, &payments.Wallet{
			Id:      w.ID,
			Account: w.Account,
			Address: w.Address,
			Name:    w.Name,
			Type:    w.Type,
		})
	}
	return ret, nil
}

// RemoveWallet deletes the wallet given a valid ID string representing
// the url hash in case of Lndhub-type wallet or the pubkey in case of LND.
// If the removed wallet was the default wallet, a random wallet will be
// chosen as new default. Although it is advised that the user manually
// changes the default wallet after removing the previous default.
func (srv *Server) RemoveWallet(ctx context.Context, in *payments.WalletRequest) (*emptypb.Empty, error) {
	conn, release, err := srv.pool.Conn(ctx)
	if err != nil {
		return nil, err
	}
	defer release()

	if err := walletsql.RemoveWallet(conn, in.Id); err != nil {
		return nil, fmt.Errorf("couldn't remove wallet %s", in.Id)
	}
	// TODO: remove associated token db entries
	return nil, nil
}

// GetWalletBalance tries to contact the wallet's address to get the
// current balance in Satoshis.
func (srv *Server) GetWalletBalance(ctx context.Context, in *payments.WalletRequest) (*payments.GetWalletBalanceResponse, error) {
	ret := &payments.GetWalletBalanceResponse{}
	conn, release, err := srv.pool.Conn(ctx)
	if err != nil {
		return ret, err
	}
	defer release()

	wallet, err := walletsql.GetWallet(conn, in.Id)
	if err != nil {
		return ret, fmt.Errorf("Can't get the wallet with id %s", in.Id)
	}
	if wallet.Type != lndhubsql.LndhubGoWalletType && wallet.Type != lndhubsql.LndhubWalletType {
		return ret, fmt.Errorf("Wallet type %s is not eligible to get balance", wallet.Type)
	}
	ret.Balance, err = srv.lightningClient.Lndhub.GetBalance(ctx, in.Id)
	if err != nil {
		srv.log.Debug("couldn't get wallet balance", zap.String("msg", err.Error()))
		return ret, fmt.Errorf("couldn't get balance for wallet %s", in.Id)
	}
	return ret, nil
}

// UpdateWalletName updates an existing wallet's name with the one provided.
// If the wallet represented by the id id does not exist, this function
// returns error. nil otherwise, along with the updated wallet.
func (srv *Server) UpdateWalletName(ctx context.Context, in *payments.UpdateWalletNameRequest) (*payments.Wallet, error) {
	ret := &payments.Wallet{}
	conn, release, err := srv.pool.Conn(ctx)
	if err != nil {
		return ret, err
	}
	defer release()

	updatedWallet, err := walletsql.UpdateWalletName(conn, in.Id, in.Name)
	if err != nil {
		srv.log.Debug("couldn't update wallet", zap.String("msg", err.Error()))
		return ret, fmt.Errorf("couldn't update wallet %s", in.Id)
	}
	ret.Account = updatedWallet.Account
	ret.Address = updatedWallet.Address
	ret.Id = updatedWallet.ID
	ret.Name = updatedWallet.Name
	ret.Type = updatedWallet.Type
	return ret, nil
}

// SetDefaultWallet sets the default wallet to the one that matches walletID.
// Previous default wallet is replaced by the new one so only one can be
// the default at any given time. The default wallet is the first wallet ever
// created until manually changed.
func (srv *Server) SetDefaultWallet(ctx context.Context, in *payments.SetDefaultWalletRequest) (*payments.Wallet, error) {
	ret := &payments.Wallet{}
	conn, release, err := srv.pool.Conn(ctx)
	if err != nil {
		return ret, err
	}
	defer release()

	updatedWallet, err := walletsql.UpdateDefaultWallet(conn, in.Account, in.Id)
	if err != nil {
		srv.log.Warn("couldn't set default wallet: " + err.Error())
		return ret, err
	}
	ret.Account = updatedWallet.Account
	ret.Address = updatedWallet.Address
	ret.Id = updatedWallet.ID
	ret.Name = updatedWallet.Name
	ret.Type = updatedWallet.Type
	return ret, err
}

// ExportWallet returns the wallet credentials in uri format so the user can import it
// to an external app. the uri format is:
// <wallet_type>://<alphanumeric_login>:<alphanumeric_password>@https://<domain>
// lndhub://c227a7fb5c71a22fac33:d2a48ab779aa1b02e858@https://lndhub.io
// If the ID is empty, then the builtin wallet is exported.
func (srv *Server) ExportWallet(ctx context.Context, in *payments.WalletRequest) (*payments.ExportWalletResponse, error) {
	ret := &payments.ExportWalletResponse{}
	conn, release, err := srv.pool.Conn(ctx)
	if err != nil {
		return ret, err
	}
	defer release()
	if in.Id == "" {
		return ret, fmt.Errorf("Wallet ID cannot be empty")
	}
	login, err := lndhubsql.GetLogin(conn, in.Id)
	if err != nil {
		srv.log.Debug(err.Error())
		return ret, err
	}
	password, err := lndhubsql.GetPassword(conn, in.Id)
	if err != nil {
		srv.log.Debug(err.Error())
		return ret, err
	}
	url, err := lndhubsql.GetAPIURL(conn, in.Id)
	if err != nil {
		srv.log.Debug(err.Error())
		return ret, err
	}
	splitURL := strings.Split(url, "//")
	if len(splitURL) != 2 {
		err = fmt.Errorf("Could not export wallet, unexpected url format [%s]", url)
		srv.log.Debug(err.Error())
		return ret, err
	}
	ret.Credentials, err = EncodeCredentialsURL(Credentials{
		Domain:     splitURL[1],
		WalletType: lndhubsql.LndhubWalletType,
		Login:      login,
		Password:   password,
	})

	if err != nil {
		srv.log.Debug("couldn't encode uri: " + err.Error())
		return ret, err
	}
	return ret, nil
}

// UpdateLNAddress updates nickname on the lndhub.go database
// The update can fail if the nickname contain special characters or is already taken by another user.
// Since it is a user operation, if the login is a CID, then user must provide a token representing
// the pubkey whose private counterpart created the signature provided in password (like in create).
func (srv *Server) UpdateLNAddress(ctx context.Context, nickname, walletID string) error {
	conn, release, err := srv.pool.Conn(ctx)
	if err != nil {
		return err
	}
	defer release()
	w, err := walletsql.GetWallet(conn, walletID)
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
func (srv *Server) GetDefaultWallet(ctx context.Context, in *payments.GetDefaultWalletRequest) (*payments.Wallet, error) {
	ret := &payments.Wallet{}
	conn, release, err := srv.pool.Conn(ctx)
	if err != nil {
		return ret, err
	}
	defer release()

	w, err := walletsql.GetDefaultWallet(conn, in.Account)
	if err != nil {
		srv.log.Debug("couldn't getDefaultWallet: " + err.Error())
		return ret, err
	}
	ret.Account = w.Account
	ret.Address = w.Address
	ret.Id = w.ID
	ret.Name = w.Name
	ret.Type = w.Type
	return ret, nil
}

// GetWallet gets a specific wallet.
func (srv *Server) GetWallet(ctx context.Context, in *payments.WalletRequest) (*payments.Wallet, error) {
	ret := &payments.Wallet{}
	conn, release, err := srv.pool.Conn(ctx)
	if err != nil {
		return ret, err
	}
	defer release()

	w, err := walletsql.GetWallet(conn, in.Id)
	if err != nil {
		srv.log.Debug("couldn't getWallet: " + err.Error())
		return ret, err
	}
	ret.Account = w.Account
	ret.Address = w.Address
	ret.Id = w.ID
	ret.Name = w.Name
	ret.Type = w.Type
	return ret, nil
}

// GetLnAddress gets the account-wide ln address in the form of <nickname>@<domain> .
// Since it is a user operation, if the login is a CID, then user must provide a token representing
// the pubkey whose private counterpart created the signature provided in password (like in create).
func (srv *Server) GetLnAddress(ctx context.Context, walletID string) (string, error) {
	lnaddress, err := srv.lightningClient.Lndhub.GetLnAddress(ctx, walletID)
	if err != nil {
		srv.log.Debug("couldn't get lnaddress", zap.Error(err))
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
