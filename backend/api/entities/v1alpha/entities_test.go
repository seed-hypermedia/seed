package entities

import (
	"context"
	documentsapi "seed/backend/api/documents/v3alpha"
	"seed/backend/blob"
	"seed/backend/config"
	"seed/backend/core"
	"seed/backend/core/coretest"
	"seed/backend/core/keystore"
	documents "seed/backend/genproto/documents/v3alpha"
	entpb "seed/backend/genproto/entities/v1alpha"
	"seed/backend/hmnet/syncing"
	"seed/backend/logging"
	"seed/backend/storage"
	"seed/backend/util/must"
	"slices"
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
	documents *documentsapi.Server
	entities  *Server
	me        coretest.Tester
	keys      core.KeyStore
	idx       *blob.Index
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
		me:        u,
		keys:      ks,
		idx:       idx,
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
		Query:            "web eric 84",
		EntityKindFilter: []entpb.EntityKindFilter{entpb.EntityKindFilter_ENTITY_KIND_SPACE},
	})
	require.NoError(t, err)
	require.Len(t, res.Entities, 1)
	require.Equal(t, "hm://"+account, res.Entities[0].Id)
	require.Equal(t, "profile", res.Entities[0].Type)
	require.Equal(t, "web eric 84", res.Entities[0].Content)
}

// A renamed account remains discoverable by its old name, but the hit is marked
// so clients can rank and explain it as historical (#1147).
func TestSearchEntitiesProfileRenameKeepsFormerName(t *testing.T) {
	t.Parallel()

	svc := newTestServices(t, "bob")
	ctx := context.Background()
	account := svc.me.Account.PublicKey.String()

	for _, name := range []string{"web eric 4", "Douglas"} {
		_, err := svc.documents.UpdateProfile(ctx, &documents.UpdateProfileRequest{
			Account:        account,
			SigningKeyName: "main",
			Profile:        &documents.Profile{Name: name},
		})
		require.NoError(t, err)
	}

	search := func(query string) []*entpb.Entity {
		res, err := svc.entities.SearchEntities(ctx, &entpb.SearchEntitiesRequest{
			Query:            query,
			EntityKindFilter: []entpb.EntityKindFilter{entpb.EntityKindFilter_ENTITY_KIND_SPACE},
		})
		require.NoError(t, err)
		return res.Entities
	}
	former := search("eric")
	require.Len(t, former, 1)
	require.Equal(t, "hm://"+account, former[0].Id)
	require.Equal(t, "web eric 4", former[0].Content)
	require.True(t, former[0].IsFormerName, "the superseded profile name must be tagged")

	current := search("douglas")
	require.Len(t, current, 1)
	require.Equal(t, "hm://"+account, current[0].Id)
	require.Equal(t, "Douglas", current[0].Content)
	require.False(t, current[0].IsFormerName)

	// A name published again is current, even though an older blob also carries it.
	_, err := svc.documents.UpdateProfile(ctx, &documents.UpdateProfileRequest{
		Account:        account,
		SigningKeyName: "main",
		Profile:        &documents.Profile{Name: "web eric 4"},
	})
	require.NoError(t, err)
	again := search("eric")
	require.Len(t, again, 1)
	require.Equal(t, "web eric 4", again[0].Content)
	require.False(t, again[0].IsFormerName, "the hit is deduplicated to the current-name row")
}

// Two accounts with the same name in their history: the one that has it now
// sorts first, whatever FTS rank says.
func TestSearchEntitiesCurrentNameOutranksFormerName(t *testing.T) {
	t.Parallel()

	svc := newTestServices(t, "bob")
	ctx := context.Background()
	account := svc.me.Account.PublicKey.String()

	// The main account used to be "Eric Vicenti" and is "Kat" now.
	for _, name := range []string{"Eric Vicenti", "Kat"} {
		_, err := svc.documents.UpdateProfile(ctx, &documents.UpdateProfileRequest{
			Account:        account,
			SigningKeyName: "main",
			Profile:        &documents.Profile{Name: name},
		})
		require.NoError(t, err)
	}

	// A second account is "Eric" today.
	other := coretest.NewTester("alice")
	require.NoError(t, svc.keys.StoreKey(ctx, "alice", other.Account))
	_, err := svc.documents.UpdateProfile(ctx, &documents.UpdateProfileRequest{
		Account:        other.Account.PublicKey.String(),
		SigningKeyName: "alice",
		Profile:        &documents.Profile{Name: "Eric"},
	})
	require.NoError(t, err)

	res, err := svc.entities.SearchEntities(ctx, &entpb.SearchEntitiesRequest{
		Query:            "eric",
		EntityKindFilter: []entpb.EntityKindFilter{entpb.EntityKindFilter_ENTITY_KIND_SPACE},
	})
	require.NoError(t, err)
	require.Len(t, res.Entities, 2)
	require.Equal(t, "hm://"+other.Account.PublicKey.String(), res.Entities[0].Id)
	require.Equal(t, "Eric", res.Entities[0].Content)
	require.False(t, res.Entities[0].IsFormerName)
	require.Equal(t, "hm://"+account, res.Entities[1].Id)
	require.Equal(t, "Eric Vicenti", res.Entities[1].Content)
	require.True(t, res.Entities[1].IsFormerName)
}

// A document found by a title it no longer has is tagged and sorts after the
// document that has the title now.
func TestSearchEntitiesRenamedTitleIsFormerName(t *testing.T) {
	t.Parallel()

	svc := newTestServices(t, "alice")
	kp := svc.me.Account
	clock := newTestClock()
	nameOp := func(name string) blob.OpMap {
		op, err := blob.NewOpSetKey("name", name)
		require.NoError(t, err)
		return op
	}

	createDoc(t, svc, kp, "", 1, clock, nameOp("Home"))
	renamed := createDoc(t, svc, kp, "/plan", 1, clock, nameOp("Eric plan"))
	renamed.edit(t, clock, nameOp("Plan"))
	renamed.publishRef(t, clock)
	current := createDoc(t, svc, kp, "/notes", 1, clock, nameOp("Eric notes"))

	res, err := svc.entities.SearchEntities(context.Background(), &entpb.SearchEntitiesRequest{
		Query:            "eric",
		EntityKindFilter: []entpb.EntityKindFilter{entpb.EntityKindFilter_ENTITY_KIND_DOCUMENT},
	})
	require.NoError(t, err)
	require.Len(t, res.Entities, 2)
	require.Equal(t, current.iri(), entityDoc(res.Entities[0].Id))
	require.Equal(t, "Eric notes", res.Entities[0].Content)
	require.False(t, res.Entities[0].IsFormerName)
	require.Contains(t, res.Entities[0].Id, "&l", "a current title is served at the latest version")
	require.Equal(t, renamed.iri(), entityDoc(res.Entities[1].Id))
	require.Equal(t, "Eric plan", res.Entities[1].Content)
	require.True(t, res.Entities[1].IsFormerName, "a replaced title is tagged")
	require.NotContains(t, res.Entities[1].Id, "&l", "a replaced title stays at the version that carried it")

	// Under the current title the same document is a current-name hit, ahead of
	// its own old title that happens to contain the query too.
	res, err = svc.entities.SearchEntities(context.Background(), &entpb.SearchEntitiesRequest{Query: "plan"})
	require.NoError(t, err)
	require.Len(t, res.Entities, 2)
	require.Equal(t, "Plan", res.Entities[0].Content)
	require.False(t, res.Entities[0].IsFormerName)
	require.Equal(t, "Eric plan", res.Entities[1].Content)
	require.True(t, res.Entities[1].IsFormerName)
}

func TestOrderBySimilarityDemotesFormerAccountName(t *testing.T) {
	t.Parallel()

	current := fullDataSearchResult{iri: "hm://current", contentType: "title", score: 1}
	former := fullDataSearchResult{iri: "hm://former", contentType: "profile", score: 100, isFormerName: true}
	require.Negative(t, orderBySimilarity(current, former))
	require.Positive(t, orderBySimilarity(former, current))

	body := fullDataSearchResult{iri: "hm://doc/page", contentType: "document", score: 50}
	require.Positive(t, orderBySimilarity(former, body))

	results := []fullDataSearchResult{current, former, body}
	slices.SortFunc(results, orderBySimilarity)
	require.Equal(t, []string{"hm://doc/page", "hm://current", "hm://former"}, []string{results[0].iri, results[1].iri, results[2].iri})
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

// Breadcrumbs name every document on the path to a result. They are looked up
// for the results on the page only, and the lookup must behave the same for
// every keyword query variant: name types or every type, scoped to an account
// or not.
func TestSearchEntitiesParentNames(t *testing.T) {
	t.Parallel()

	svc := newTestServices(t, "alice")
	kp := svc.me.Account
	clock := newTestClock()
	nameOp := func(name string) blob.OpMap {
		op, err := blob.NewOpSetKey("name", name)
		require.NoError(t, err)
		return op
	}

	createDoc(t, svc, kp, "", 1, clock, nameOp("Develop Seed"))
	createDoc(t, svc, kp, "/notes", 1, clock, nameOp("Notes"))
	leaf := createDoc(t, svc, kp, "/notes/insecure", 1, clock, nameOp("Insecure resources"))

	for _, req := range []*entpb.SearchEntitiesRequest{
		{Query: "Insecure resources"},
		{Query: "Insecure resources", AccountUid: kp.Principal().String()},
		{Query: "Insecure resources", IncludeBody: true},
		{Query: "Insecure resources", IncludeBody: true, AccountUid: kp.Principal().String()},
	} {
		res, err := svc.entities.SearchEntities(context.Background(), req)
		require.NoError(t, err)
		require.Len(t, res.Entities, 1, "%+v", req)
		require.Equal(t, leaf.iri(), entityDoc(res.Entities[0].Id), "%+v", req)
		require.Equal(t, []string{"Develop Seed", "Notes"}, res.Entities[0].ParentNames, "%+v", req)
	}

	// A home document is its own breadcrumb root: nothing above it.
	res, err := svc.entities.SearchEntities(context.Background(), &entpb.SearchEntitiesRequest{Query: "Develop Seed"})
	require.NoError(t, err)
	require.Len(t, res.Entities, 1)
	require.Empty(t, res.Entities[0].ParentNames)
}
