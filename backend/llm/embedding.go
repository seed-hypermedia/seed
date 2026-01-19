package llm

import (
	"context"
	"errors"
)

type Backend interface {
	LoadModel(ctx context.Context, model string, force bool) (int, int, error)
	Embed(ctx context.Context, inputs []string) ([][]float32, error)
	Version(ctx context.Context) (string, error)
}

var errNotImplemented = errors.New("not implemented")

func IndexEmbeddings(ctx context.Context, backend Backend, inputs []string) error {
	return errNotImplemented
}
