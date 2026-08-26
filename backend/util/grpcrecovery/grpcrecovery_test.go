package grpcrecovery_test

import (
	"context"
	"net"
	"seed/backend/util/grpcrecovery"
	"testing"

	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
	"go.uber.org/zap/zaptest/observer"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/status"
	"google.golang.org/grpc/test/bufconn"
	"google.golang.org/protobuf/types/known/emptypb"
)

const (
	testService = "seed.test.v1.Recovery"
	panicMethod = "/" + testService + "/Panic"
	okMethod    = "/" + testService + "/Ok"
)

// The panic value must never reach the client, so it's distinctive enough to
// assert its absence from the wire error.
const panicValue = "boom-from-the-handler"

// A hand-written service descriptor keeps this test free of generated code:
// nothing here needs a real proto service, only a method that panics and one
// that doesn't.
var testServiceDesc = grpc.ServiceDesc{
	ServiceName: testService,
	HandlerType: (*any)(nil),
	Methods: []grpc.MethodDesc{
		{MethodName: "Panic", Handler: unaryHandler(panicMethod, func() (any, error) {
			panic(panicValue)
		})},
		{MethodName: "Ok", Handler: unaryHandler(okMethod, func() (any, error) {
			return &emptypb.Empty{}, nil
		})},
	},
}

func unaryHandler(method string, fn func() (any, error)) func(any, context.Context, func(any) error, grpc.UnaryServerInterceptor) (any, error) {
	return func(srv any, ctx context.Context, dec func(any) error, interceptor grpc.UnaryServerInterceptor) (any, error) {
		in := new(emptypb.Empty)
		if err := dec(in); err != nil {
			return nil, err
		}
		h := func(context.Context, any) (any, error) { return fn() }
		if interceptor == nil {
			return h(ctx, in)
		}
		return interceptor(ctx, in, &grpc.UnaryServerInfo{Server: srv, FullMethod: method}, h)
	}
}

// A panicking handler must cost exactly one failed RPC: the client gets an
// Internal error, the server goes on serving, and the details needed to debug
// it land in the log rather than on the wire.
func TestUnaryServerKeepsServingAfterPanic(t *testing.T) {
	t.Parallel()

	core, logs := observer.New(zap.ErrorLevel)
	lis := bufconn.Listen(1024 * 1024)

	srv := grpc.NewServer(grpc.ChainUnaryInterceptor(grpcrecovery.UnaryServerInterceptor(zap.New(core))))
	srv.RegisterService(&testServiceDesc, struct{}{})
	go func() { _ = srv.Serve(lis) }()
	t.Cleanup(srv.Stop)

	cc, err := grpc.NewClient("passthrough:///bufnet",
		grpc.WithTransportCredentials(insecure.NewCredentials()),
		grpc.WithContextDialer(func(ctx context.Context, _ string) (net.Conn, error) {
			return lis.DialContext(ctx)
		}),
	)
	require.NoError(t, err)
	t.Cleanup(func() { _ = cc.Close() })

	ctx := context.Background()

	err = cc.Invoke(ctx, panicMethod, &emptypb.Empty{}, &emptypb.Empty{})
	require.Error(t, err, "a panicking handler must surface as an error, not kill the process")
	require.Equal(t, codes.Internal, status.Code(err))
	require.NotContains(t, err.Error(), panicValue, "the panic value must not be sent to the caller")
	require.NotContains(t, err.Error(), "goroutine", "the stack trace must not be sent to the caller")

	// The whole point: the connection and the server are still usable.
	require.NoError(t, cc.Invoke(ctx, okMethod, &emptypb.Empty{}, &emptypb.Empty{}),
		"the server must keep serving after recovering a panic")

	entries := logs.FilterMessage("RecoveredPanicInGRPCHandler").All()
	require.Len(t, entries, 1, "the recovered panic must be logged exactly once")

	fields := entries[0].ContextMap()
	require.Equal(t, panicMethod, fields["method"], "the log must name the method that panicked")
	require.Equal(t, panicValue, fields["panic"])
	// The stack is captured after recover(), so it has to walk back past the
	// runtime's panic frame into the handler that raised it — otherwise it
	// would only show the interceptor and the panic site would be lost.
	require.Contains(t, fields["stack"], "panic(")
	require.Contains(t, fields["stack"], "grpcrecovery_test.go",
		"the stack must still reach back to the frames that panicked")
}

type fakeStream struct {
	grpc.ServerStream
	ctx context.Context
}

func (s fakeStream) Context() context.Context { return s.ctx }

func TestStreamServerInterceptorRecovers(t *testing.T) {
	t.Parallel()

	core, logs := observer.New(zap.ErrorLevel)
	interceptor := grpcrecovery.StreamServerInterceptor(zap.New(core))

	err := interceptor(
		struct{}{},
		fakeStream{ctx: context.Background()},
		&grpc.StreamServerInfo{FullMethod: panicMethod},
		func(any, grpc.ServerStream) error { panic(panicValue) },
	)

	require.Error(t, err)
	require.Equal(t, codes.Internal, status.Code(err))
	require.NotContains(t, err.Error(), panicValue)
	require.Len(t, logs.FilterMessage("RecoveredPanicInGRPCHandler").All(), 1)
}
