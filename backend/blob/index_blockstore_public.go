package blob

import (
	"context"
	"errors"
	"fmt"

	"github.com/ipfs/go-cid"
)

type publicOnlyCtxKey struct{}

// PublicOnlyDeniedError indicates that a blob exists locally but is not public.
type PublicOnlyDeniedError struct {
	CID cid.Cid
}

// Error implements the error interface.
func (e PublicOnlyDeniedError) Error() string {
	return fmt.Sprintf("blob %s is not public", e.CID)
}

// WithPublicOnly sets the public only context value to true.
func WithPublicOnly(ctx context.Context) context.Context {
	return context.WithValue(ctx, publicOnlyCtxKey{}, true)
}

// IsPublicOnly returns true if the context indicates only public blobs should be accessed.
func IsPublicOnly(ctx context.Context) bool {
	return ctx.Value(publicOnlyCtxKey{}) != nil
}

// IsPublicOnlyDenied reports whether err means a blob was rejected by PublicOnly.
func IsPublicOnlyDenied(err error) bool {
	var target PublicOnlyDeniedError
	return errors.As(err, &target)
}
