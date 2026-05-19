package blob

import (
	"context"
	"seed/backend/core"
	"seed/backend/util/ctxkey"
)

var authenticatedCallerCtxKey = ctxkey.New("blob.AuthenticatedCaller", core.Principal(nil))

// WithAuthenticatedCaller adds a verified caller principal to the context.
func WithAuthenticatedCaller(ctx context.Context, caller core.Principal) context.Context {
	return authenticatedCallerCtxKey.WithValue(ctx, caller)
}

// GetAuthenticatedCaller returns the verified caller principal from the context.
func GetAuthenticatedCaller(ctx context.Context) (core.Principal, bool) {
	return authenticatedCallerCtxKey.ValueOk(ctx)
}
