package daemon

import (
	context "context"
	"seed/backend/blob"
	"seed/backend/core"
	"seed/backend/core/coretest"
	daemon "seed/backend/genproto/daemon/v1alpha"
	"seed/backend/storage"
	"testing"

	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/libp2p/go-libp2p/core/protocol"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestGenMnemonic(t *testing.T) {
	srv := newTestServer(t, "alice")
	ctx := context.Background()

	resp, err := srv.GenMnemonic(ctx, &daemon.GenMnemonicRequest{WordCount: 18})
	require.NoError(t, err)
	require.Equal(t, 18, len(resp.Mnemonic))
}

func TestGetInfo(t *testing.T) {
	srv := newTestServer(t, "alice")
	ctx := context.Background()

	resp, err := srv.GetInfo(ctx, &daemon.GetInfoRequest{})
	require.NoError(t, err)

	require.Equal(t, testProtocolID, resp.ProtocolId)
}

func TestRegister(t *testing.T) {
	testMnemonic := []string{"satisfy", "quit", "charge", "arrest", "prevent", "credit", "wreck", "amount", "swim", "snow", "system", "cluster", "skull", "slight", "dismiss"}
	testPassphrase := "testpass"
	srv := newTestServer(t, "alice")
	ctx := context.Background()

	resp, err := srv.RegisterKey(ctx, &daemon.RegisterKeyRequest{
		Name:       "main",
		Mnemonic:   testMnemonic,
		Passphrase: testPassphrase,
	})
	require.NoError(t, err)
	require.Equal(t, "z6MkujA2tVCu6hcYvnuehpVZuhijVXNAqHgk3rpYtsgxebeb", resp.PublicKey)

	_, err = srv.RegisterKey(ctx, &daemon.RegisterKeyRequest{
		Name:     "main",
		Mnemonic: testMnemonic,
	})
	require.Error(t, err, "calling Register more than once must fail")

	stat, ok := status.FromError(err)
	require.True(t, ok)
	require.Equal(t, codes.AlreadyExists, stat.Code())
}

func TestSignData(t *testing.T) {
	srv := newTestServer(t, "alice")
	ctx := context.Background()

	// Store the test key that was generated by coretest.NewTester
	u := coretest.NewTester("alice")
	err := srv.RegisterAccount(ctx, "main", u.Device)
	require.NoError(t, err)

	// Test successful signing
	testData := []byte("hello world")
	resp, err := srv.SignData(ctx, &daemon.SignDataRequest{
		SigningKeyName: "main",
		Data:           testData,
	})
	require.NoError(t, err)
	require.NotNil(t, resp)
	require.NotEmpty(t, resp.Signature)

	// Test error cases
	t.Run("missing key name", func(t *testing.T) {
		_, err := srv.SignData(ctx, &daemon.SignDataRequest{
			Data: testData,
		})
		require.Error(t, err)
		stat, ok := status.FromError(err)
		require.True(t, ok)
		require.Equal(t, codes.InvalidArgument, stat.Code())
	})

	t.Run("missing data", func(t *testing.T) {
		_, err := srv.SignData(ctx, &daemon.SignDataRequest{
			SigningKeyName: "main",
		})
		require.Error(t, err)
		stat, ok := status.FromError(err)
		require.True(t, ok)
		require.Equal(t, codes.InvalidArgument, stat.Code())
	})

	t.Run("non-existent key", func(t *testing.T) {
		_, err := srv.SignData(ctx, &daemon.SignDataRequest{
			SigningKeyName: "non-existent-key",
			Data:           testData,
		})
		require.Error(t, err)
		stat, ok := status.FromError(err)
		require.True(t, ok)
		require.Equal(t, codes.NotFound, stat.Code())
	})
}

func newTestServer(t *testing.T, name string) *Server {
	u := coretest.NewTester(name)

	store, err := storage.Open(t.TempDir(), u.Device.Libp2pKey(), core.NewMemoryKeyStore(), "debug")
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, store.Close()) })

	idx, err := blob.OpenIndex(t.Context(), store.DB(), zap.NewNop())
	require.NoError(t, err)

	return NewServer(store, &mockedP2PNode{}, idx, nil)
}

type mockedP2PNode struct{}

const testProtocolID = "/seed/testing/1.0.0"

func (m *mockedP2PNode) ForceSync() error {
	return nil
}

func (m *mockedP2PNode) ProtocolID() protocol.ID {
	return protocol.ID(testProtocolID)
}

func (m *mockedP2PNode) ProtocolVersion() string {
	return "1.0.0"
}

func (m *mockedP2PNode) AddrInfo() peer.AddrInfo {
	return peer.AddrInfo{}
}
