package daemon

import (
	context "context"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"seed/backend/blob"
	"seed/backend/core"
	"seed/backend/core/coretest"
	"seed/backend/storage/keystore"
	taskmanager "seed/backend/daemon/taskmanager"
	daemon "seed/backend/genproto/daemon/v1alpha"
	"seed/backend/storage"
	"sync"
	"testing"
	"time"

	blocks "github.com/ipfs/go-block-format"
	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/libp2p/go-libp2p/core/protocol"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
	"golang.org/x/crypto/argon2"
	"golang.org/x/crypto/chacha20poly1305"
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

func TestForceReindexTracksTaskWhileRemainingActive(t *testing.T) {
	srv := newTestServer(t, "alice")
	srv.taskMgr.UpdateGlobalState(daemon.State_ACTIVE)

	fake := &fakeBlobIndex{
		reindexStarted: make(chan struct{}),
		releaseReindex: make(chan struct{}),
	}
	fake.reindexFn = func(ctx context.Context) error {
		fake.setReindexInfo(blob.ReindexInfo{State: blob.ReindexStateInProgress, BlobsTotal: 10, BlobsIndexed: 4})
		close(fake.reindexStarted)

		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-fake.releaseReindex:
		}

		fake.setReindexInfo(blob.ReindexInfo{State: blob.ReindexStateCompleted, BlobsTotal: 10, BlobsIndexed: 10})
		return nil
	}
	srv.blocks = fake

	errc := make(chan error, 1)
	go func() {
		_, err := srv.ForceReindex(t.Context(), &daemon.ForceReindexRequest{})
		errc <- err
	}()

	<-fake.reindexStarted

	require.Eventually(t, func() bool {
		info, err := srv.GetInfo(t.Context(), &daemon.GetInfoRequest{})
		if err != nil {
			return false
		}

		return info.State == daemon.State_ACTIVE && len(info.Tasks) == 1 && info.Tasks[0].TaskName == daemon.TaskName_REINDEXING
	}, time.Second, 10*time.Millisecond)

	close(fake.releaseReindex)
	require.NoError(t, <-errc)

	require.Eventually(t, func() bool {
		info, err := srv.GetInfo(t.Context(), &daemon.GetInfoRequest{})
		if err != nil {
			return false
		}
		return len(info.Tasks) == 0
	}, time.Second, 10*time.Millisecond)
}

func TestStoreBlobsUnavailableDuringReindex(t *testing.T) {
	srv := newTestServer(t, "alice")
	fake := &fakeBlobIndex{}
	fake.setReindexInfo(blob.ReindexInfo{State: blob.ReindexStateInProgress})
	srv.blocks = fake

	_, err := srv.StoreBlobs(t.Context(), &daemon.StoreBlobsRequest{
		Blobs: []*daemon.Blob{{Data: []byte("hello")}},
	})
	require.Error(t, err)

	stat, ok := status.FromError(err)
	require.True(t, ok)
	require.Equal(t, codes.Unavailable, stat.Code())
	require.Equal(t, 0, fake.putManyCalls)
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

func TestImportKey(t *testing.T) {
	srv := newTestServer(t, "alice")
	ctx := context.Background()

	seed := make([]byte, ed25519.SeedSize)
	for i := range seed {
		seed[i] = byte(i + 1)
	}
	privateKey := ed25519.NewKeyFromSeed(seed)

	filePath := writeImportKeyFile(t, importedKeyFile{
		PublicKey: core.NewPublicKey(privateKey.Public().(ed25519.PublicKey)).String(),
		KeyB64:    base64.RawURLEncoding.EncodeToString(seed),
	}, "valid.hmkey.json")

	resp, err := srv.ImportKey(ctx, &daemon.ImportKeyRequest{FilePath: filePath})
	require.NoError(t, err)
	require.NotEmpty(t, resp.AccountId)
	require.Equal(t, resp.AccountId, resp.Name)
	require.Equal(t, resp.AccountId, resp.PublicKey)

	stored, err := srv.store.KeyStore().GetKey(ctx, resp.AccountId)
	require.NoError(t, err)
	require.Equal(t, resp.AccountId, stored.PublicKey.String())

	t.Run("duplicate import", func(t *testing.T) {
		_, err := srv.ImportKey(ctx, &daemon.ImportKeyRequest{FilePath: filePath})
		require.Error(t, err)
		stat, ok := status.FromError(err)
		require.True(t, ok)
		require.Equal(t, codes.AlreadyExists, stat.Code())
	})

	t.Run("duplicate public key under another name", func(t *testing.T) {
		otherSrv := newTestServer(t, "bob")
		otherCtx := context.Background()
		keyPair := core.NewKeyPair(ed25519.NewKeyFromSeed(seed))
		require.NoError(t, otherSrv.store.KeyStore().StoreKey(otherCtx, "main", keyPair))

		_, err := otherSrv.ImportKey(otherCtx, &daemon.ImportKeyRequest{FilePath: filePath})
		require.Error(t, err)
		stat, ok := status.FromError(err)
		require.True(t, ok)
		require.Equal(t, codes.AlreadyExists, stat.Code())
	})

	t.Run("relative path", func(t *testing.T) {
		_, err := srv.ImportKey(ctx, &daemon.ImportKeyRequest{FilePath: "valid.hmkey.json"})
		require.Error(t, err)
		stat, ok := status.FromError(err)
		require.True(t, ok)
		require.Equal(t, codes.InvalidArgument, stat.Code())
	})

	t.Run("wrong file suffix", func(t *testing.T) {
		wrongExtPath := writeImportKeyFile(t, importedKeyFile{
			PublicKey: core.NewPublicKey(privateKey.Public().(ed25519.PublicKey)).String(),
			KeyB64:    base64.RawURLEncoding.EncodeToString(seed),
		}, "valid.json")

		_, err := srv.ImportKey(ctx, &daemon.ImportKeyRequest{FilePath: wrongExtPath})
		require.Error(t, err)
		stat, ok := status.FromError(err)
		require.True(t, ok)
		require.Equal(t, codes.InvalidArgument, stat.Code())
	})

	t.Run("oversized file", func(t *testing.T) {
		oversizedPath := filepath.Join(t.TempDir(), "oversized.hmkey.json")
		oversizedData := make([]byte, importKeyFileMaxSize+1)
		require.NoError(t, os.WriteFile(oversizedPath, oversizedData, 0600))

		_, err := srv.ImportKey(ctx, &daemon.ImportKeyRequest{FilePath: oversizedPath})
		require.Error(t, err)
		stat, ok := status.FromError(err)
		require.True(t, ok)
		require.Equal(t, codes.InvalidArgument, stat.Code())
	})

	t.Run("missing file", func(t *testing.T) {
		_, err := srv.ImportKey(ctx, &daemon.ImportKeyRequest{FilePath: filepath.Join(t.TempDir(), "missing.hmkey.json")})
		require.Error(t, err)
		stat, ok := status.FromError(err)
		require.True(t, ok)
		require.Equal(t, codes.NotFound, stat.Code())
	})

	t.Run("invalid json", func(t *testing.T) {
		badPath := filepath.Join(t.TempDir(), "bad.hmkey.json")
		require.NoError(t, os.WriteFile(badPath, []byte("{not-json"), 0600))

		_, err := srv.ImportKey(ctx, &daemon.ImportKeyRequest{FilePath: badPath})
		require.Error(t, err)
		stat, ok := status.FromError(err)
		require.True(t, ok)
		require.Equal(t, codes.InvalidArgument, stat.Code())
	})

	t.Run("missing keyB64", func(t *testing.T) {
		path := writeImportKeyFile(t, importedKeyFile{
			PublicKey: core.NewPublicKey(privateKey.Public().(ed25519.PublicKey)).String(),
		}, "missing-key.hmkey.json")

		_, err := srv.ImportKey(ctx, &daemon.ImportKeyRequest{FilePath: path})
		require.Error(t, err)
		stat, ok := status.FromError(err)
		require.True(t, ok)
		require.Equal(t, codes.InvalidArgument, stat.Code())
	})

	t.Run("encrypted file with password", func(t *testing.T) {
		password := "correct horse battery staple"
		path := writeEncryptedImportKeyFile(t, seed, privateKey.Public().(ed25519.PublicKey), password, "encrypted.hmkey.json")
		encryptedSrv := newTestServer(t, "carol")
		encryptedCtx := context.Background()

		resp, err := encryptedSrv.ImportKey(encryptedCtx, &daemon.ImportKeyRequest{FilePath: path, Password: password})
		require.NoError(t, err)
		require.NotEmpty(t, resp.AccountId)
	})

	t.Run("encrypted file missing password", func(t *testing.T) {
		password := "another password"
		path := writeEncryptedImportKeyFile(t, seed, privateKey.Public().(ed25519.PublicKey), password, "encrypted-missing-password.hmkey.json")
		encryptedSrv := newTestServer(t, "carol")
		encryptedCtx := context.Background()

		_, err := encryptedSrv.ImportKey(encryptedCtx, &daemon.ImportKeyRequest{FilePath: path})
		require.Error(t, err)
		stat, ok := status.FromError(err)
		require.True(t, ok)
		require.Equal(t, codes.InvalidArgument, stat.Code())
	})

	t.Run("encrypted file wrong password", func(t *testing.T) {
		password := "right-password"
		path := writeEncryptedImportKeyFile(t, seed, privateKey.Public().(ed25519.PublicKey), password, "encrypted-wrong-password.hmkey.json")
		encryptedSrv := newTestServer(t, "david")
		encryptedCtx := context.Background()

		_, err := encryptedSrv.ImportKey(encryptedCtx, &daemon.ImportKeyRequest{FilePath: path, Password: "wrong-password"})
		require.Error(t, err)
		stat, ok := status.FromError(err)
		require.True(t, ok)
		require.Equal(t, codes.InvalidArgument, stat.Code())
	})

	t.Run("mismatched public key", func(t *testing.T) {
		otherSeed := make([]byte, ed25519.SeedSize)
		for i := range otherSeed {
			otherSeed[i] = byte(i + 100)
		}
		otherPrivateKey := ed25519.NewKeyFromSeed(otherSeed)

		path := writeImportKeyFile(t, importedKeyFile{
			PublicKey: core.NewPublicKey(otherPrivateKey.Public().(ed25519.PublicKey)).String(),
			KeyB64:    base64.RawURLEncoding.EncodeToString(seed),
		}, "mismatch.hmkey.json")

		_, err := srv.ImportKey(ctx, &daemon.ImportKeyRequest{FilePath: path})
		require.Error(t, err)
		stat, ok := status.FromError(err)
		require.True(t, ok)
		require.Equal(t, codes.InvalidArgument, stat.Code())
	})
}

func TestExportKey(t *testing.T) {
	srv := newTestServer(t, "alice")
	ctx := context.Background()

	seed := make([]byte, ed25519.SeedSize)
	for i := range seed {
		seed[i] = byte(i + 1)
	}
	keyPair := core.NewKeyPair(ed25519.NewKeyFromSeed(seed))
	require.NoError(t, srv.RegisterAccount(ctx, "main", keyPair))

	t.Run("exports plaintext file that can be re-imported", func(t *testing.T) {
		filePath := filepath.Join(t.TempDir(), "plaintext.hmkey.json")

		_, err := srv.ExportKey(ctx, &daemon.ExportKeyRequest{
			Name:     "main",
			FilePath: filePath,
		})
		require.NoError(t, err)

		data, err := os.ReadFile(filePath)
		require.NoError(t, err)
		require.Equal(t, byte('\n'), data[len(data)-1])

		otherSrv := newTestServer(t, "bob")
		resp, err := otherSrv.ImportKey(ctx, &daemon.ImportKeyRequest{FilePath: filePath})
		require.NoError(t, err)
		require.Equal(t, keyPair.PublicKey.String(), resp.PublicKey)
	})

	t.Run("exports encrypted file that can be re-imported with password", func(t *testing.T) {
		filePath := filepath.Join(t.TempDir(), "encrypted.hmkey.json")
		password := "correct horse battery staple"

		_, err := srv.ExportKey(ctx, &daemon.ExportKeyRequest{
			Name:     "main",
			FilePath: filePath,
			Password: password,
		})
		require.NoError(t, err)

		var exported exportedKeyFile
		data, err := os.ReadFile(filePath)
		require.NoError(t, err)
		require.NoError(t, json.Unmarshal(data, &exported))
		require.NotNil(t, exported.Encryption)
		require.Equal(t, "argon2id", exported.Encryption.KDF)
		require.Equal(t, "xchacha20poly1305", exported.Encryption.Cipher)

		otherSrv := newTestServer(t, "carol")
		resp, err := otherSrv.ImportKey(ctx, &daemon.ImportKeyRequest{FilePath: filePath, Password: password})
		require.NoError(t, err)
		require.Equal(t, keyPair.PublicKey.String(), resp.PublicKey)
	})

	t.Run("missing key name", func(t *testing.T) {
		_, err := srv.ExportKey(ctx, &daemon.ExportKeyRequest{
			FilePath: filepath.Join(t.TempDir(), "missing-name.hmkey.json"),
		})
		require.Error(t, err)
		stat, ok := status.FromError(err)
		require.True(t, ok)
		require.Equal(t, codes.InvalidArgument, stat.Code())
	})

	t.Run("missing key", func(t *testing.T) {
		_, err := srv.ExportKey(ctx, &daemon.ExportKeyRequest{
			Name:     "unknown",
			FilePath: filepath.Join(t.TempDir(), "missing-key.hmkey.json"),
		})
		require.Error(t, err)
		stat, ok := status.FromError(err)
		require.True(t, ok)
		require.Equal(t, codes.NotFound, stat.Code())
	})

	t.Run("relative path", func(t *testing.T) {
		_, err := srv.ExportKey(ctx, &daemon.ExportKeyRequest{
			Name:     "main",
			FilePath: "relative.hmkey.json",
		})
		require.Error(t, err)
		stat, ok := status.FromError(err)
		require.True(t, ok)
		require.Equal(t, codes.InvalidArgument, stat.Code())
	})

	t.Run("wrong file suffix", func(t *testing.T) {
		_, err := srv.ExportKey(ctx, &daemon.ExportKeyRequest{
			Name:     "main",
			FilePath: filepath.Join(t.TempDir(), "wrong.json"),
		})
		require.Error(t, err)
		stat, ok := status.FromError(err)
		require.True(t, ok)
		require.Equal(t, codes.InvalidArgument, stat.Code())
	})

	t.Run("missing parent directory", func(t *testing.T) {
		_, err := srv.ExportKey(ctx, &daemon.ExportKeyRequest{
			Name:     "main",
			FilePath: filepath.Join(t.TempDir(), "missing", "dir.hmkey.json"),
		})
		require.Error(t, err)
		stat, ok := status.FromError(err)
		require.True(t, ok)
		require.Equal(t, codes.InvalidArgument, stat.Code())
	})
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

	store, err := storage.Open(t.TempDir(), u.Device.Libp2pKey(), keystore.NewMemory(), "debug")
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, store.Close()) })
	tMgr := taskmanager.NewTaskManager()
	idx, err := blob.OpenIndex(t.Context(), store.DB(), zap.NewNop())
	require.NoError(t, err)

	return NewServer(store, &mockedP2PNode{}, idx, nil, tMgr, zap.NewNop())
}

type fakeBlobIndex struct {
	mu             sync.Mutex
	reindexInfo    blob.ReindexInfo
	reindexFn      func(context.Context) error
	putManyErr     error
	putManyCalls   int
	reindexStarted chan struct{}
	releaseReindex chan struct{}
}

func (f *fakeBlobIndex) PutMany(context.Context, []blocks.Block) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.putManyCalls++
	return f.putManyErr
}

func (f *fakeBlobIndex) Reindex(ctx context.Context) error {
	if f.reindexFn != nil {
		return f.reindexFn(ctx)
	}

	return nil
}

func (f *fakeBlobIndex) ReindexInfo() blob.ReindexInfo {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.reindexInfo
}

func (f *fakeBlobIndex) setReindexInfo(info blob.ReindexInfo) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.reindexInfo = info
}

func writeImportKeyFile(t *testing.T, payload importedKeyFile, filename string) string {
	t.Helper()

	data, err := json.Marshal(payload)
	require.NoError(t, err)

	filePath := filepath.Join(t.TempDir(), filename)
	require.NoError(t, os.WriteFile(filePath, data, 0600))
	return filePath
}

func writeEncryptedImportKeyFile(
	t *testing.T,
	seed []byte,
	publicKey ed25519.PublicKey,
	password string,
	filename string,
) string {
	t.Helper()

	salt := []byte("0123456789abcdef")
	params := importedKeyFileArgon2{
		MemoryCost:  64 * 1024,
		TimeCost:    3,
		Parallelism: 4,
		SaltB64:     base64.RawURLEncoding.EncodeToString(salt),
	}
	derivedKey := argon2.IDKey([]byte(password), salt, params.TimeCost, params.MemoryCost, params.Parallelism, chacha20poly1305.KeySize)
	nonce := []byte("123456789012345678901234")
	aead, err := chacha20poly1305.NewX(derivedKey)
	require.NoError(t, err)
	ciphertext := aead.Seal(nil, nonce, seed, nil)
	encrypted := append(append([]byte{}, nonce...), ciphertext...)

	return writeImportKeyFile(t, importedKeyFile{
		PublicKey: core.NewPublicKey(publicKey).String(),
		KeyB64:    base64.RawURLEncoding.EncodeToString(encrypted),
		Encryption: &importedKeyFileEncryption{
			KDF:    "argon2id",
			Argon2: &params,
			Cipher: "xchacha20poly1305",
		},
	}, filename)
}

type mockedP2PNode struct{}

const testProtocolID = "/seed/testing/1.0.0"

func (m *mockedP2PNode) ProtocolID() protocol.ID {
	return protocol.ID(testProtocolID)
}

func (m *mockedP2PNode) ProtocolVersion() string {
	return "1.0.0"
}

func (m *mockedP2PNode) AddrInfo() peer.AddrInfo {
	return peer.AddrInfo{}
}
