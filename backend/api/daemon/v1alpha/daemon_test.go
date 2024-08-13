package daemon

import (
	context "context"
	"seed/backend/core"
	"seed/backend/core/coretest"
	daemon "seed/backend/genproto/daemon/v1alpha"
	"seed/backend/storage"
	"testing"

	"github.com/stretchr/testify/require"
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

func newTestServer(t *testing.T, name string) *Server {
	u := coretest.NewTester(name)

	store, err := storage.Open(t.TempDir(), u.Device.Wrapped(), core.NewMemoryKeyStore(), "debug")
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, store.Close()) })

	return NewServer(store, &mockedWallet{}, nil)
}

type mockedWallet struct{}

func (w *mockedWallet) ConfigureSeedLNDHub(context.Context, core.KeyPair) error {
	return nil
}
