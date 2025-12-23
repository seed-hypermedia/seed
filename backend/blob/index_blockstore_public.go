package blob

import (
	"context"
)

type publicOnlyCtxKey struct{}

// WithPublicOnly sets the public only context value to true.
func WithPublicOnly(ctx context.Context) context.Context {
	return context.WithValue(ctx, publicOnlyCtxKey{}, true)
}

// IsPublicOnly returns true if the context indicates only public blobs should be accessed.
func IsPublicOnly(ctx context.Context) bool {
	return ctx.Value(publicOnlyCtxKey{}) != nil
}
