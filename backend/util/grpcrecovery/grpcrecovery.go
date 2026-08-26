// Package grpcrecovery turns panics raised while serving a gRPC request into
// ordinary Internal errors, so that one bad request can't take down the process.
//
// Go's default is the opposite: an unrecovered panic kills the whole program,
// and grpc-go does not recover handler panics on its own. That makes every
// panic reachable from request-handling code a whole-daemon outage triggerable
// by whoever sent the request. Both of the daemon's gRPC servers parse data
// that originated elsewhere — documents fetched through the public API, and
// blobs pushed by arbitrary peers over the p2p network — so "this can never
// happen" assertions deep in that code are assertions about other people's
// bytes. We have already been bitten by one: a single imported document with
// an oversized move op crashed the production gateway repeatedly through plain
// GetDocument calls (#909, #910).
//
// This package is the net for the next one, not a substitute for fixing it.
// A recovered panic still means the request failed and something is wrong; it
// just costs one RPC instead of the node.
//
// The interceptors delegate the recovery mechanics to go-grpc-middleware but
// keep Seed's recovery policy here: log the panic and stack with the RPC method,
// then return a generic Internal error without exposing those details to the
// caller. Keeping that policy in one wrapper makes the daemon and p2p servers
// behave consistently without duplicating security-sensitive options at each
// call site.
package grpcrecovery

import (
	"context"
	"runtime/debug"

	"github.com/grpc-ecosystem/go-grpc-middleware/v2/interceptors/recovery"
	"go.uber.org/zap"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// UnaryServerInterceptor recovers panics from unary handlers.
//
// Install it as the *last* interceptor in the chain, i.e. the one closest to
// the handler. Recovering there means the outer metrics and tracing
// interceptors see a normal Internal error return and record the failed call,
// whereas recovering outermost would let the panic unwind straight through
// them and the RPC would go unaccounted for.
func UnaryServerInterceptor(log *zap.Logger) grpc.UnaryServerInterceptor {
	return recovery.UnaryServerInterceptor(handler(log))
}

// StreamServerInterceptor recovers panics from streaming handlers.
// The ordering note on [UnaryServerInterceptor] applies here too.
func StreamServerInterceptor(log *zap.Logger) grpc.StreamServerInterceptor {
	return recovery.StreamServerInterceptor(handler(log))
}

func handler(log *zap.Logger) recovery.Option {
	return recovery.WithRecoveryHandlerContext(func(ctx context.Context, p any) error {
		// grpc-go puts the transport stream on the handler's context, which is
		// the only way to name the method from here: the recovery hook is
		// handed the panic value and the context, not the grpc.*ServerInfo.
		method, _ := grpc.Method(ctx)

		// debug.Stack() is called from the deferred function that recovered, so
		// it still walks the frames that panicked. Without it the panic site is
		// lost — the error below deliberately doesn't carry it.
		log.Error("GRPCHandlerPanic",
			zap.String("method", method),
			zap.Any("panic", p),
			zap.ByteString("stack", debug.Stack()),
		)

		// The panic value and stack go to our logs, not over the wire: they
		// name internal symbols and would be attacker-visible otherwise. This
		// is also why we don't use the library's default handler, which returns
		// the full stack to the caller as the status message.
		return status.Error(codes.Internal, "internal error")
	})
}
