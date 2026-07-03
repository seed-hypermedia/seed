package documents

import (
	"context"
	"seed/backend/blob"
	"seed/backend/config"
	"seed/backend/core/coretest"
	"seed/backend/core/keystore"
	documents "seed/backend/genproto/documents/v3alpha"
	"seed/backend/hmnet/syncing"
	"seed/backend/logging"
	"seed/backend/storage"
	"seed/backend/util/must"
	"testing"

	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// fakeDiscoverer captures the args passed to TouchHotTask for assertion in
// handler tests, without exercising the real syncing service.
type fakeDiscoverer struct {
	calls []fakeDiscoverCall
}

type fakeDiscoverCall struct {
	IRI       blob.IRI
	Version   blob.Version
	Recursive bool
	DepthOne  bool
	BlobTypes []string
}

func (f *fakeDiscoverer) TouchHotTask(iri blob.IRI, version blob.Version, recursive bool, depthOne bool, blobTypes []string) syncing.TaskInfo {
	f.calls = append(f.calls, fakeDiscoverCall{
		IRI:       iri,
		Version:   version,
		Recursive: recursive,
		DepthOne:  depthOne,
		BlobTypes: blobTypes,
	})
	return syncing.TaskInfo{}
}

type testServices struct {
	documents *Server
	me        coretest.Tester
}

func newTestServices(t *testing.T, name string) testServices {
	t.Helper()

	u := coretest.NewTester(name)
	db := storage.MakeTestMemoryDB(t)
	ks := keystore.NewMemory()
	require.NoError(t, ks.StoreKey(context.Background(), "main", u.Account))

	idx := must.Do2(blob.OpenIndex(context.Background(), db, logging.New("seed/index"+"/"+name, "debug")))

	return testServices{
		documents: NewServer(config.Base{}, ks, idx, db, logging.New("seed/documents"+"/"+name, "debug"), nil),
		me:        u,
	}
}

func TestIsValidIriFilter(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name  string
		input string
		valid bool
	}{
		{"valid single doc", "hm://abc123/cars/honda", true},
		{"valid subtree glob", "hm://abc123/cars/*", true},
		{"valid account glob", "hm://abc123*", true},
		{"valid all", "hm://*", true},
		{"valid with dashes", "hm://my-account/my-doc", true},
		{"valid with dots", "hm://acc.123/path", true},
		{"valid question mark glob", "hm://abc/?", true},
		{"valid bracket glob", "hm://abc/[abc]", true},
		{"invalid no prefix", "abc://bad", false},
		{"invalid empty", "", false},
		{"invalid sql injection", "hm://; DROP TABLE fts;--", false},
		{"invalid spaces", "hm://acc/path with spaces", false},
		{"invalid quotes", "hm://acc/path'quote", false},
		{"invalid parens", "hm://acc/path()", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := isValidIriFilter(tt.input)
			require.Equal(t, tt.valid, got, "isValidIriFilter(%q) must be %v", tt.input, tt.valid)
		})
	}
}

func TestSanitizeSearchQuery(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name  string
		input string
		want  string
	}{
		{"plain text unchanged", "hello world", "hello world"},
		{"hyphen replaced with space", "Zero-knowledge", "Zero knowledge"},
		{"multiple hyphens", "state-of-the-art", "state of the art"},
		{"apostrophe splits tokens", "don't", "don t"},
		{"symbols stripped to space", "C++", "C"},
		{"parentheses removed", "(test)", "test"},
		{"only special chars yields empty", "---", ""},
		{"consecutive special chars", "foo--bar", "foo bar"},
		{"underscores preserved", "snake_case", "snake_case"},
		{"mixed punctuation", "hello, world!", "hello world"},
		{"email-like input", "user@domain.com", "user domain com"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := sanitizeSearchQuery(tt.input)
			require.Equal(t, tt.want, got, "sanitizeSearchQuery(%q)", tt.input)
		})
	}
}

func TestSearchResourcesFindsProfileOnlyAccount(t *testing.T) {
	t.Parallel()

	svc := newTestServices(t, "bob")
	ctx := context.Background()
	account := svc.me.Account.PublicKey.String()

	_, err := svc.documents.UpdateProfile(ctx, &documents.UpdateProfileRequest{
		Account:        account,
		SigningKeyName: "main",
		Profile: &documents.Profile{
			Name: "web eric 84",
		},
	})
	require.NoError(t, err)

	_, err = svc.documents.GetDocument(ctx, &documents.GetDocumentRequest{
		Account: account,
		Path:    "",
	})
	require.Error(t, err, "profile-only account must not require a home document")
	st, ok := status.FromError(err)
	require.True(t, ok)
	require.Equal(t, codes.NotFound, st.Code())

	res, err := svc.documents.SearchResources(ctx, &documents.SearchResourcesRequest{
		Query: "web eric 84",
	})
	require.NoError(t, err)
	require.Len(t, res.Resources, 1)
	require.Equal(t, "hm://"+account, res.Resources[0].Id)
	require.Equal(t, "profile", res.Resources[0].Type)
	require.Equal(t, "web eric 84", res.Resources[0].Content)
}

func TestBuildRankMap(t *testing.T) {
	t.Parallel()

	results := []fullDataSearchResult{
		{iri: "hm://a/doc1"},
		{iri: "hm://a/doc2"},
		{iri: "hm://a/doc3"},
		{iri: "hm://a/doc1"}, // Duplicate IRI — must be deduped.
	}

	scores := map[string]int{
		"hm://a/doc1": 10,
		"hm://a/doc2": 50,
		"hm://a/doc3": 30,
	}

	ranks := buildRankMap(results, func(r fullDataSearchResult) int { return scores[r.iri] })

	require.Equal(t, 1, ranks["hm://a/doc2"], "doc2 has highest score (50) so must be rank 1")
	require.Equal(t, 2, ranks["hm://a/doc3"], "doc3 has score 30 so must be rank 2")
	require.Equal(t, 3, ranks["hm://a/doc1"], "doc1 has lowest score (10) so must be rank 3")
	require.Len(t, ranks, 3, "must have 3 unique IRIs")
}

func TestDiscoverResource_RequestShapes(t *testing.T) {
	t.Parallel()

	alice := coretest.NewTester("alice").Account.Principal()
	aliceID := alice.String()

	newServer := func() (*Server, *fakeDiscoverer) {
		fd := &fakeDiscoverer{}
		srv := NewServer(config.Base{}, nil, nil, nil, logging.New("seed/resources/test", "debug"), nil, fd)
		return srv, fd
	}

	t.Run("id with profile scope maps to blob types", func(t *testing.T) {
		srv, fd := newServer()
		_, err := srv.DiscoverResource(context.Background(), &documents.DiscoverResourceRequest{
			Id: "hm://" + aliceID + "/:profile",
		})
		require.NoError(t, err)
		require.Len(t, fd.calls, 1)
		require.Equal(t, blob.IRI("hm://"+aliceID), fd.calls[0].IRI)
		require.Equal(t, []string{"Profile", "Ref", "Change"}, fd.calls[0].BlobTypes)
		require.False(t, fd.calls[0].Recursive)
		require.False(t, fd.calls[0].DepthOne)
	})

	t.Run("id with ** wildcard sets Recursive", func(t *testing.T) {
		srv, fd := newServer()
		_, err := srv.DiscoverResource(context.Background(), &documents.DiscoverResourceRequest{
			Id: "hm://" + aliceID + "/notes/**",
		})
		require.NoError(t, err)
		require.Len(t, fd.calls, 1)
		require.Equal(t, blob.IRI("hm://"+aliceID+"/notes"), fd.calls[0].IRI)
		require.True(t, fd.calls[0].Recursive)
		require.False(t, fd.calls[0].DepthOne)
	})

	t.Run("id with * wildcard sets DepthOne", func(t *testing.T) {
		srv, fd := newServer()
		_, err := srv.DiscoverResource(context.Background(), &documents.DiscoverResourceRequest{
			Id: "hm://" + aliceID + "/notes/*",
		})
		require.NoError(t, err)
		require.Len(t, fd.calls, 1)
		require.True(t, fd.calls[0].DepthOne)
		require.False(t, fd.calls[0].Recursive)
	})

	t.Run("decomposed account+path still works", func(t *testing.T) {
		srv, fd := newServer()
		_, err := srv.DiscoverResource(context.Background(), &documents.DiscoverResourceRequest{
			Account:   aliceID,
			Path:      "/notes/foo",
			Recursive: true,
		})
		require.NoError(t, err)
		require.Len(t, fd.calls, 1)
		require.Equal(t, blob.IRI("hm://"+aliceID+"/notes/foo"), fd.calls[0].IRI)
		require.True(t, fd.calls[0].Recursive)
		require.Nil(t, fd.calls[0].BlobTypes)
	})

	t.Run("id rejects mixing with account", func(t *testing.T) {
		srv, _ := newServer()
		_, err := srv.DiscoverResource(context.Background(), &documents.DiscoverResourceRequest{
			Id:      "hm://" + aliceID,
			Account: aliceID,
		})
		require.Error(t, err)
		st, ok := status.FromError(err)
		require.True(t, ok)
		require.Equal(t, codes.InvalidArgument, st.Code())
	})

	t.Run("id rejects mixing with recursive", func(t *testing.T) {
		srv, _ := newServer()
		_, err := srv.DiscoverResource(context.Background(), &documents.DiscoverResourceRequest{
			Id:        "hm://" + aliceID,
			Recursive: true,
		})
		require.Error(t, err)
		st, ok := status.FromError(err)
		require.True(t, ok)
		require.Equal(t, codes.InvalidArgument, st.Code())
	})

	t.Run("id rejects malformed URL", func(t *testing.T) {
		srv, _ := newServer()
		_, err := srv.DiscoverResource(context.Background(), &documents.DiscoverResourceRequest{
			Id: "hm://not-a-real-principal/:profile",
		})
		require.Error(t, err)
		st, ok := status.FromError(err)
		require.True(t, ok)
		require.Equal(t, codes.InvalidArgument, st.Code())
	})
}
