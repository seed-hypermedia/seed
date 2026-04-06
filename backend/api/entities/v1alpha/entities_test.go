package entities

import (
	"context"
	documentsapi "seed/backend/api/documents/v3alpha"
	"seed/backend/blob"
	"seed/backend/config"
	"seed/backend/core"
	"seed/backend/core/coretest"
	documents "seed/backend/genproto/documents/v3alpha"
	entpb "seed/backend/genproto/entities/v1alpha"
	"seed/backend/logging"
	"seed/backend/storage"
	"seed/backend/util/must"
	"testing"

	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type testServices struct {
	documents *documentsapi.Server
	entities  *Server
	me        coretest.Tester
}

func newTestServices(t *testing.T, name string) testServices {
	t.Helper()

	u := coretest.NewTester(name)
	db := storage.MakeTestMemoryDB(t)
	ks := core.NewMemoryKeyStore()
	require.NoError(t, ks.StoreKey(context.Background(), "main", u.Account))

	idx := must.Do2(blob.OpenIndex(context.Background(), db, logging.New("seed/index"+"/"+name, "debug")))

	return testServices{
		documents: documentsapi.NewServer(config.Base{}, ks, idx, db, logging.New("seed/documents"+"/"+name, "debug"), nil),
		entities:  NewServer(config.Base{}, db, nil, nil, logging.New("seed/entities"+"/"+name, "debug")),
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

func TestSearchEntitiesFindsProfileOnlyAccount(t *testing.T) {
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

	res, err := svc.entities.SearchEntities(ctx, &entpb.SearchEntitiesRequest{
		Query: "web eric 84",
	})
	require.NoError(t, err)
	require.Len(t, res.Entities, 1)
	require.Equal(t, "hm://"+account, res.Entities[0].Id)
	require.Equal(t, "profile", res.Entities[0].Type)
	require.Equal(t, "web eric 84", res.Entities[0].Content)
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
