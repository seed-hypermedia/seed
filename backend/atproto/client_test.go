package atproto

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestParseATURI(t *testing.T) {
	tests := []struct {
		name       string
		uri        string
		wantRepo   string
		wantColl   string
		wantRkey   string
		wantErr    bool
	}{
		{
			name:     "valid post uri",
			uri:      "at://did:plc:abc123/app.bsky.feed.post/xyz789",
			wantRepo: "did:plc:abc123",
			wantColl: "app.bsky.feed.post",
			wantRkey: "xyz789",
		},
		{
			name:     "valid like uri",
			uri:      "at://did:plc:abc123/app.bsky.feed.like/xyz789",
			wantRepo: "did:plc:abc123",
			wantColl: "app.bsky.feed.like",
			wantRkey: "xyz789",
		},
		{
			name:     "valid follow uri",
			uri:      "at://did:plc:abc123/app.bsky.graph.follow/xyz789",
			wantRepo: "did:plc:abc123",
			wantColl: "app.bsky.graph.follow",
			wantRkey: "xyz789",
		},
		{
			name:    "invalid - no at:// prefix",
			uri:     "did:plc:abc123/app.bsky.feed.post/xyz789",
			wantErr: true,
		},
		{
			name:    "invalid - missing parts",
			uri:     "at://did:plc:abc123/app.bsky.feed.post",
			wantErr: true,
		},
		{
			name:    "invalid - empty",
			uri:     "",
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			repo, coll, rkey, err := parseATURI(tt.uri)
			if tt.wantErr {
				require.Error(t, err)
				return
			}
			require.NoError(t, err)
			require.Equal(t, tt.wantRepo, repo)
			require.Equal(t, tt.wantColl, coll)
			require.Equal(t, tt.wantRkey, rkey)
		})
	}
}

func TestNewClient(t *testing.T) {
	t.Run("default PDS", func(t *testing.T) {
		client := NewClient("")
		require.Equal(t, DefaultPDS, client.PDSURL())
	})

	t.Run("custom PDS", func(t *testing.T) {
		client := NewClient("https://custom.pds.example")
		require.Equal(t, "https://custom.pds.example", client.PDSURL())
	})

	t.Run("trim trailing slash", func(t *testing.T) {
		client := NewClient("https://custom.pds.example/")
		require.Equal(t, "https://custom.pds.example", client.PDSURL())
	})
}

func TestClientAuthentication(t *testing.T) {
	client := NewClient("")

	t.Run("not authenticated initially", func(t *testing.T) {
		require.False(t, client.IsAuthenticated())
		did, handle, isAuth := client.GetSession()
		require.Empty(t, did)
		require.Empty(t, handle)
		require.False(t, isAuth)
	})

	t.Run("set session", func(t *testing.T) {
		client.SetSession("access", "refresh", "did:plc:test", "test.bsky.social")
		require.True(t, client.IsAuthenticated())
		did, handle, isAuth := client.GetSession()
		require.Equal(t, "did:plc:test", did)
		require.Equal(t, "test.bsky.social", handle)
		require.True(t, isAuth)
	})
}

func TestInMemoryStore(t *testing.T) {
	store := NewInMemoryStore()
	ctx := t.Context()

	conn := &Connection{
		SeedAccount: "z123",
		DID:         "did:plc:test",
		Handle:      "test.bsky.social",
		PDSURL:      DefaultPDS,
	}

	t.Run("save and load", func(t *testing.T) {
		err := store.Save(ctx, conn)
		require.NoError(t, err)

		loaded, err := store.Load(ctx, "z123")
		require.NoError(t, err)
		require.Equal(t, conn.DID, loaded.DID)
	})

	t.Run("list", func(t *testing.T) {
		list, err := store.List(ctx)
		require.NoError(t, err)
		require.Len(t, list, 1)
	})

	t.Run("delete", func(t *testing.T) {
		err := store.Delete(ctx, "z123")
		require.NoError(t, err)

		loaded, err := store.Load(ctx, "z123")
		require.NoError(t, err)
		require.Nil(t, loaded)
	})
}
