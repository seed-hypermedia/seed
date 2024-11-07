// Package daemon assembles everything to boot the seed-daemon program. It's like main, but made a separate package
// to be importable and testable by other packages, because package main can't be imported.
package daemon

import (
	context "context"
	"seed/backend/core"
	daemon "seed/backend/genproto/daemon/v1alpha"
	sync "sync"
	"time"

	"github.com/libp2p/go-libp2p/core/protocol"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	status "google.golang.org/grpc/status"
	emptypb "google.golang.org/protobuf/types/known/emptypb"
	timestamppb "google.golang.org/protobuf/types/known/timestamppb"
)

// Storage is a subset of the [ondisk.OnDisk] used by this server.
type Storage interface {
	Device() core.KeyPair
	KeyStore() core.KeyStore
}

// Node is a subset of the p2p node.
type Node interface {
	ForceSync() error
	ProtocolID() protocol.ID
	ProtocolVersion() string
}

// Server implements the Daemon gRPC API.
type Server struct {
	store     Storage
	startTime time.Time

	p2p Node

	mu sync.Mutex // we only want one register request at a time.
}

// NewServer creates a new Server.
func NewServer(store Storage, n Node) *Server {
	if n == nil {
		panic("BUG: p2p node is required")
	}

	return &Server{
		store:     store,
		startTime: time.Now(),
		// wallet:        w, // TODO(hm24): Put the wallet back.
		p2p: n,
	}
}

// RegisterServer registers the server with the gRPC server.
func (srv *Server) RegisterServer(rpc grpc.ServiceRegistrar) {
	daemon.RegisterDaemonServer(rpc, srv)
}

// GenMnemonic returns a set of mnemonic words based on bip39 schema. Word count should be 12 or 15 or 18 or 21 or 24.
func (srv *Server) GenMnemonic(_ context.Context, req *daemon.GenMnemonicRequest) (*daemon.GenMnemonicResponse, error) {
	if req.WordCount == 0 {
		req.WordCount = 12
	}

	words, err := core.NewBIP39Mnemonic(uint32(req.WordCount))
	if err != nil {
		return nil, err
	}

	return &daemon.GenMnemonicResponse{Mnemonic: words}, nil
}

// RegisterKey implement the corresponding gRPC method.
func (srv *Server) RegisterKey(ctx context.Context, req *daemon.RegisterKeyRequest) (*daemon.NamedKey, error) {
	// We only want one concurrent register request to happen.
	srv.mu.Lock()
	defer srv.mu.Unlock()

	if req.Name == "" {
		return nil, status.Errorf(codes.InvalidArgument, "name is required for a key")
	}

	acc, err := core.AccountFromMnemonic(req.Mnemonic, req.Passphrase)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "failed to create account: %v", err)
	}

	if err := srv.RegisterAccount(ctx, req.Name, acc); err != nil {
		return nil, err
	}

	return &daemon.NamedKey{
		PublicKey: acc.Principal().String(),
		Name:      req.Name,
		AccountId: acc.Principal().String(),
	}, nil
}

// DeleteKey implement the corresponding gRPC method.
func (srv *Server) DeleteKey(ctx context.Context, req *daemon.DeleteKeyRequest) (*emptypb.Empty, error) {
	return &emptypb.Empty{}, srv.store.KeyStore().DeleteKey(ctx, req.Name)
}

// DeleteAllKeys implement the corresponding gRPC method.
func (srv *Server) DeleteAllKeys(ctx context.Context, req *daemon.DeleteAllKeysRequest) (*emptypb.Empty, error) {
	return &emptypb.Empty{}, srv.store.KeyStore().DeleteAllKeys(ctx)
}

// ListKeys implement the corresponding gRPC method.
func (srv *Server) ListKeys(ctx context.Context, req *daemon.ListKeysRequest) (*daemon.ListKeysResponse, error) {
	//var ret []*daemon.NamedKey
	out := &daemon.ListKeysResponse{}
	keys, err := srv.store.KeyStore().ListKeys(ctx)
	if err != nil {
		return out, err
	}
	out.Keys = make([]*daemon.NamedKey, 0, len(keys))
	for _, key := range keys {
		out.Keys = append(out.Keys, &daemon.NamedKey{
			Name:      key.Name,
			PublicKey: key.PublicKey.String(),
			AccountId: key.PublicKey.String(),
		})
	}
	return out, nil
}

// UpdateKey implement the corresponding gRPC method.
func (srv *Server) UpdateKey(ctx context.Context, req *daemon.UpdateKeyRequest) (*daemon.NamedKey, error) {
	if err := srv.store.KeyStore().ChangeKeyName(ctx, req.CurrentName, req.NewName); err != nil {
		return &daemon.NamedKey{}, err
	}

	kp, err := srv.store.KeyStore().GetKey(ctx, req.NewName)
	if err != nil {
		return &daemon.NamedKey{}, err
	}

	return &daemon.NamedKey{
		PublicKey: kp.PublicKey.String(),
		Name:      req.NewName,
		AccountId: kp.PublicKey.String(),
	}, nil
}

func (srv *Server) RegisterAccount(ctx context.Context, name string, kp core.KeyPair) error {
	if kp, err := srv.store.KeyStore().GetKey(ctx, name); err == nil || kp.PeerID() != "" {
		return status.Errorf(codes.AlreadyExists, "key with name %s already exists: %v", name, err)
	}

	if err := srv.store.KeyStore().StoreKey(ctx, name, kp); err != nil {
		return err
	}

	return nil
}

// GetInfo implements the corresponding gRPC method.
func (srv *Server) GetInfo(context.Context, *daemon.GetInfoRequest) (*daemon.Info, error) {
	resp := &daemon.Info{
		PeerId:     srv.store.Device().PeerID().String(),
		StartTime:  timestamppb.New(srv.startTime),
		State:      daemon.State_ACTIVE, // TODO(hm24): handle the state correctly, providing feedback for database migrations.
		ProtocolId: string(srv.p2p.ProtocolID()),
	}

	return resp, nil
}

// ForceSync implements the corresponding gRPC method.
func (srv *Server) ForceSync(context.Context, *daemon.ForceSyncRequest) (*emptypb.Empty, error) {
	if srv.p2p == nil {
		return &emptypb.Empty{}, status.Error(codes.FailedPrecondition, "force sync function is not set")
	}

	if err := srv.p2p.ForceSync(); err != nil {
		return &emptypb.Empty{}, err
	}

	return &emptypb.Empty{}, nil
}
