package entities

import (
	"seed/backend/blob"
	"seed/backend/core/coretest"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestParseDiscoveryURL(t *testing.T) {
	t.Parallel()

	alice := coretest.NewTester("alice").Account.Principal()
	aliceID := alice.String()

	type want struct {
		iri       string
		recursive bool
		depthOne  bool
		blobTypes []string
		errLike   string
	}

	tests := []struct {
		name string
		in   string
		want want
	}{
		{
			name: "account root, no scope",
			in:   "hm://" + aliceID,
			want: want{iri: "hm://" + aliceID},
		},
		{
			name: "account root with trailing slash",
			in:   "hm://" + aliceID + "/",
			want: want{iri: "hm://" + aliceID},
		},
		{
			name: "exact path",
			in:   "hm://" + aliceID + "/notes/foo",
			want: want{iri: "hm://" + aliceID + "/notes/foo"},
		},
		{
			name: "profile at root",
			in:   "hm://" + aliceID + "/:profile",
			want: want{
				iri:       "hm://" + aliceID,
				blobTypes: []string{"Profile", "Ref", "Change"},
			},
		},
		{
			name: "profile at nested path",
			in:   "hm://" + aliceID + "/notes/foo:profile",
			want: want{
				iri:       "hm://" + aliceID + "/notes/foo",
				blobTypes: []string{"Profile", "Ref", "Change"},
			},
		},
		{
			name: "depth-1 wildcard at root",
			in:   "hm://" + aliceID + "/*",
			want: want{
				iri:      "hm://" + aliceID,
				depthOne: true,
			},
		},
		{
			name: "depth-1 wildcard at nested path",
			in:   "hm://" + aliceID + "/notes/*",
			want: want{
				iri:      "hm://" + aliceID + "/notes",
				depthOne: true,
			},
		},
		{
			name: "recursive wildcard at root",
			in:   "hm://" + aliceID + "/**",
			want: want{
				iri:       "hm://" + aliceID,
				recursive: true,
			},
		},
		{
			name: "recursive wildcard at nested path",
			in:   "hm://" + aliceID + "/notes/**",
			want: want{
				iri:       "hm://" + aliceID + "/notes",
				recursive: true,
			},
		},
		{
			name: "unknown scope keyword treated as path content",
			in:   "hm://" + aliceID + "/notes/foo:bar",
			want: want{iri: "hm://" + aliceID + "/notes/foo:bar"},
		},
		{
			name: "scope keyword in middle segment is path content",
			in:   "hm://" + aliceID + "/notes:profile/foo",
			want: want{iri: "hm://" + aliceID + "/notes:profile/foo"},
		},
		{
			name: "profile combined with ** is mutually exclusive",
			in:   "hm://" + aliceID + "/notes/**:profile",
			want: want{errLike: "mutually exclusive"},
		},
		{
			name: "profile combined with * is mutually exclusive",
			in:   "hm://" + aliceID + "/notes/*:profile",
			want: want{errLike: "mutually exclusive"},
		},
		{
			name: "empty input",
			in:   "",
			want: want{errLike: "empty"},
		},
		{
			name: "wrong scheme",
			in:   "https://" + aliceID,
			want: want{errLike: "scheme"},
		},
		{
			name: "missing account",
			in:   "hm://",
			want: want{errLike: "account"},
		},
		{
			name: "bad account",
			in:   "hm://not-a-real-principal",
			want: want{errLike: "account"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := parseDiscoveryURL(tt.in)
			if tt.want.errLike != "" {
				require.Error(t, err)
				require.Contains(t, err.Error(), tt.want.errLike)
				return
			}
			require.NoError(t, err)
			require.Equal(t, blob.IRI(tt.want.iri), got.IRI, "iri")
			require.Equal(t, tt.want.recursive, got.Recursive, "recursive")
			require.Equal(t, tt.want.depthOne, got.DepthOne, "depthOne")
			require.Equal(t, tt.want.blobTypes, got.BlobTypes, "blobTypes")
		})
	}
}
