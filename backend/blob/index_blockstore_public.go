package blob

import (
	"context"
	"errors"
	"fmt"
	"seed/backend/util/ctxkey"

	"github.com/ipfs/go-cid"
)

var serverModeCtxKey = ctxkey.New("blob.ServerMode", false)

// ServerModeDeniedError indicates that a blob exists locally but is not public.
type ServerModeDeniedError struct {
	CID cid.Cid
}

// Error implements the error interface.
func (e ServerModeDeniedError) Error() string {
	return fmt.Sprintf("blob %s is not public", e.CID)
}

// WithServerMode enables server-mode blob visibility checks.
func WithServerMode(ctx context.Context) context.Context {
	return serverModeCtxKey.WithValue(ctx, true)
}

// IsServerMode reports whether the context requests server-mode blob visibility checks.
func IsServerMode(ctx context.Context) bool {
	return serverModeCtxKey.Value(ctx)
}

// IsServerModeDenied reports whether err means a blob was rejected by ServerMode.
func IsServerModeDenied(err error) bool {
	var target ServerModeDeniedError

	return errors.As(err, &target)
}
