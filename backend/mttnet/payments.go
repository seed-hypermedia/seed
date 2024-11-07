package mttnet

import (
	"context"
	p2p "seed/backend/genproto/p2p/v1alpha"
	invoices "seed/backend/genproto/payments/v1alpha"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// Invoicer is a subset of a Lightning node that allows to issue invoices.
// It is used when a remote peer wants to pay our node.
type Invoicer interface {
	CreateInvoice(ctx context.Context, in *invoices.CreateInvoiceRequest) (*invoices.Payreq, error)
}

// RequestInvoice creates a local invoice.
func (srv *rpcMux) RequestInvoice(ctx context.Context, in *p2p.RequestInvoiceRequest) (*p2p.RequestInvoiceResponse, error) {
	n := srv.Node
	if n.invoicer == nil {
		return nil, status.Errorf(codes.Unimplemented, "method RequestInvoice not ready yet")
	}
	req := invoices.CreateInvoiceRequest{
		Account: in.Account,
		Amount:  in.AmountSats,
		Memo:    in.Memo,
	}
	invoice, err := n.invoicer.CreateInvoice(ctx, &req)
	if err != nil {
		return nil, err
	}

	return &p2p.RequestInvoiceResponse{
		PayReq: invoice.Payreq,
	}, nil
}
