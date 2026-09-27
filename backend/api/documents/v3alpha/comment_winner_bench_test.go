package documents

import (
	"fmt"
	"github.com/stretchr/testify/require"
	"seed/backend/api/apitest"
	pb "seed/backend/genproto/documents/v3alpha"
	"testing"
)

// BenchmarkCommentWinnerPaths is deliberately RPC-only setup so the exact same
// fixture can run on the pre-account protocol base as well as the PR head.
func BenchmarkCommentWinnerPaths(b *testing.B) {
	for _, n := range []int{1, 10, 100} {
		b.Run(fmt.Sprintf("versions=%d", n), func(b *testing.B) {
			srv := newTestDocsAPI(b, "alice")
			ctx := b.Context()
			account := srv.me.Account.PublicKey.String()
			doc, err := srv.PublishDocumentChangeForTest(ctx, &apitest.DocumentChangeRequest{SigningKeyName: "main", Account: account, Path: "/bench", Changes: []*pb.DocumentChange{{Op: &pb.DocumentChange_SetMetadata_{SetMetadata: &pb.DocumentChange_SetMetadata{Key: "title", Value: "benchmark"}}}}})
			require.NoError(b, err)
			content := func(text string) []*pb.BlockNode {
				return []*pb.BlockNode{{Block: &pb.Block{Id: "body", Type: "paragraph", Text: text}}}
			}
			parent, err := srv.CreateComment(ctx, &pb.CreateCommentRequest{SigningKeyName: "main", TargetAccount: account, TargetPath: doc.Path, TargetVersion: doc.Version, Content: content("parent")})
			require.NoError(b, err)
			for i := 0; i < n; i++ {
				if i > 0 {
					parent.Content = content(fmt.Sprint("parent ", i))
					parent, err = srv.UpdateComment(ctx, &pb.UpdateCommentRequest{SigningKeyName: "main", Comment: parent})
					require.NoError(b, err)
				}
				reply, err := srv.CreateComment(ctx, &pb.CreateCommentRequest{SigningKeyName: "main", TargetAccount: account, TargetPath: doc.Path, TargetVersion: doc.Version, ReplyParent: parent.Id, Content: content("reply")})
				require.NoError(b, err)
				for j := 0; j < 3; j++ {
					reply.Content = content(fmt.Sprint("reply ", j))
					reply, err = srv.UpdateComment(ctx, &pb.UpdateCommentRequest{SigningKeyName: "main", Comment: reply})
					require.NoError(b, err)
				}
			}
			b.Run("ReplyCount", func(b *testing.B) {
				b.ReportAllocs()
				for b.Loop() {
					_, err := srv.GetCommentReplyCount(ctx, &pb.GetCommentReplyCountRequest{Id: parent.Id})
					if err != nil {
						b.Fatal(err)
					}
				}
			})
			b.Run("GetResource", func(b *testing.B) {
				b.ReportAllocs()
				for b.Loop() {
					_, err := srv.GetResource(ctx, &pb.GetResourceRequest{Iri: "hm://" + parent.Id})
					if err != nil {
						b.Fatal(err)
					}
				}
			})
			b.Run("Reindex", func(b *testing.B) {
				b.ReportAllocs()
				for b.Loop() {
					if err := srv.idx.Reindex(ctx); err != nil {
						b.Fatal(err)
					}
				}
			})
		})
	}
}
