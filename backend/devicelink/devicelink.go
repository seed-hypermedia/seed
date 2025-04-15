// Package devicelink provides the functionality for linking two devices,
// and creating mutual agent capabilities for each other.
package devicelink

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"seed/backend/blob"
	"seed/backend/core"
	"seed/backend/ipfs"
	"seed/backend/util/cclock"
	"sync"
	"time"

	blocks "github.com/ipfs/go-block-format"
	cbornode "github.com/ipfs/go-ipld-cbor"
	"github.com/libp2p/go-libp2p/core/host"
	"github.com/libp2p/go-libp2p/core/network"
	"github.com/libp2p/go-msgio"
	"github.com/multiformats/go-multibase"
	"github.com/multiformats/go-multicodec"
	"go.uber.org/zap"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// ProtocolID is the libp2p protocol ID for device linking.
const ProtocolID = "/hypermedia/devicelink/0.1.0"

const (
	defaultExpireTime = 2 * time.Minute
	exchangeTimeout   = 1 * time.Minute
)

// Blockstore is a subset of the common blockstore interface.
type Blockstore interface {
	Put(context.Context, blocks.Block) error
	PutMany(context.Context, []blocks.Block) error
}

// Service is a devicelink service.
type Service struct {
	host   host.Host
	keys   core.KeyStore
	log    *zap.Logger
	blocks Blockstore

	mu      sync.Mutex
	session *Session
}

// NewService creates a devicelink service.
func NewService(h host.Host, keys core.KeyStore, bs Blockstore, log *zap.Logger) *Service {
	svc := &Service{
		host:   h,
		keys:   keys,
		log:    log,
		blocks: bs,
	}

	svc.host.SetStreamHandler(ProtocolID, svc.HandleLibp2pStream)

	return svc
}

// NewSession creates a new session replacing any previous session.
func (svc *Service) NewSession(ctx context.Context, keyName string) (*Session, error) {
	if !svc.mu.TryLock() {
		return nil, fmt.Errorf("another session is already being redeemed")
	}
	defer svc.mu.Unlock()

	kp, err := svc.keys.GetKey(ctx, keyName)
	if err != nil {
		return nil, err
	}

	var secret string
	{
		rawToken := make([]byte, 16)
		n, err := rand.Read(rawToken)
		if err != nil {
			return nil, err
		}
		if n != len(rawToken) {
			return nil, status.Errorf(codes.Internal, "failed to generate random token")
		}

		secret, err = multibase.Encode(multibase.Base64url, rawToken)
		if err != nil {
			return nil, err
		}
	}

	s := &Session{
		KeyName:    keyName,
		Account:    kp.Principal(),
		Secret:     secret,
		ExpireTime: time.Now().Add(defaultExpireTime),
	}
	svc.session = s
	return s, nil
}

// HandleLibp2pStream implements the libp2p handler for devicelink protocol.
func (svc *Service) HandleLibp2pStream(s network.Stream) {
	deadline := time.Now().Add(exchangeTimeout)
	_ = s.SetDeadline(deadline)
	ctx, cancel := context.WithDeadline(context.Background(), deadline)
	defer cancel()

	defer s.Close()

	if !svc.mu.TryLock() {
		svc.log.Debug("SessionAlreadyInProgress")
		_ = s.ResetWithError(network.StreamResourceLimitExceeded)
		return
	}
	defer svc.mu.Unlock()

	svc.log.Info("DeviceLinkStarted")

	r := msgio.NewVarintReader(s)
	w := msgio.NewVarintWriter(s)

	err := svc.handleLibp2pStream(ctx, r, w)
	svc.session = nil
	log := svc.log.Info
	if err != nil {
		log = svc.log.Error
		err = errors.Join(err, s.ResetWithError(network.StreamProtocolViolation))
	}
	log("DeviceLinkEnded", zap.Error(err))
}

func (svc *Service) handleLibp2pStream(ctx context.Context, r msgio.Reader, w msgio.Writer) error {
	if svc.session == nil {
		return status.Errorf(codes.FailedPrecondition, "no active session")
	}

	secretRaw, err := r.ReadMsg()
	if err != nil {
		return err
	}

	pkRaw, err := r.ReadMsg()
	if err != nil {
		return err
	}

	if string(secretRaw) != svc.session.Secret {
		return status.Errorf(codes.PermissionDenied, "secret mismatch")
	}

	if time.Now().After(svc.session.ExpireTime) {
		return status.Errorf(codes.Aborted, "session expired")
	}

	remoteKey, err := core.DecodePrincipal(pkRaw)
	if err != nil {
		return err
	}

	me, err := svc.keys.GetKey(context.Background(), svc.session.KeyName)
	if err != nil {
		return err
	}

	// Forward capability.
	fcap, err := blob.NewCapability(me, remoteKey, me.Principal(), "", blob.RoleAgent, "", cclock.New().MustNow())
	if err != nil {
		return err
	}

	if err := w.WriteMsg(fcap.Data); err != nil {
		return err
	}

	// Reverse capability.
	rcapRaw, err := r.ReadMsg()
	if err != nil {
		return err
	}

	rcap := &blob.Capability{}
	if err := cbornode.DecodeInto(rcapRaw, rcap); err != nil {
		return err
	}

	if !rcap.Signer.Equal(remoteKey) {
		return status.Errorf(codes.Aborted, "reverse capability signer mismatch")
	}

	// Profile alias.
	profileRaw, err := r.ReadMsg()
	if err != nil {
		return err
	}

	profile := &blob.Profile{}
	if err := cbornode.DecodeInto(profileRaw, profile); err != nil {
		return err
	}

	if !profile.Signer.Equal(remoteKey) {
		return status.Errorf(codes.Aborted, "profile signer mismatch")
	}

	if !profile.Alias.Equal(me.Principal()) {
		return status.Errorf(codes.Aborted, "profile alias mismatch")
	}

	return svc.blocks.PutMany(ctx, []blocks.Block{
		fcap,
		ipfs.NewBlock(multicodec.DagCbor, rcapRaw),
		ipfs.NewBlock(multicodec.DagCbor, profileRaw),
	})
}

// Session for the devicelink exchange.
type Session struct {
	KeyName    string
	Account    core.Principal
	Secret     string
	ExpireTime time.Time
}
