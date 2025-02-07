// Package payments handles lightning payments.
package payments

import (
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"seed/backend/core"
	payments "seed/backend/genproto/payments/v1alpha"
	"seed/backend/lndhub"
	"seed/backend/lndhub/lndhubsql"
	"seed/backend/wallet/walletsql"
	"strings"

	"google.golang.org/protobuf/types/known/emptypb"

	"go.uber.org/zap"
)

// ListPaidInvoices returns the invoices that the wallet represented by walletID has paid.
func (srv *Server) ListPaidInvoices(ctx context.Context, in *payments.ListInvoicesRequest) (*payments.ListInvoicesResponse, error) {
	conn, release, err := srv.pool.Conn(ctx)
	if err != nil {
		return nil, err
	}
	w, err := walletsql.GetWallet(conn, in.Id)
	if err != nil {
		release()
		srv.log.Debug("couldn't list wallets: " + err.Error())
		return nil, fmt.Errorf("couldn't list wallets")
	}
	release()
	if strings.ToLower(w.Type) != lndhubsql.LndhubWalletType && strings.ToLower(w.Type) != lndhubsql.LndhubGoWalletType {
		err = fmt.Errorf("Couldn't get invoices form wallet type %s", w.Type)
		srv.log.Debug(err.Error())
		return nil, err
	}
	invoices, err := srv.lightningClient.Lndhub.ListPaidInvoices(ctx, in.Id)
	if err != nil {
		srv.log.Debug("couldn't list outgoing invoices: " + err.Error())
		return nil, err
	}

	ret := &payments.ListInvoicesResponse{}
	for _, invoice := range invoices {
		ret.Invoices = append(ret.Invoices, &payments.Invoice{
			PaymentHash:     invoice.PaymentHash,
			PaymentRequest:  invoice.PaymentRequest,
			Description:     invoice.Description,
			DescriptionHash: invoice.DescriptionHash,
			PaymentPreimage: invoice.PaymentPreimage,
			Destination:     invoice.Destination,
			Amount:          invoice.Amount,
			Fee:             invoice.Fee,
			Status:          invoice.Status,
			Type:            invoice.Type,
			ErrorMessage:    invoice.ErrorMessage,
			SettledAt:       invoice.SettledAt,
			ExpiresAt:       invoice.ExpiresAt,
			IsPaid:          invoice.IsPaid,
			Keysend:         invoice.Keysend,
		})
	}
	return ret, nil
}

// ListReceivednvoices returns the incoming invoices that the wallet represented by walletID has received.
func (srv *Server) ListReceivedInvoices(ctx context.Context, in *payments.ListInvoicesRequest) (*payments.ListInvoicesResponse, error) {
	conn, release, err := srv.pool.Conn(ctx)
	if err != nil {
		return nil, err
	}

	w, err := walletsql.GetWallet(conn, in.Id)
	if err != nil {
		release()
		srv.log.Debug("couldn't list wallets: " + err.Error())
		return nil, fmt.Errorf("couldn't list wallets: %w", err)
	}
	release()
	if strings.ToLower(w.Type) != lndhubsql.LndhubWalletType && strings.ToLower(w.Type) != lndhubsql.LndhubGoWalletType {
		err = fmt.Errorf("Couldn't get invoices form wallet type %s", w.Type)
		srv.log.Debug(err.Error())
		return nil, err
	}
	invoices, err := srv.lightningClient.Lndhub.ListReceivedInvoices(ctx, in.Id)
	if err != nil {
		srv.log.Debug("couldn't list incoming invoices: " + err.Error())
		return nil, err
	}
	ret := &payments.ListInvoicesResponse{}
	for _, invoice := range invoices {
		ret.Invoices = append(ret.Invoices, &payments.Invoice{
			PaymentHash:     invoice.PaymentHash,
			PaymentRequest:  invoice.PaymentRequest,
			Description:     invoice.Description,
			DescriptionHash: invoice.DescriptionHash,
			PaymentPreimage: invoice.PaymentPreimage,
			Destination:     invoice.Destination,
			Amount:          invoice.Amount,
			Fee:             invoice.Fee,
			Status:          invoice.Status,
			Type:            invoice.Type,
			ErrorMessage:    invoice.ErrorMessage,
			SettledAt:       invoice.SettledAt,
			ExpiresAt:       invoice.ExpiresAt,
			IsPaid:          invoice.IsPaid,
			Keysend:         invoice.Keysend,
		})
	}
	return ret, nil
}

// RequestLud6Invoice asks a remote peer to issue an invoice. The remote user can be either a lnaddres or a Seed account ID
// First an lndhub invoice request is attempted. If it fails, then a P2P its used to transmit the invoice. In that case,
// Any of the devices associated with the accountID can issue the invoice. The memo field is optional and can be left nil.
func (srv *Server) RequestLud6Invoice(ctx context.Context, in *payments.RequestLud6InvoiceRequest) (*payments.InvoiceResponse, error) {
	invoice := &payments.InvoiceResponse{}
	var err error
	invoice.Payreq, err = srv.lightningClient.Lndhub.RequestLud6Invoice(ctx, in.URL, in.User, in.Amount, in.Memo)
	//err = fmt.Errorf("force p2p transmission")
	if err != nil {
		srv.log.Debug("couldn't get invoice via lndhub, trying p2p...", zap.Error(err))
		account, err := core.DecodePrincipal(in.User)
		if err != nil {
			publicErr := fmt.Errorf("couldn't parse accountID string [%s], If using p2p transmission, User must be a valid accountID", in.User)
			srv.log.Debug("error decoding cid "+publicErr.Error(), zap.Error(err))
			return invoice, publicErr
		}
		invoice.Payreq, err = srv.P2PInvoiceRequest(ctx, account,
			InvoiceRequest{
				AmountSats:   in.Amount,
				Memo:         in.Memo,
				HoldInvoice:  false,    // TODO: Add support hold invoices
				PreimageHash: []byte{}, // Only applicable to hold invoices
			})
		if err != nil {
			srv.log.Debug("couldn't get invoice via p2p", zap.Error(err))
			return invoice, fmt.Errorf("After trying to get the invoice locally Could not request invoice via P2P")
		}
	}

	decodedInvoice, err := lndhub.DecodeInvoice(invoice.Payreq)
	if err != nil {
		publicError := fmt.Errorf("couldn't decode invoice [%s]: %w", invoice.Payreq, err)
		srv.log.Debug("couldn't decode invoice", zap.Error(err))
		return invoice, publicError
	}
	invoice.PaymentHash = hex.EncodeToString((*decodedInvoice.PaymentHash)[:])
	return invoice, nil
}

// DecodeInvoice tries to generate an invoice locally.
func (srv *Server) DecodeInvoice(_ context.Context, in *payments.DecodeInvoiceRequest) (*payments.Invoice, error) {
	invoice, err := lndhub.DecodeInvoice(in.Payreq)
	if err != nil {
		publicError := fmt.Errorf("couldn't decode invoice [%s]: %w", in.Payreq, err)
		srv.log.Debug("couldn't decode invoice", zap.Error(err))
		return nil, publicError
	}
	ret := &payments.Invoice{
		PaymentHash:    hex.EncodeToString(invoice.PaymentHash[:]),
		PaymentRequest: in.Payreq,
		Description:    *(invoice.Description),
		Destination:    hex.EncodeToString(invoice.Destination.SerializeCompressed()[:]),
	}
	if invoice.MilliSat == nil {
		ret.Amount = 0
	} else {
		ret.Amount = int64(invoice.MilliSat.ToSatoshis())
	}
	return ret, nil
}

// CreateInvoice tries to generate an invoice locally.
func (srv *Server) CreateInvoice(ctx context.Context, in *payments.CreateInvoiceRequest) (*payments.InvoiceResponse, error) {
	ret := &payments.InvoiceResponse{}
	wallet, err := srv.GetWallet(ctx, &payments.WalletRequest{Id: in.Id})
	if in.Id == "" && in.Account != "" {
		wallet, err = srv.GetDefaultWallet(ctx, &payments.GetDefaultWalletRequest{Account: in.Account})
		if err != nil {
			return ret, fmt.Errorf("could not get default wallet to ask for a local invoice")
		}
	}
	if err != nil {
		return ret, fmt.Errorf("could not get default wallet to ask for a local invoice")
	}
	if wallet.Type != lndhubsql.LndhubWalletType && wallet.Type != lndhubsql.LndhubGoWalletType {
		err = fmt.Errorf("Wallet type %s not compatible with local invoice creation", wallet.Type)
		srv.log.Debug("couldn't create local invoice: " + err.Error())
		return ret, err
	}

	ret.Payreq, err = srv.lightningClient.Lndhub.CreateLocalInvoice(ctx, wallet.Id, in.Amount, in.Memo)
	if err != nil {
		srv.log.Debug("couldn't create local invoice: " + err.Error())
		return ret, err
	}
	invoice, err := lndhub.DecodeInvoice(ret.Payreq)
	if err != nil {
		publicError := fmt.Errorf("couldn't decode invoice [%s]: %w", ret.Payreq, err)
		srv.log.Debug("couldn't decode invoice", zap.Error(err))
		return ret, publicError
	}
	ret.PaymentHash = hex.EncodeToString((*invoice.PaymentHash)[:])
	return ret, nil
}

// PayInvoice tries to pay the provided invoice. If a walletID is provided, that wallet will be used instead of the default one
// If amountSats is provided, the invoice will be paid with that amount. This amount should be equal to the amount on the invoice
// unless the amount on the invoice is 0.
func (srv *Server) PayInvoice(ctx context.Context, in *payments.PayInvoiceRequest) (*emptypb.Empty, error) {
	walletToPay := &payments.Wallet{}
	var err error
	var amountToPay int64

	if in.Id != "" {
		conn, release, err := srv.pool.Conn(ctx)
		if err != nil {
			return nil, err
		}
		w, err := walletsql.GetWallet(conn, in.Id)
		if err != nil {
			release()
			publicErr := fmt.Errorf("couldn't get wallet %s", in.Id)
			srv.log.Debug("Could not get wallet", zap.Error(publicErr))
			return nil, publicErr
		}
		release()
		walletToPay.Account = w.Account
		walletToPay.Address = w.Address
		walletToPay.Id = w.ID
		walletToPay.Name = w.Name
		walletToPay.Type = w.Type
	} else {
		walletToPay, err = srv.GetDefaultWallet(ctx, &payments.GetDefaultWalletRequest{Account: in.Account})
		if err != nil {
			return nil, fmt.Errorf("couldn't get default wallet to pay")
		}
	}

	if !isSupported(walletToPay.Type) {
		err = fmt.Errorf("wallet type [%s] not supported to pay. Currently supported: [%v]", walletToPay.Type, supportedWallets)
		srv.log.Debug(err.Error())
		return nil, err
	}

	if in.Amount == 0 {
		invoice, err := lndhub.DecodeInvoice(in.Payreq)
		if err != nil {
			publicError := fmt.Errorf("couldn't decode invoice [%s], please make sure it is a bolt-11 compatible invoice", in.Payreq)
			srv.log.Debug(publicError.Error(), zap.String("msg", err.Error()))
			return nil, publicError
		}
		amountToPay = int64(invoice.MilliSat.ToSatoshis())
	} else {
		amountToPay = in.Amount
	}

	if err = srv.lightningClient.Lndhub.PayInvoice(ctx, walletToPay.Id, in.Payreq, amountToPay); err != nil {
		if strings.Contains(err.Error(), walletsql.NotEnoughBalance) {
			return nil, fmt.Errorf("couldn't pay invoice with wallet [%s]: %w", walletToPay.Name, lndhubsql.ErrNotEnoughBalance)
		}
		if errors.Is(err, lndhubsql.ErrQtyMissmatch) {
			return nil, fmt.Errorf("couldn't pay invoice, quantity in invoice differs from amount to pay [%d] :%w", amountToPay, lndhubsql.ErrQtyMissmatch)
		}
		srv.log.Debug("couldn't pay invoice", zap.String("msg", err.Error()))
		return nil, fmt.Errorf("couldn't pay invoice")
	}

	return nil, nil
}
