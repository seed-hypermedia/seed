package daemon

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"seed/backend/blob"
	"seed/backend/core"
	daemonpb "seed/backend/genproto/daemon/v1alpha"
	"seed/backend/storage"
	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"
	"time"

	cbornode "github.com/ipfs/go-ipld-cbor"
	"golang.org/x/crypto/chacha20poly1305"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const (
	// #nosec G101 -- this is the database key name, not the secret value.
	authSecretKVKey     = "daemon-auth-secret"
	authTokenTTL        = 30 * 24 * time.Hour
	authAssertionMaxAge = 5 * time.Minute
)

var authTokenDomainSeparation = []byte("seed-daemon-auth-token")

type authTokenPayload struct {
	Caller     core.Principal `refmt:"caller"`
	IssueTime  int64          `refmt:"iat"`
	ExpireTime int64          `refmt:"exp"`
	Nonce      []byte         `refmt:"nonce"`
}

func init() {
	cbornode.RegisterCborType(authTokenPayload{})
}

// Authenticate implements the corresponding gRPC method.
func (srv *Server) Authenticate(ctx context.Context, req *daemonpb.AuthenticateRequest) (*daemonpb.AuthenticateResponse, error) {
	caller, err := srv.verifyAuthenticationAssertion(ctx, req.GetAccount(), req.GetTimestamp(), req.GetSignature())
	if err != nil {
		return nil, err
	}

	now := time.Now().UTC()
	expires := now.Add(authTokenTTL)
	token, err := srv.mintAuthToken(ctx, caller, now, expires)
	if err != nil {
		return nil, err
	}

	return &daemonpb.AuthenticateResponse{
		BearerToken: token,
		ExpireTime:  timestamppb.New(expires),
	}, nil
}

func (srv *Server) verifyAuthenticationAssertion(ctx context.Context, accountBytes []byte, timestamp int64, sig core.Signature) (core.Principal, error) {
	account, err := core.DecodePrincipal(accountBytes)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "invalid authentication account: %v", err)
	}
	if timestamp == 0 {
		return nil, status.Error(codes.InvalidArgument, "authentication timestamp is required")
	}
	if len(sig) == 0 {
		return nil, status.Error(codes.InvalidArgument, "authentication signature is required")
	}

	expectedAudience, err := core.PrincipalFromPeerID(srv.p2p.AddrInfo().ID)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to resolve daemon audience: %v", err)
	}

	cpb := &blob.Capability{
		BaseBlob: blob.BaseBlob{
			Type:   blob.TypeCapability,
			Signer: account,
			Sig:    sig,
			Ts:     time.UnixMilli(timestamp),
		},
		Delegate: account,
		Audience: expectedAudience,
	}

	now := time.Now().UTC()
	if now.Before(cpb.Ts.Add(-authAssertionMaxAge)) || now.After(cpb.Ts.Add(authAssertionMaxAge)) {
		return nil, status.Error(codes.InvalidArgument, "authentication assertion timestamp is out of range")
	}

	if err := blob.Verify(account, cpb, cpb.Sig); err != nil {
		return nil, status.Errorf(codes.PermissionDenied, "invalid authentication assertion signature: %v", err)
	}

	ok, err := srv.isKnownPrincipal(ctx, account)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, status.Error(codes.PermissionDenied, "authentication principal is not known")
	}

	return account, nil
}

func (srv *Server) mintAuthToken(ctx context.Context, caller core.Principal, issued, expires time.Time) (string, error) {
	secret, err := srv.authSecret(ctx)
	if err != nil {
		return "", err
	}
	aead, err := chacha20poly1305.NewX(secret)
	if err != nil {
		return "", status.Errorf(codes.Internal, "failed to initialize auth token cipher: %v", err)
	}

	nonce := make([]byte, chacha20poly1305.NonceSizeX)
	if _, err := rand.Read(nonce); err != nil {
		return "", status.Errorf(codes.Internal, "failed to create auth token nonce: %v", err)
	}
	payloadNonce := make([]byte, 16)
	if _, err := rand.Read(payloadNonce); err != nil {
		return "", status.Errorf(codes.Internal, "failed to create auth token payload nonce: %v", err)
	}

	payload, err := cbornode.DumpObject(authTokenPayload{
		Caller:     caller,
		IssueTime:  issued.Unix(),
		ExpireTime: expires.Unix(),
		Nonce:      payloadNonce,
	})
	if err != nil {
		return "", status.Errorf(codes.Internal, "failed to encode auth token: %v", err)
	}

	out := make([]byte, 0, len(nonce)+len(payload)+aead.Overhead())
	out = append(out, nonce...)
	out = aead.Seal(out, nonce, payload, authTokenDomainSeparation)
	return base64.RawURLEncoding.EncodeToString(out), nil
}

// AuthenticateBearerToken verifies a daemon bearer token and returns the caller principal.
func (srv *Server) AuthenticateBearerToken(ctx context.Context, token string) (core.Principal, error) {
	raw, err := base64.RawURLEncoding.DecodeString(token)
	if err != nil {
		return nil, status.Error(codes.Unauthenticated, "invalid bearer token encoding")
	}
	if len(raw) <= chacha20poly1305.NonceSizeX {
		return nil, status.Error(codes.Unauthenticated, "invalid bearer token length")
	}

	secret, err := srv.authSecret(ctx)
	if err != nil {
		return nil, err
	}
	aead, err := chacha20poly1305.NewX(secret)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to initialize auth token cipher: %v", err)
	}

	nonce := raw[:chacha20poly1305.NonceSizeX]
	ciphertext := raw[chacha20poly1305.NonceSizeX:]
	plaintext, err := aead.Open(nil, nonce, ciphertext, authTokenDomainSeparation)
	if err != nil {
		return nil, status.Error(codes.Unauthenticated, "invalid bearer token")
	}

	var payload authTokenPayload
	if err := cbornode.DecodeInto(plaintext, &payload); err != nil {
		return nil, status.Error(codes.Unauthenticated, "invalid bearer token payload")
	}
	if len(payload.Caller) == 0 {
		return nil, status.Error(codes.Unauthenticated, "bearer token caller is missing")
	}
	now := time.Now().UTC().Unix()
	if payload.ExpireTime <= now || payload.IssueTime > now+int64(authAssertionMaxAge.Seconds()) {
		return nil, status.Error(codes.Unauthenticated, "bearer token expired")
	}

	ok, err := srv.isKnownPrincipal(ctx, payload.Caller)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, status.Error(codes.Unauthenticated, "bearer token principal is not known")
	}

	return payload.Caller, nil
}

func (srv *Server) authSecret(ctx context.Context) ([]byte, error) {
	var secret []byte
	err := srv.store.DB().WithTx(ctx, func(conn *sqlite.Conn) error {
		raw, err := storage.GetKV(ctx, conn, authSecretKVKey)
		if err != nil {
			return status.Errorf(codes.Internal, "failed to load daemon auth secret: %v", err)
		}
		if raw != "" {
			secret, err = base64.RawURLEncoding.DecodeString(raw)
			if err != nil || len(secret) != chacha20poly1305.KeySize {
				return status.Error(codes.Internal, "stored daemon auth secret is invalid")
			}
			return nil
		}

		secret = make([]byte, chacha20poly1305.KeySize)
		if _, err := rand.Read(secret); err != nil {
			return status.Errorf(codes.Internal, "failed to create daemon auth secret: %v", err)
		}
		encoded := base64.RawURLEncoding.EncodeToString(secret)
		if err := storage.SetKV(ctx, conn, authSecretKVKey, encoded, false); err != nil {
			return status.Errorf(codes.Internal, "failed to store daemon auth secret: %v", err)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return secret, nil
}

func (srv *Server) isKnownPrincipal(ctx context.Context, principal core.Principal) (bool, error) {
	var known bool
	err := srv.store.DB().WithSave(ctx, func(conn *sqlite.Conn) error {
		return sqlitex.Exec(conn, "SELECT 1 FROM public_keys WHERE principal = ? LIMIT 1", func(*sqlite.Stmt) error {
			known = true
			return nil
		}, []byte(principal))
	})
	if err != nil {
		return false, status.Errorf(codes.Internal, "failed to check authentication principal: %v", err)
	}
	return known, nil
}
