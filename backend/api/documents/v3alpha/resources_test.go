package documents

import (
	"context"
	"fmt"
	"seed/backend/blob"
	"seed/backend/core"
	"seed/backend/core/coretest"
	documents "seed/backend/genproto/documents/v3alpha"
	"testing"
	"time"

	"github.com/ipfs/go-cid"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestGetResource(t *testing.T) {
	t.Parallel()

	t.Run("InvalidIRI", func(t *testing.T) {
		t.Parallel()
		srv := newTestDocsAPI(t, "alice")

		_, err := srv.GetResource(context.Background(), &documents.GetResourceRequest{
			Iri: "not-a-valid-iri\n",
		})

		require.Error(t, err)
		st := status.Convert(err)
		require.Equal(t, codes.InvalidArgument, st.Code())
		require.Contains(t, st.Message(), "failed to parse IRI")
	})

	t.Run("UnsupportedScheme", func(t *testing.T) {
		t.Parallel()
		srv := newTestDocsAPI(t, "bob")

		_, err := srv.GetResource(context.Background(), &documents.GetResourceRequest{
			Iri: "ftp://example.com/test",
		})

		require.Error(t, err)
		st := status.Convert(err)
		require.Equal(t, codes.InvalidArgument, st.Code())
		require.Contains(t, st.Message(), "only [hm http https] schemes are supported")
	})

	t.Run("HTTPSchemeNotImplemented", func(t *testing.T) {
		t.Parallel()
		srv := newTestDocsAPI(t, "carol")

		_, err := srv.GetResource(context.Background(), &documents.GetResourceRequest{
			Iri: "http://example.com/test",
		})

		require.Error(t, err)
		st := status.Convert(err)
		require.Equal(t, codes.Unimplemented, st.Code())
		require.Contains(t, st.Message(), "only 'hm' scheme is supported for now")
	})

	t.Run("HTTPSSchemeNotImplemented", func(t *testing.T) {
		t.Parallel()
		srv := newTestDocsAPI(t, "david")

		_, err := srv.GetResource(context.Background(), &documents.GetResourceRequest{
			Iri: "https://example.com/test",
		})

		require.Error(t, err)
		st := status.Convert(err)
		require.Equal(t, codes.Unimplemented, st.Code())
		require.Contains(t, st.Message(), "only 'hm' scheme is supported for now")
	})
	t.Run("InvalidAccount", func(t *testing.T) {
		t.Parallel()
		srv := newTestDocsAPI(t, "alice")

		_, err := srv.GetResource(context.Background(), &documents.GetResourceRequest{
			Iri: "hm://invalid-account/test",
		})

		require.Error(t, err)
		st := status.Convert(err)
		require.Equal(t, codes.InvalidArgument, st.Code())
		require.Contains(t, st.Message(), "failed to parse account")
	})

	t.Run("InvalidVersion", func(t *testing.T) {
		t.Parallel()
		srv := newTestDocsAPI(t, "bob")

		_, err := srv.GetResource(context.Background(), &documents.GetResourceRequest{
			Iri: fmt.Sprintf("hm://%s/test?v=invalid-version", srv.me.Account.Principal()),
		})

		require.Error(t, err)
		st := status.Convert(err)
		require.Equal(t, codes.InvalidArgument, st.Code())
		require.Contains(t, st.Message(), "failed to parse version")
	})

	t.Run("GetDocument", func(t *testing.T) {
		t.Parallel()
		srv := newTestDocsAPI(t, "carol")
		ctx := context.Background()

		_, err := srv.CreateDocumentChange(ctx, &documents.CreateDocumentChangeRequest{
			SigningKeyName: "main",
			Account:        srv.me.Account.PublicKey.String(),
			Path:           "/test",
			Changes: []*documents.DocumentChange{
				{Op: &documents.DocumentChange_SetMetadata_{
					SetMetadata: &documents.DocumentChange_SetMetadata{
						Key:   "title",
						Value: "Test Document",
					},
				}},
			},
		})
		require.NoError(t, err)

		iri := fmt.Sprintf("hm://%s/test", srv.me.Account.Principal())
		resp, err := srv.GetResource(ctx, &documents.GetResourceRequest{
			Iri: iri,
		})

		require.NoError(t, err)
		require.NotNil(t, resp.GetDocument())
		require.Equal(t, "/test", resp.GetDocument().Path)
		require.Equal(t, "Test Document", resp.GetDocument().Metadata.Fields["title"].GetStringValue())
	})

	t.Run("GetDocumentWithVersion", func(t *testing.T) {
		t.Parallel()
		srv := newTestDocsAPI(t, "david")
		ctx := context.Background()

		doc1, err := srv.CreateDocumentChange(ctx, &documents.CreateDocumentChangeRequest{
			SigningKeyName: "main",
			Account:        srv.me.Account.PublicKey.String(),
			Path:           "/test",
			Changes: []*documents.DocumentChange{
				{Op: &documents.DocumentChange_SetMetadata_{
					SetMetadata: &documents.DocumentChange_SetMetadata{
						Key:   "title",
						Value: "Version 1",
					},
				}},
			},
		})
		require.NoError(t, err)

		_, err = srv.CreateDocumentChange(ctx, &documents.CreateDocumentChangeRequest{
			SigningKeyName: "main",
			Account:        srv.me.Account.PublicKey.String(),
			Path:           "/test",
			BaseVersion:    doc1.Version,
			Changes: []*documents.DocumentChange{
				{Op: &documents.DocumentChange_SetMetadata_{
					SetMetadata: &documents.DocumentChange_SetMetadata{
						Key:   "title",
						Value: "Version 2",
					},
				}},
			},
		})
		require.NoError(t, err)

		iri := fmt.Sprintf("hm://%s/test?v=%s", srv.me.Account.Principal(), doc1.Version)
		resp, err := srv.GetResource(ctx, &documents.GetResourceRequest{
			Iri: iri,
		})

		require.NoError(t, err)
		require.NotNil(t, resp.GetDocument())
		require.Equal(t, "Version 1", resp.GetDocument().Metadata.Fields["title"].GetStringValue())
	})

	t.Run("GetDocumentWithLatestVersion", func(t *testing.T) {
		t.Parallel()
		srv := newTestDocsAPI(t, "alice")
		ctx := context.Background()

		doc1, err := srv.CreateDocumentChange(ctx, &documents.CreateDocumentChangeRequest{
			SigningKeyName: "main",
			Account:        srv.me.Account.PublicKey.String(),
			Path:           "/test",
			Changes: []*documents.DocumentChange{
				{Op: &documents.DocumentChange_SetMetadata_{
					SetMetadata: &documents.DocumentChange_SetMetadata{
						Key:   "title",
						Value: "Version 1",
					},
				}},
			},
		})
		require.NoError(t, err)

		_, err = srv.CreateDocumentChange(ctx, &documents.CreateDocumentChangeRequest{
			SigningKeyName: "main",
			Account:        srv.me.Account.PublicKey.String(),
			Path:           "/test",
			BaseVersion:    doc1.Version,
			Changes: []*documents.DocumentChange{
				{Op: &documents.DocumentChange_SetMetadata_{
					SetMetadata: &documents.DocumentChange_SetMetadata{
						Key:   "title",
						Value: "Version 2",
					},
				}},
			},
		})
		require.NoError(t, err)

		iri := fmt.Sprintf("hm://%s/test?v=%s&l=true", srv.me.Account.Principal(), doc1.Version)
		resp, err := srv.GetResource(ctx, &documents.GetResourceRequest{
			Iri: iri,
		})

		require.NoError(t, err)
		require.NotNil(t, resp.GetDocument())
		require.Equal(t, "Version 2", resp.GetDocument().Metadata.Fields["title"].GetStringValue())
	})

	t.Run("GetComment", func(t *testing.T) {
		t.Parallel()
		srv := newTestDocsAPI(t, "bob")
		ctx := context.Background()

		_, err := srv.CreateDocumentChange(ctx, &documents.CreateDocumentChangeRequest{
			SigningKeyName: "main",
			Account:        srv.me.Account.PublicKey.String(),
			Path:           "/test",
			Changes: []*documents.DocumentChange{
				{Op: &documents.DocumentChange_SetMetadata_{
					SetMetadata: &documents.DocumentChange_SetMetadata{
						Key:   "title",
						Value: "Test Document",
					},
				}},
			},
		})
		require.NoError(t, err)

		commentBody := []blob.CommentBlock{
			{
				Block: blob.Block{
					Type: "paragraph",
					Text: "This is a test comment",
				},
			},
		}

		comment := mustCreateComment(ctx, t, srv.idx, &srv.me, srv.me.Account.Principal(), "/test", nil, cid.Undef, cid.Undef, commentBody, time.Now())
		tsid := blob.NewTSID(comment.Decoded.BlobTime(), comment.Data)

		iri := fmt.Sprintf("hm://%s/%s", srv.me.Account.Principal(), tsid)
		resp, err := srv.GetResource(ctx, &documents.GetResourceRequest{
			Iri: iri,
		})

		require.NoError(t, err)
		require.NotNil(t, resp.GetComment())
		require.Equal(t, "/test", resp.GetComment().TargetPath)
		require.Equal(t, srv.me.Account.Principal().String(), resp.GetComment().TargetAccount)
	})

	t.Run("GetContact", func(t *testing.T) {
		t.Parallel()
		srv := newTestDocsAPI(t, "carol")
		ctx := context.Background()

		other := coretest.NewTester("alice-2")
		contact := mustCreateContact(ctx, t, srv.idx, &srv.me, "", other.Account.Principal(), "Test User", time.Now())
		tsid := blob.NewTSID(contact.Decoded.BlobTime(), contact.Data)

		iri := fmt.Sprintf("hm://%s/%s", srv.me.Account.Principal(), tsid)
		resp, err := srv.GetResource(ctx, &documents.GetResourceRequest{
			Iri: iri,
		})

		require.NoError(t, err)
		require.NotNil(t, resp.GetContact())
		require.Equal(t, "Test User", resp.GetContact().Name)
		require.Equal(t, other.Account.Principal().String(), resp.GetContact().Subject)
		require.Equal(t, srv.me.Account.Principal().String(), resp.GetContact().Account)
	})

	t.Run("GetCommentWithSpecificVersion", func(t *testing.T) {
		t.Parallel()
		srv := newTestDocsAPI(t, "david")
		ctx := context.Background()

		_, err := srv.CreateDocumentChange(ctx, &documents.CreateDocumentChangeRequest{
			SigningKeyName: "main",
			Account:        srv.me.Account.PublicKey.String(),
			Path:           "/test",
			Changes: []*documents.DocumentChange{
				{Op: &documents.DocumentChange_SetMetadata_{
					SetMetadata: &documents.DocumentChange_SetMetadata{
						Key:   "title",
						Value: "Test Document",
					},
				}},
			},
		})
		require.NoError(t, err)

		commentBody := []blob.CommentBlock{
			{
				Block: blob.Block{
					Type: "paragraph",
					Text: "This is a test comment",
				},
			},
		}

		comment := mustCreateComment(ctx, t, srv.idx, &srv.me, srv.me.Account.Principal(), "/test", nil, cid.Undef, cid.Undef, commentBody, time.Now())

		tsid := blob.NewTSID(comment.Decoded.BlobTime(), comment.Data)
		iri := fmt.Sprintf("hm://%s/%s?v=%s", srv.me.Account.Principal(), tsid, comment.CID)
		resp, err := srv.GetResource(ctx, &documents.GetResourceRequest{
			Iri: iri,
		})

		require.NoError(t, err)
		require.NotNil(t, resp.GetComment())
		require.Equal(t, "/test", resp.GetComment().TargetPath)
	})

	t.Run("GetContactWithSpecificVersion", func(t *testing.T) {
		t.Parallel()
		srv := newTestDocsAPI(t, "alice")
		ctx := context.Background()

		other := coretest.NewTester("alice-2")
		contact := mustCreateContact(ctx, t, srv.idx, &srv.me, "", other.Account.Principal(), "Test User", time.Now())

		tsid := blob.NewTSID(contact.Decoded.BlobTime(), contact.Data)
		iri := fmt.Sprintf("hm://%s/%s?v=%s", srv.me.Account.Principal(), tsid, contact.CID)
		resp, err := srv.GetResource(ctx, &documents.GetResourceRequest{
			Iri: iri,
		})

		require.NoError(t, err)
		require.NotNil(t, resp.GetContact())
		require.Equal(t, "Test User", resp.GetContact().Name)
		require.Equal(t, other.Account.Principal().String(), resp.GetContact().Subject)
		require.Equal(t, srv.me.Account.Principal().String(), resp.GetContact().Account)
	})

	t.Run("MultipleVersionsNotSupported", func(t *testing.T) {
		t.Parallel()
		srv := newTestDocsAPI(t, "bob")
		ctx := context.Background()

		other := coretest.NewTester("alice-2")
		contact1 := mustCreateContact(ctx, t, srv.idx, &srv.me, "", other.Account.Principal(), "Test User 1", time.Now())
		contact2 := mustCreateContact(ctx, t, srv.idx, &srv.me, "", other.Account.Principal(), "Test User 2", time.Now())

		tsid1 := blob.NewTSID(contact1.Decoded.BlobTime(), contact1.Data)
		iri := fmt.Sprintf("hm://%s/%s?v=%s.%s", srv.me.Account.Principal(), tsid1, contact1.CID, contact2.CID)
		_, err := srv.GetResource(ctx, &documents.GetResourceRequest{
			Iri: iri,
		})

		require.Error(t, err)
		st := status.Convert(err)
		require.Equal(t, codes.InvalidArgument, st.Code())
		require.Contains(t, st.Message(), "multiple versions are not supported for state-based resources")
	})

	t.Run("InvalidTSIDPath", func(t *testing.T) {
		t.Parallel()
		srv := newTestDocsAPI(t, "carol")
		ctx := context.Background()

		iri := fmt.Sprintf("hm://%s/not-a-valid-tsid", srv.me.Account.Principal())
		_, err := srv.GetResource(ctx, &documents.GetResourceRequest{
			Iri: iri,
		})

		require.Error(t, err)
	})

	t.Run("TSIDMismatch", func(t *testing.T) {
		t.Parallel()
		srv := newTestDocsAPI(t, "david")
		ctx := context.Background()

		other := coretest.NewTester("alice-2")
		contact := mustCreateContact(ctx, t, srv.idx, &srv.me, "", other.Account.Principal(), "Test User", time.Now())

		wrongTSID := "z2TtQLB6cE"
		iri := fmt.Sprintf("hm://%s/%s?v=%s", srv.me.Account.Principal(), wrongTSID, contact.CID)
		_, err := srv.GetResource(ctx, &documents.GetResourceRequest{
			Iri: iri,
		})

		require.Error(t, err)
		st := status.Convert(err)
		require.Equal(t, codes.NotFound, st.Code())
	})

	t.Run("ResourceNotFound", func(t *testing.T) {
		t.Parallel()
		srv := newTestDocsAPI(t, "alice")
		ctx := context.Background()

		nonExistentCID := "bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku"
		iri := fmt.Sprintf("hm://%s/?v=%s", srv.me.Account.Principal(), nonExistentCID)
		_, err := srv.GetResource(ctx, &documents.GetResourceRequest{
			Iri: iri,
		})

		require.Error(t, err)
	})

	t.Run("DocumentNotFound", func(t *testing.T) {
		t.Parallel()
		srv := newTestDocsAPI(t, "bob")
		ctx := context.Background()

		iri := fmt.Sprintf("hm://%s/nonexistent", srv.me.Account.Principal())
		_, err := srv.GetResource(ctx, &documents.GetResourceRequest{
			Iri: iri,
		})

		require.Error(t, err)
	})
}

func mustCreateComment(ctx context.Context, t *testing.T, idx *blob.Index, u *coretest.Tester, space core.Principal, path string, version []cid.Cid, threadRoot, replyParent cid.Cid, body []blob.CommentBlock, ts time.Time) blob.Encoded[*blob.Comment] {
	t.Helper()

	eb, err := blob.NewComment(u.Account, "", space, path, version, threadRoot, replyParent, body, blob.VisibilityPublic, ts.Round(blob.ClockPrecision))
	require.NoError(t, err)

	// eb implements blocks.Block directly
	require.NoError(t, idx.Put(ctx, eb))

	return eb
}

func mustCreateContact(ctx context.Context, t *testing.T, idx *blob.Index, u *coretest.Tester, id blob.TSID, subject core.Principal, name string, ts time.Time) blob.Encoded[*blob.Contact] {
	t.Helper()

	eb, err := blob.NewContact(u.Account, id, subject, name, ts.Round(blob.ClockPrecision))
	require.NoError(t, err)

	// eb implements blocks.Block directly
	require.NoError(t, idx.Put(ctx, eb))

	return eb
}
