// Package daemon assembles everything to boot the seed-daemon program. It's like main, but made a separate package
// to be importable and testable by other packages, because package main can't be imported.
package daemon

import (
	context "context"
	"fmt"
	"seed/backend/core"
	daemon "seed/backend/genproto/daemon/v1alpha"
	"seed/backend/ipfs"
	sync "sync"
	"time"

	blocks "github.com/ipfs/go-block-format"
	"github.com/ipfs/go-cid"
	"github.com/libp2p/go-libp2p/core/protocol"
	"github.com/multiformats/go-multicodec"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	status "google.golang.org/grpc/status"
	emptypb "google.golang.org/protobuf/types/known/emptypb"
	timestamppb "google.golang.org/protobuf/types/known/timestamppb"
)

// Storage is a subset of the [ondisk.OnDisk] used by this server.
type Storage interface {
	Device() *core.KeyPair
	KeyStore() core.KeyStore
}

// Node is a subset of the p2p node.
type Node interface {
	ForceSync() error
	ProtocolID() protocol.ID
	ProtocolVersion() string
}

// Blockstore is a subset of the IPFS blockstore.
type Blockstore interface {
	PutMany(context.Context, []blocks.Block) error
}

// Server implements the Daemon gRPC API.
type Server struct {
	store     Storage
	startTime time.Time
	blocks    Blockstore

	p2p Node

	mu sync.Mutex // we only want one register request at a time.
}

// NewServer creates a new Server.
func NewServer(store Storage, n Node, bs Blockstore) *Server {
	if n == nil {
		panic("BUG: p2p node is required")
	}

	return &Server{
		store:     store,
		startTime: time.Now(),
		// wallet:        w, // TODO(hm24): Put the wallet back.
		p2p:    n,
		blocks: bs,
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

	acc, err := core.KeyPairFromMnemonic(req.Mnemonic, req.Passphrase)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "failed to create account: %v", err)
	}

	if err := srv.RegisterAccount(ctx, req.Name, acc); err != nil {
		return nil, err
	}

	return &daemon.NamedKey{
		PublicKey: acc.PublicKey.String(),
		Name:      req.Name,
		AccountId: acc.PublicKey.String(),
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
	out := &daemon.ListKeysResponse{}
	keys, err := srv.store.KeyStore().ListKeys(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to list keys: %w", err)
	}
	out.Keys = make([]*daemon.NamedKey, len(keys))
	for i, key := range keys {
		out.Keys[i] = &daemon.NamedKey{
			Name:      key.Name,
			PublicKey: key.PublicKey.String(),
			AccountId: key.PublicKey.String(),
		}
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

// RegisterAccount stores the keypair in the key store.
func (srv *Server) RegisterAccount(ctx context.Context, name string, kp *core.KeyPair) error {
	if kp, err := srv.store.KeyStore().GetKey(ctx, name); err == nil || kp != nil {
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
		return nil, status.Error(codes.FailedPrecondition, "force sync function is not set")
	}

	if err := srv.p2p.ForceSync(); err != nil {
		return nil, err
	}

	return &emptypb.Empty{}, nil
}

// StoreBlobs implements the corresponding gRPC method.
func (srv *Server) StoreBlobs(ctx context.Context, in *daemon.StoreBlobsRequest) (*daemon.StoreBlobsResponse, error) {
	blks := make([]blocks.Block, len(in.Blobs))
	for i, b := range in.Blobs {
		if b.Cid != "" {
			c, err := cid.Decode(b.Cid)
			if err != nil {
				return nil, status.Errorf(codes.InvalidArgument, "failed to decode cid at index %d: %v", i, err)
			}

			cc, err := c.Prefix().Sum(b.Data)
			if err != nil {
				return nil, status.Errorf(codes.Internal, "failed to hash data at index %d: %v", i, err)
			}

			if !c.Equals(cc) {
				return nil, status.Errorf(codes.InvalidArgument, "cid at index %d doesn't match its data", i)
			}

			blks[i], err = blocks.NewBlockWithCid(b.Data, cc)
			if err != nil {
				return nil, status.Errorf(codes.Internal, "failed to process block at index %d: %v", i, err)
			}
		} else {
			blks[i] = ipfs.NewBlock(multicodec.DagCbor, b.Data)
		}
	}

	if err := srv.blocks.PutMany(ctx, blks); err != nil {
		return nil, status.Errorf(codes.Internal, "failed to store blocks: %v", err)
	}

	resp := &daemon.StoreBlobsResponse{
		Cids: make([]string, len(blks)),
	}

	for i, b := range blks {
		resp.Cids[i] = b.Cid().String()
	}

	return resp, nil
}
