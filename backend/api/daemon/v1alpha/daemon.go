// Package daemon assembles everything to boot the seed-daemon program. It's like main, but made a separate package
// to be importable and testable by other packages, because package main can't be imported.
package daemon

import (
	context "context"
	"fmt"
	"seed/backend/blob"
	"seed/backend/core"
	"seed/backend/devicelink"
	daemon "seed/backend/genproto/daemon/v1alpha"
	"seed/backend/ipfs"
	"seed/backend/storage"
	"seed/backend/util/colx"
	sync "sync"
	"time"

	blocks "github.com/ipfs/go-block-format"
	"github.com/ipfs/go-cid"
	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/libp2p/go-libp2p/core/protocol"
	"github.com/multiformats/go-multiaddr"
	"github.com/multiformats/go-multicodec"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	status "google.golang.org/grpc/status"
	emptypb "google.golang.org/protobuf/types/known/emptypb"
	timestamppb "google.golang.org/protobuf/types/known/timestamppb"
)

// Node is a subset of the p2p node.
type Node interface {
	AddrInfo() peer.AddrInfo
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
	store     *storage.Store
	startTime time.Time
	blocks    *blob.Index

	p2p   Node
	dlink *devicelink.Service

	// Mainly to ensure there's only one registration request at a time.
	mu sync.Mutex
}

// NewServer creates a new Server.
func NewServer(store *storage.Store, n Node, idx *blob.Index, dlink *devicelink.Service) *Server {
	if n == nil {
		panic("BUG: p2p node is required")
	}

	return &Server{
		store:     store,
		startTime: time.Now(),
		// wallet:        w, // TODO(hm24): Put the wallet back.
		p2p:    n,
		blocks: idx,
		dlink:  dlink,
	}
}

// RegisterServer registers the server with the gRPC server.
func (srv *Server) RegisterServer(rpc grpc.ServiceRegistrar) {
	daemon.RegisterDaemonServer(rpc, srv)
}

// SyncResourceWithPeer implements the corresponding gRPC method.
func (srv *Server) SyncResourceWithPeer(_ context.Context, req *daemon.SyncResourceWithPeerRequest) (*emptypb.Empty, error) {
	return nil, status.Errorf(codes.Unimplemented, "SyncResourceWithPeer is not implemented yet")
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

	acc, err := core.KeyPairFromMnemonic(req.Mnemonic, req.Passphrase)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "failed to create account: %v", err)
	}

	if req.Name == "" {
		req.Name = acc.PublicKey.String()
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

// ForceReindex implements the corresponding gRPC method.
func (srv *Server) ForceReindex(ctx context.Context, in *daemon.ForceReindexRequest) (*daemon.ForceReindexResponse, error) {
	if err := srv.blocks.Reindex(ctx); err != nil {
		return nil, err
	}

	return &daemon.ForceReindexResponse{}, nil
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

// CreateDeviceLinkSession implements the corresponding gRPC method.
func (srv *Server) CreateDeviceLinkSession(ctx context.Context, in *daemon.CreateDeviceLinkSessionRequest) (*daemon.DeviceLinkSession, error) {
	if in.SigningKeyName == "" {
		return nil, status.Errorf(codes.InvalidArgument, "signing key name is required")
	}

	sess, err := srv.dlink.NewSession(ctx, in.SigningKeyName, in.Label)
	if err != nil {
		return nil, err
	}

	return srv.sessionToProto(sess), nil
}

// GetDeviceLinkSession implements the corresponding gRPC method.
func (srv *Server) GetDeviceLinkSession(ctx context.Context, in *daemon.GetDeviceLinkSessionRequest) (*daemon.DeviceLinkSession, error) {
	sess, err := srv.dlink.Session()
	if err != nil {
		return nil, err
	}

	return srv.sessionToProto(sess), nil
}

func (srv *Server) sessionToProto(sess devicelink.Session) *daemon.DeviceLinkSession {
	pinfo := srv.p2p.AddrInfo()

	pb := &daemon.DeviceLinkSession{
		AddrInfo: &daemon.AddrInfo{
			PeerId: pinfo.ID.String(),
			Addrs:  colx.SliceMap(pinfo.Addrs, multiaddr.Multiaddr.String),
		},
		SecretToken: sess.Secret,
		AccountId:   sess.Account.String(),
		Label:       sess.Label,
		ExpireTime:  timestamppb.New(sess.ExpireTime),
	}

	if !sess.RedeemTime.IsZero() {
		pb.RedeemTime = timestamppb.New(sess.RedeemTime)
	}

	return pb
}

// SignData implements the corresponding gRPC method.
func (srv *Server) SignData(ctx context.Context, in *daemon.SignDataRequest) (*daemon.SignDataResponse, error) {
	if in.SigningKeyName == "" {
		return nil, status.Errorf(codes.InvalidArgument, "signing key name is required")
	}

	if len(in.Data) == 0 {
		return nil, status.Errorf(codes.InvalidArgument, "data to sign is required")
	}

	keyPair, err := srv.store.KeyStore().GetKey(ctx, in.SigningKeyName)
	if err != nil {
		return nil, status.Errorf(codes.NotFound, "key %s: %v", in.SigningKeyName, err)
	}

	signature, err := keyPair.Sign(in.Data)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to sign data: %v", err)
	}

	return &daemon.SignDataResponse{
		Signature: signature,
	}, nil
}
