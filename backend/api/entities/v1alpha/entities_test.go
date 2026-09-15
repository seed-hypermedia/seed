package entities

import (
	"context"
	documentsapi "seed/backend/api/documents/v3alpha"
	"seed/backend/blob"
	"seed/backend/config"
	"seed/backend/core/coretest"
	"seed/backend/core/keystore"
	documents "seed/backend/genproto/documents/v3alpha"
	entpb "seed/backend/genproto/entities/v1alpha"
	"seed/backend/hmnet/syncing"
	"seed/backend/logging"
	"seed/backend/storage"
	"seed/backend/util/must"
	"testing"
	"time"

	"github.com/ipfs/go-cid"
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
	documents *documentsapi.Server
	entities  *Server
	idx       *blob.Index
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
		documents: documentsapi.NewServer(config.Base{}, ks, idx, db, logging.New("seed/documents"+"/"+name, "debug"), nil),
		entities:  NewServer(config.Base{}, db, nil, nil, logging.New("seed/entities"+"/"+name, "debug")),
		idx:       idx,
		me:        u,
	}
}

// publishDocument stores a genesis change and a ref for it at path, and returns the
// document's version (which is also its genesis, being a single change).
func (svc testServices) publishDocument(t *testing.T, path string, ts time.Time) string {
	t.Helper()

	ctx := context.Background()
	kp := svc.me.Account

	change, err := blob.NewChange(kp, cid.Undef, nil, 0, blob.ChangeBody{}, ts)
	require.NoError(t, err)

	ref, err := blob.NewRef(kp, ts.UnixMilli(), change.CID, kp.Principal(), path, []cid.Cid{change.CID}, ts, blob.VisibilityPublic)
	require.NoError(t, err)

	require.NoError(t, svc.idx.Put(ctx, change))
	require.NoError(t, svc.idx.Put(ctx, ref))

	return change.CID.String()
}

// TestListEntityMentions_CommentSourceDocument covers the twin of the
// ListCitations comment query (see TestListCitations_CommentSourceDocument in the
// documents API): a comment mention must report the document the comment lives on,
// at that document's current path, rather than the requested entity.
func TestListEntityMentions_CommentSourceDocument(t *testing.T) {
	t.Parallel()

	svc := newTestServices(t, "alice")
	ctx := context.Background()
	space := svc.me.Account.Principal().String()

	// Distinct timestamps so that each document gets its own genesis change.
	base := time.Unix(1_700_000_000, 0).UTC()

	svc.publishDocument(t, "", base)
	citedVersion := svc.publishDocument(t, "/cited", base.Add(time.Second))
	otherVersion := svc.publishDocument(t, "/other", base.Add(2*time.Second))

	comment := func(path, version, text, link string) *documents.Comment {
		t.Helper()
		cmt, err := svc.documents.CreateComment(ctx, &documents.CreateCommentRequest{
			SigningKeyName: "main",
			TargetAccount:  space,
			TargetPath:     path,
			TargetVersion:  version,
			Content: []*documents.BlockNode{
				{Block: &documents.Block{Id: "b1", Type: "paragraph", Text: text, Link: link}},
			},
		})
		require.NoError(t, err)
		return cmt
	}

	move := func(version, from, to string) {
		t.Helper()
		_, err := svc.documents.CreateRef(ctx, &documents.CreateRefRequest{
			Account:        space,
			Path:           to,
			SigningKeyName: "main",
			Target: &documents.RefTarget{
				Target: &documents.RefTarget_Version_{
					Version: &documents.RefTarget_Version{Genesis: version, Version: version},
				},
			},
		})
		require.NoError(t, err)

		_, err = svc.documents.CreateRef(ctx, &documents.CreateRefRequest{
			Account:        space,
			Path:           from,
			SigningKeyName: "main",
			Target: &documents.RefTarget{
				Target: &documents.RefTarget_Redirect_{
					Redirect: &documents.RefTarget_Redirect{Account: space, Path: to},
				},
			},
		})
		require.NoError(t, err)
	}

	commentMentions := func(iri string) map[string]*entpb.Mention {
		t.Helper()
		res, err := svc.entities.ListEntityMentions(ctx, &entpb.ListEntityMentionsRequest{Id: iri, PageSize: 50})
		require.NoError(t, err)
		out := make(map[string]*entpb.Mention)
		for _, m := range res.Mentions {
			require.Equal(t, iri, m.Target, "mention must report the requested target")
			if m.SourceType != "Comment" {
				continue
			}
			require.NotContains(t, out, m.Source, "comment must be listed once")
			out[m.Source] = m
		}
		return out
	}

	citedIRI := "hm://" + space + "/cited"

	direct := comment("/cited", citedVersion, "Direct comment", "")
	external := comment("/other", otherVersion, "Comment linking to the cited document", citedIRI)

	mentions := commentMentions(citedIRI)
	require.Len(t, mentions, 2, "both the direct and the linking comment mention the document")
	require.Equal(t, citedIRI, mentions["hm://"+direct.Id].SourceDocument, "a direct comment lives on the cited document")
	require.Equal(t, "hm://"+space+"/other", mentions["hm://"+external.Id].SourceDocument, "a linking comment lives on its own document, not on the cited one")

	// The citing document moves twice; the comment blob still records /other.
	move(otherVersion, "/other", "/other-moved")
	move(otherVersion, "/other-moved", "/other-final")

	mentions = commentMentions(citedIRI)
	require.Len(t, mentions, 2)
	require.Equal(t, citedIRI, mentions["hm://"+direct.Id].SourceDocument)
	require.Equal(t, "hm://"+space+"/other-final", mentions["hm://"+external.Id].SourceDocument, "the citing comment's document must be reported at its current path")

	// The cited document moves: the old path stops serving mentions, and on the new
	// path the direct comment is attributed to the document's current path.
	move(citedVersion, "/cited", "/cited-moved")
	movedIRI := "hm://" + space + "/cited-moved"

	require.Empty(t, commentMentions(citedIRI), "a redirected path must not serve mentions")

	mentions = commentMentions(movedIRI)
	require.Len(t, mentions, 2, "mentions must follow the cited document to its new path")
	require.Equal(t, movedIRI, mentions["hm://"+direct.Id].SourceDocument)
	require.Equal(t, "hm://"+space+"/other-final", mentions["hm://"+external.Id].SourceDocument)
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
		Query:            "web eric 84",
		EntityKindFilter: []entpb.EntityKindFilter{entpb.EntityKindFilter_ENTITY_KIND_SPACE},
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

func TestDiscoverEntity_RequestShapes(t *testing.T) {
	t.Parallel()

	alice := coretest.NewTester("alice").Account.Principal()
	aliceID := alice.String()

	newServer := func() (*Server, *fakeDiscoverer) {
		fd := &fakeDiscoverer{}
		srv := NewServer(config.Base{}, nil, fd, nil, logging.New("seed/entities/test", "debug"))
		return srv, fd
	}

	t.Run("id with profile scope maps to blob types", func(t *testing.T) {
		srv, fd := newServer()
		_, err := srv.DiscoverEntity(context.Background(), &entpb.DiscoverEntityRequest{
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
		_, err := srv.DiscoverEntity(context.Background(), &entpb.DiscoverEntityRequest{
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
		_, err := srv.DiscoverEntity(context.Background(), &entpb.DiscoverEntityRequest{
			Id: "hm://" + aliceID + "/notes/*",
		})
		require.NoError(t, err)
		require.Len(t, fd.calls, 1)
		require.True(t, fd.calls[0].DepthOne)
		require.False(t, fd.calls[0].Recursive)
	})

	t.Run("decomposed account+path still works", func(t *testing.T) {
		srv, fd := newServer()
		_, err := srv.DiscoverEntity(context.Background(), &entpb.DiscoverEntityRequest{
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
		_, err := srv.DiscoverEntity(context.Background(), &entpb.DiscoverEntityRequest{
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
		_, err := srv.DiscoverEntity(context.Background(), &entpb.DiscoverEntityRequest{
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
		_, err := srv.DiscoverEntity(context.Background(), &entpb.DiscoverEntityRequest{
			Id: "hm://not-a-real-principal/:profile",
		})
		require.Error(t, err)
		st, ok := status.FromError(err)
		require.True(t, ok)
		require.Equal(t, codes.InvalidArgument, st.Code())
	})
}
