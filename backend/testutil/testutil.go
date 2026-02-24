// Package testutil defines some useful function for testing only.
package testutil

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	regular_sync "sync"
	"testing"
	"unicode"
	"unicode/utf8"

	"github.com/google/go-cmp/cmp"
	"github.com/google/go-cmp/cmp/cmpopts"
	blockstore "github.com/ipfs/boxo/blockstore"
	"github.com/ipfs/go-cid"
	"github.com/ipfs/go-datastore"
	"github.com/ipfs/go-datastore/sync"
	"github.com/multiformats/go-multihash"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"
	"google.golang.org/protobuf/proto"
)

// MakeCID with specified data.
func MakeCID(t *testing.T, data string) cid.Cid {
	t.Helper()
	return MakeCIDWithCodec(t, cid.Raw, data)
}

// MakeCIDWithCodec makes CID with a given codec.
func MakeCIDWithCodec(t *testing.T, codec uint64, data string) cid.Cid {
	t.Helper()
	mh, err := multihash.Sum([]byte(data), multihash.IDENTITY, -1)
	require.NoError(t, err)

	return cid.NewCidV1(codec, mh)
}

// MakeRepoPath for testing..
func MakeRepoPath(t testing.TB) string {
	t.Helper()

	dir, err := os.MkdirTemp("", "seed-repo-*")
	require.NoError(t, err)

	t.Cleanup(func() {
		require.NoError(t, os.RemoveAll(dir))
	})

	return dir
}

// MakeBlockStore creates a new in-memory block store for tests.
func MakeBlockStore(t *testing.T) blockstore.Blockstore {
	return blockstore.NewBlockstore(MakeDatastore(t))
}

// MakeDatastore creates a new in-memory datastore.
func MakeDatastore(t *testing.T) *FakeTxnDatastore {
	t.Helper()
	return &FakeTxnDatastore{sync.MutexWrap(datastore.NewMapDatastore())}
}

// FakeTxnDatastore implements wraps a datastore with fake transactions.
type FakeTxnDatastore struct {
	datastore.Batching
}

// NewTransaction implements TxnDatastore.
func (ds *FakeTxnDatastore) NewTransaction(readOnly bool) (datastore.Txn, error) {
	return &fakeTxn{ds}, nil
}

type fakeTxn struct {
	datastore.Datastore
}

func (txn *fakeTxn) Commit(ctx context.Context) error {
	return nil
}

func (txn *fakeTxn) Discard(ctx context.Context) {}

// ProtoEqual will check if want and got are equal Protobuf messages.
// For some weird reason they made Messages uncomparable using normal mechanisms.
//
// Deprecated: use StructsEqual instead.
func ProtoEqual(t *testing.T, want, got proto.Message, msg string, format ...interface{}) {
	t.Helper()

	diff := cmp.Diff(want, got, ExportedFieldsFilter())
	if diff != "" {
		t.Log(diff)
		t.Fatalf(msg, format...)
	}
}

// StructsEqualBuilder is a fluent interface for comparing structs.
type StructsEqualBuilder[T any] struct {
	a    T
	b    T
	opts []cmp.Option
}

// StructsEqual compares two structs of the same time for equality. It allows to specify field names to ignore.
func StructsEqual[T any](a, b T) *StructsEqualBuilder[T] {
	return &StructsEqualBuilder[T]{a: a, b: b, opts: []cmp.Option{ExportedFieldsFilter()}}
}

// IgnoreFields allows to ignore fields on a certain type.
// Type must be non-pointer value.
func (sb *StructsEqualBuilder[T]) IgnoreFields(_type any, fields ...string) *StructsEqualBuilder[T] {
	sb.opts = append(sb.opts, cmpopts.IgnoreFields(_type, fields...))
	return sb
}

// IgnoreTypes allows to ignore fields on a certain type.
// Type must be non-pointer value.
func (sb *StructsEqualBuilder[T]) IgnoreTypes(typs ...any) *StructsEqualBuilder[T] {
	sb.opts = append(sb.opts, cmpopts.IgnoreTypes(typs...))
	return sb
}

// Diff returns a diff between the two structs.
func (sb *StructsEqualBuilder[T]) Diff() string {
	return cmp.Diff(sb.a, sb.b, sb.opts...)
}

// IsEqual is like Compare but just returns a boolean.
func (sb *StructsEqualBuilder[T]) IsEqual() bool {
	diff := cmp.Diff(sb.a, sb.b, sb.opts...)
	return diff == ""
}

// Compare executes the final comparison.
func (sb *StructsEqualBuilder[T]) Compare(t *testing.T, msg string, format ...any) {
	t.Helper()

	diff := cmp.Diff(sb.a, sb.b, sb.opts...)
	if diff != "" {
		t.Log(diff)
		t.Fatalf(msg, format...)
	}
}

// CompareNot ensures that structs are not equal.
func (sb *StructsEqualBuilder[T]) CompareNot(t *testing.T, msg string, format ...any) {
	t.Helper()

	diff := cmp.Diff(sb.a, sb.b, sb.opts...)
	if diff == "" {
		t.Fatalf(msg, format...)
	}
}

// ExportedFieldsFilter is a go-cmp Option which ignores recursively unexported fields.
func ExportedFieldsFilter() cmp.Option {
	return cmp.FilterPath(func(p cmp.Path) bool {
		sf, ok := p.Index(-1).(cmp.StructField)
		if !ok {
			return false
		}
		r, _ := utf8.DecodeRuneInString(sf.Name())
		return !unicode.IsUpper(r)
	}, cmp.Ignore())
}

// MockedGRPCServerStream is a mocked gRPC server stream for testing server-side streaming gRPC methods.
type MockedGRPCServerStream[T proto.Message] struct {
	C   chan T
	ctx context.Context
	grpc.ServerStream
}

// NewMockedGRPCServerStream creates a new instance of MockedGRPCServerStream.
func NewMockedGRPCServerStream[T proto.Message](ctx context.Context) *MockedGRPCServerStream[T] {
	return &MockedGRPCServerStream[T]{
		C:   make(chan T, 10),
		ctx: ctx,
	}
}

// Context returns the context of the stream.
func (m *MockedGRPCServerStream[T]) Context() context.Context {
	return m.ctx
}

// Send implements a gRPC stream.
func (m *MockedGRPCServerStream[T]) Send(msg T) error {
	if m.C == nil {
		panic("BUG: MockedGRPCServerStream.Send called without initializing channel")
	}

	m.C <- msg
	return nil
}

// Manual marks the test to run only if it's triggered manually, either with -run flag or by IDE.
func Manual(t *testing.T) {
	tname := t.Name()
	for _, arg := range os.Args {
		if strings.Contains(arg, "__debug_bin") {
			return
		}
		runValue, ok := strings.CutPrefix(arg, "-test.run=")
		if !ok {
			continue
		}

		if strings.Contains(runValue, tname) {
			return
		}
	}

	t.Skip("manual test is skipped")
}

type mockEmbedRequest struct {
	Model string   `json:"model"`
	Input []string `json:"input"`
}

type mockPullRequest struct {
	Model  string `json:"model"`
	Stream *bool  `json:"stream"`
}

// MockOllamaServer is a test double for an Ollama HTTP server.
type MockOllamaServer struct {
	Server *httptest.Server

	Mu regular_sync.Mutex

	BatchSizes     []int
	LoadedModels   []string
	SeenEmbeddings int
	ShowRequests   int
	EmbedRequests  int
	embeddingDims  int
	contextSize    int

	FirstEmbedOnce regular_sync.Once
	FirstEmbedDone chan struct{}
}

// MockOllamaServerOption configures MockOllamaServer.
type MockOllamaServerOption func(*MockOllamaServer)

// WithMockOllamaEmbeddingDims sets the embedding dimensions for the mock server.
func WithMockOllamaEmbeddingDims(dims int) MockOllamaServerOption {
	return func(s *MockOllamaServer) {
		if dims > 0 {
			s.embeddingDims = dims
		}
	}
}

// WithMockOllamaContextSize sets the context size for the mock server.
func WithMockOllamaContextSize(size int) MockOllamaServerOption {
	return func(s *MockOllamaServer) {
		if size > 0 {
			s.contextSize = size
		}
	}
}

// NewMockOllamaServer creates a new mock Ollama HTTP server for testing.
func NewMockOllamaServer(t *testing.T, opts ...MockOllamaServerOption) *MockOllamaServer {
	t.Helper()

	s := &MockOllamaServer{
		embeddingDims:  384,
		contextSize:    2048,
		FirstEmbedDone: make(chan struct{}),
	}
	for _, opt := range opts {
		opt(s)
	}

	s.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/pull":
			var request mockPullRequest
			require.NoError(t, json.NewDecoder(r.Body).Decode(&request))
			require.NotEmpty(t, request.Model)
			require.NotNil(t, request.Stream)
			require.False(t, *request.Stream)

			s.Mu.Lock()
			s.LoadedModels = append(s.LoadedModels, request.Model)
			s.Mu.Unlock()

			w.Header().Set("Content-Type", "application/json")
			require.NoError(t, json.NewEncoder(w).Encode(map[string]string{"status": "success"}))
		case "/api/show":
			var request mockPullRequest
			require.NoError(t, json.NewDecoder(r.Body).Decode(&request))
			require.NotEmpty(t, request.Model)

			s.Mu.Lock()
			s.ShowRequests++
			embeddingDims := s.embeddingDims
			contextSize := s.contextSize
			s.Mu.Unlock()
			w.Header().Set("Content-Type", "application/json")
			require.NoError(t, json.NewEncoder(w).Encode(map[string]any{
				"model_info": map[string]any{
					"gemma3.embedding_length": embeddingDims,
					"gemma3.context_length":   contextSize,
				},
				"capabilities": []string{"embedding"},
			}))
		case "/api/embed":
			var request mockEmbedRequest
			require.NoError(t, json.NewDecoder(r.Body).Decode(&request))
			require.NotEmpty(t, request.Model)

			s.Mu.Lock()
			s.EmbedRequests++
			s.BatchSizes = append(s.BatchSizes, len(request.Input))
			embeddingDims := s.embeddingDims
			s.Mu.Unlock()
			response := make([][]float32, 0, len(request.Input))
			for _, input := range request.Input {
				vec := make([]float32, embeddingDims)
				if embeddingDims > 0 {
					vec[0] = float32(len(input))
				}
				response = append(response, vec)
			}

			s.Mu.Lock()
			s.SeenEmbeddings += len(response)
			s.Mu.Unlock()

			w.Header().Set("Content-Type", "application/json")
			require.NoError(t, json.NewEncoder(w).Encode(map[string]any{"embeddings": response}))

			s.FirstEmbedOnce.Do(func() {
				close(s.FirstEmbedDone)
			})
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))

	return s
}
