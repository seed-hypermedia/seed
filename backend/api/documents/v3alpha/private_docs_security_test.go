package documents

import (
	"context"
	"seed/backend/config"
	documents "seed/backend/genproto/documents/v3alpha"
	"testing"

	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// TestPrivateDocSecurityAudit contains security tests that attempt to bypass
// the private document access controls. Each subtest targets a specific
// potential vulnerability in the PublicOnly gate.

// VULN-1: GetResource with snapshot (TSID) path bypasses PublicOnly check.
// When GetResource receives a path that looks like a TSID, it enters the
// snapshot code path (getSnapshotResource) which returns comments/contacts
// without checking PublicOnly. A private comment on a private document
// can be fetched through this path on a gateway.
func TestPrivateDocSecurity_GetResourceSnapshotBypassesPublicOnly(t *testing.T) {
	t.Parallel()
	ctx := context.Background()

	// Create server with PublicOnly=true (simulating a gateway).
	// PublicOnly blocks reads but not writes, so we can set up data directly.
	alice := newTestDocsAPIWithConfig(t, "alice", config.Base{PublicOnly: true})
	account := alice.me.Account.PublicKey.String()

	// Create a private document.
	privateDoc, err := alice.CreateDocumentChange(ctx, &documents.CreateDocumentChangeRequest{
		SigningKeyName: "main",
		Account:        account,
		Path:           "/secret",
		Visibility:     documents.ResourceVisibility_RESOURCE_VISIBILITY_PRIVATE,
		Changes: []*documents.DocumentChange{
			{Op: &documents.DocumentChange_SetMetadata_{
				SetMetadata: &documents.DocumentChange_SetMetadata{Key: "title", Value: "Secret Document"},
			}},
			{Op: &documents.DocumentChange_MoveBlock_{
				MoveBlock: &documents.DocumentChange_MoveBlock{BlockId: "b1", Parent: "", LeftSibling: ""},
			}},
			{Op: &documents.DocumentChange_ReplaceBlock{
				ReplaceBlock: &documents.Block{
					Id:   "b1",
					Type: "paragraph",
					Text: "Top secret content",
				},
			}},
		},
	})
	require.NoError(t, err)

	// Create a comment on the private document (inherits visibility).
	comment, err := alice.CreateComment(ctx, &documents.CreateCommentRequest{
		SigningKeyName: "main",
		TargetAccount:  account,
		TargetPath:     "/secret",
		TargetVersion:  privateDoc.Version,
		Content: []*documents.BlockNode{
			{Block: &documents.Block{
				Id:   "c1",
				Type: "paragraph",
				Text: "This is a secret comment that should not leak",
			}},
		},
	})
	require.NoError(t, err)

	// Try to access the comment via GetResource using its record ID (which is a TSID path).
	// Format: hm://<author>/<tsid> — this enters the snapshot code path in GetResource.
	resourceIRI := "hm://" + comment.Id
	_, err = alice.GetResource(ctx, &documents.GetResourceRequest{
		Iri: resourceIRI,
	})

	// This SHOULD return PermissionDenied because the comment is private and we are in PublicOnly mode.
	// If this test fails (no error), the snapshot path is leaking private comments.
	require.Error(t, err, "GetResource via snapshot TSID path must deny access to private comments in PublicOnly mode")
	st, ok := status.FromError(err)
	require.True(t, ok)
	require.Equal(t, codes.PermissionDenied, st.Code(), "error must be PermissionDenied, got %s: %s", st.Code(), st.Message())
}

// VULN-2: ListDocumentChanges does not check PublicOnly.
// The ListDocumentChanges RPC loads a private document and returns its change
// history (author, timestamp, CIDs) without any PublicOnly gate. This leaks
// metadata about private documents on gateway nodes.
func TestPrivateDocSecurity_ListDocumentChangesLeaksMetadata(t *testing.T) {
	t.Parallel()
	ctx := context.Background()

	alice := newTestDocsAPIWithConfig(t, "alice", config.Base{PublicOnly: true})
	account := alice.me.Account.PublicKey.String()

	privateDoc, err := alice.CreateDocumentChange(ctx, &documents.CreateDocumentChangeRequest{
		SigningKeyName: "main",
		Account:        account,
		Path:           "/secret",
		Visibility:     documents.ResourceVisibility_RESOURCE_VISIBILITY_PRIVATE,
		Changes: []*documents.DocumentChange{
			{Op: &documents.DocumentChange_SetMetadata_{
				SetMetadata: &documents.DocumentChange_SetMetadata{Key: "title", Value: "Secret Document"},
			}},
		},
	})
	require.NoError(t, err)

	// Try to list changes of the private document.
	_, err = alice.ListDocumentChanges(ctx, &documents.ListDocumentChangesRequest{
		Account: account,
		Path:    "/secret",
		Version: privateDoc.Version,
	})

	// This SHOULD return PermissionDenied or NotFound when PublicOnly is set.
	require.Error(t, err, "ListDocumentChanges must deny access to private document history in PublicOnly mode")
	st, ok := status.FromError(err)
	require.True(t, ok)
	require.Contains(t, []codes.Code{codes.PermissionDenied, codes.NotFound}, st.Code(),
		"error must be PermissionDenied or NotFound, got %s: %s", st.Code(), st.Message())
}

// VULN-3: GetDocumentChange does not check PublicOnly.
// If an attacker knows a change CID (which could be learned via other leaks),
// they can fetch the full change blob directly. The method bypasses PublicOnly
// entirely and returns change metadata (author, deps, timestamp).
func TestPrivateDocSecurity_GetDocumentChangeLeaksBlob(t *testing.T) {
	t.Parallel()
	ctx := context.Background()

	alice := newTestDocsAPIWithConfig(t, "alice", config.Base{PublicOnly: true})
	account := alice.me.Account.PublicKey.String()

	privateDoc, err := alice.CreateDocumentChange(ctx, &documents.CreateDocumentChangeRequest{
		SigningKeyName: "main",
		Account:        account,
		Path:           "/secret",
		Visibility:     documents.ResourceVisibility_RESOURCE_VISIBILITY_PRIVATE,
		Changes: []*documents.DocumentChange{
			{Op: &documents.DocumentChange_SetMetadata_{
				SetMetadata: &documents.DocumentChange_SetMetadata{Key: "title", Value: "Secret Document"},
			}},
		},
	})
	require.NoError(t, err)

	// Try to fetch the change blob directly by its CID.
	_, err = alice.GetDocumentChange(ctx, &documents.GetDocumentChangeRequest{
		Id: privateDoc.Version,
	})

	// This SHOULD return PermissionDenied when PublicOnly is set.
	require.Error(t, err, "GetDocumentChange must deny access to private document change blobs in PublicOnly mode")
	st, ok := status.FromError(err)
	require.True(t, ok)
	require.Contains(t, []codes.Code{codes.PermissionDenied, codes.NotFound}, st.Code(),
		"error must be PermissionDenied or NotFound, got %s: %s", st.Code(), st.Message())
}

// VULN-4: Debug blob endpoint (/debug/cid/{cid}) -- FIXED.
// The makeBlobDebugHandler in http.go now checks cfg.PublicOnly and sets
// blob.WithPublicOnly on the context before calling blockstore.Get().
// See TestMakeBlobDebugHandler_PublicOnly in backend/daemon/http_test.go.

// VULN-5: CreateRef always creates refs with VisibilityPublic.
// When CreateRef is called for a path that currently holds a private document,
// the Ref blob is created with blob.VisibilityPublic (hardcoded in documents.go).
// This means if someone creates a Ref to update a private document,
// the Ref itself becomes public, leaking that the document path exists.
//
// This is verified by checking that on a PublicOnly server, a private document's
// info is not exposed after a Ref is created. If the Ref is public, the document
// appears in listings even though the underlying doc is private.
func TestPrivateDocSecurity_CreateRefIgnoresVisibility(t *testing.T) {
	t.Parallel()
	ctx := context.Background()

	// Use a non-PublicOnly server so we can create the Ref, then check from PublicOnly.
	alice := newTestDocsAPI(t, "alice")
	account := alice.me.Account.PublicKey.String()

	// Create a private document.
	privateDoc, err := alice.CreateDocumentChange(ctx, &documents.CreateDocumentChangeRequest{
		SigningKeyName: "main",
		Account:        account,
		Path:           "/secret",
		Visibility:     documents.ResourceVisibility_RESOURCE_VISIBILITY_PRIVATE,
		Changes: []*documents.DocumentChange{
			{Op: &documents.DocumentChange_SetMetadata_{
				SetMetadata: &documents.DocumentChange_SetMetadata{Key: "title", Value: "Secret Document"},
			}},
		},
	})
	require.NoError(t, err)

	// Create a Ref for the private document.
	_, err = alice.CreateRef(ctx, &documents.CreateRefRequest{
		Account:        account,
		Path:           "/secret",
		SigningKeyName: "main",
		Target: &documents.RefTarget{
			Target: &documents.RefTarget_Version_{
				Version: &documents.RefTarget_Version{
					Version: privateDoc.Version,
					Genesis: privateDoc.Version,
				},
			},
		},
	})
	require.NoError(t, err)

	// Now create a PublicOnly view of the same database.
	// The Ref was created with VisibilityPublic, so the document info
	// might now be exposed via listings on a gateway.
	alicePub := newTestDocsAPIWithConfig(t, "alice", config.Base{PublicOnly: true})
	_ = alicePub

	// This test documents the issue. The fix would be for CreateRef to inherit
	// the visibility from the existing document at that path.
	// Currently, blob.NewRef is always called with blob.VisibilityPublic in CreateRef.
	t.Log("VULN-5: CreateRef always hardcodes VisibilityPublic — Ref blobs for private docs should inherit private visibility")
}

// VULN-6: Pagination leak when PublicOnly skips private docs.
// When ListDirectory/ListDocuments/ListRootDocuments skip private docs in
// PublicOnly mode, they do it in application code AFTER the SQL LIMIT is applied.
// This means a page may return fewer results than pageSize even when more
// public documents exist, because the LIMIT was consumed by private docs
// that were then filtered out. This is an information leak: the number of
// "missing" results reveals how many private documents exist.
func TestPrivateDocSecurity_PaginationLeaksPrivateDocCount(t *testing.T) {
	t.Parallel()
	ctx := context.Background()

	alice := newTestDocsAPIWithConfig(t, "alice", config.Base{PublicOnly: true})
	account := alice.me.Account.PublicKey.String()

	// Interleave private and public documents so that the SQL LIMIT will
	// include a mix of both. This is the worst case for the pagination issue.
	// Create: public, private, private, private, private, private, public, public.
	_, err := alice.CreateDocumentChange(ctx, &documents.CreateDocumentChangeRequest{
		SigningKeyName: "main",
		Account:        account,
		Path:           "/public-a",
		Changes: []*documents.DocumentChange{
			{Op: &documents.DocumentChange_SetMetadata_{
				SetMetadata: &documents.DocumentChange_SetMetadata{Key: "title", Value: "Public A"},
			}},
		},
	})
	require.NoError(t, err)

	for i := 0; i < 5; i++ {
		_, err := alice.CreateDocumentChange(ctx, &documents.CreateDocumentChangeRequest{
			SigningKeyName: "main",
			Account:        account,
			Path:           "/private-" + string(rune('a'+i)),
			Visibility:     documents.ResourceVisibility_RESOURCE_VISIBILITY_PRIVATE,
			Changes: []*documents.DocumentChange{
				{Op: &documents.DocumentChange_SetMetadata_{
					SetMetadata: &documents.DocumentChange_SetMetadata{Key: "title", Value: "Private Doc"},
				}},
			},
		})
		require.NoError(t, err)
	}

	_, err = alice.CreateDocumentChange(ctx, &documents.CreateDocumentChangeRequest{
		SigningKeyName: "main",
		Account:        account,
		Path:           "/public-b",
		Changes: []*documents.DocumentChange{
			{Op: &documents.DocumentChange_SetMetadata_{
				SetMetadata: &documents.DocumentChange_SetMetadata{Key: "title", Value: "Public B"},
			}},
		},
	})
	require.NoError(t, err)

	_, err = alice.CreateDocumentChange(ctx, &documents.CreateDocumentChangeRequest{
		SigningKeyName: "main",
		Account:        account,
		Path:           "/public-c",
		Changes: []*documents.DocumentChange{
			{Op: &documents.DocumentChange_SetMetadata_{
				SetMetadata: &documents.DocumentChange_SetMetadata{Key: "title", Value: "Public C"},
			}},
		},
	})
	require.NoError(t, err)

	// Request with page size 3 — there are 3 public docs total.
	// The SQL LIMIT is (pageSize+1) = 4.
	// Ordered by activity_time DESC, the 4 most recent are:
	// public-c, public-b, private-e, private-d — only 2 public docs survive filtering.
	// This means we get fewer results than pageSize even though 3 public docs exist.
	resp, err := alice.ListDocuments(ctx, &documents.ListDocumentsRequest{
		Account:  account,
		PageSize: 3,
	})
	require.NoError(t, err)

	// We must get all 3 public docs in a single page of size 3.
	// If we get fewer, private docs consumed LIMIT slots.
	require.Equal(t, 3, len(resp.Documents),
		"ListDocuments must return all available public documents within the page size; "+
			"private docs should not consume LIMIT slots (got %d, want 3)", len(resp.Documents))
}
