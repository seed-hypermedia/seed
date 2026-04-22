package syncing

import (
	"context"
	"crypto/rand"
	"fmt"
	"testing"

	"seed/backend/blob"
	"seed/backend/core"

	blocks "github.com/ipfs/go-block-format"
	"github.com/ipfs/go-cid"
	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/stretchr/testify/require"
)

func TestComputeAuthInfoUsesListKeyPairs(t *testing.T) {
	ctx := context.Background()

	spaceKey, err := core.GenerateKeyPair(core.Ed25519, rand.Reader)
	require.NoError(t, err)
	space := spaceKey.Principal()

	authorizedKey, err := core.GenerateKeyPair(core.Ed25519, rand.Reader)
	require.NoError(t, err)
	unauthorizedKey, err := core.GenerateKeyPair(core.Ed25519, rand.Reader)
	require.NoError(t, err)

	store := &fakeAuthKeyStore{
		keyPairs: []core.NamedKeyPair{
			{Name: "authorized", KeyPair: authorizedKey},
			{Name: "unauthorized", KeyPair: unauthorizedKey},
		},
	}
	index := &fakeAuthIndex{
		siteURLs: map[string]string{
			space.String(): "https://site.example",
		},
		addrInfos: map[string]peer.AddrInfo{
			"https://site.example": {ID: peer.ID("peer-1")},
		},
		authorizedSpaces: map[string][]core.Principal{
			authorizedKey.Principal().String(): {space},
		},
	}

	svc := &Service{
		index:    index,
		keyStore: store,
	}

	info := svc.computeAuthInfo(ctx, map[string]bool{
		fmt.Sprintf("hm://%s/doc", space.String()): true,
	})

	require.Equal(t, 1, store.listKeyPairsCalls)
	require.Zero(t, store.listKeysCalls)
	require.Zero(t, store.getKeyCalls)
	require.Len(t, info.peerKeys, 1)
	require.Contains(t, info.peerKeys, peer.ID("peer-1"))
	require.Len(t, info.peerKeys[peer.ID("peer-1")], 1)
	require.Equal(t, authorizedKey.Principal(), info.peerKeys[peer.ID("peer-1")][0].Principal())
	require.Equal(t, peer.ID("peer-1"), info.addrInfos[peer.ID("peer-1")].ID)
}

type fakeAuthKeyStore struct {
	listKeyPairsCalls int
	listKeysCalls     int
	getKeyCalls       int
	keyPairs          []core.NamedKeyPair
}

func (f *fakeAuthKeyStore) GetKey(context.Context, string) (*core.KeyPair, error) {
	f.getKeyCalls++
	return nil, fmt.Errorf("unexpected GetKey call")
}

func (f *fakeAuthKeyStore) StoreKey(context.Context, string, *core.KeyPair) error {
	panic("unexpected StoreKey call")
}

func (f *fakeAuthKeyStore) ListKeys(context.Context) ([]core.NamedKey, error) {
	f.listKeysCalls++
	return nil, fmt.Errorf("unexpected ListKeys call")
}

func (f *fakeAuthKeyStore) DeleteKey(context.Context, string) error {
	panic("unexpected DeleteKey call")
}

func (f *fakeAuthKeyStore) DeleteAllKeys(context.Context) error {
	panic("unexpected DeleteAllKeys call")
}

func (f *fakeAuthKeyStore) ChangeKeyName(context.Context, string, string) error {
	panic("unexpected ChangeKeyName call")
}

func (f *fakeAuthKeyStore) ListKeyPairs(context.Context) ([]core.NamedKeyPair, error) {
	f.listKeyPairsCalls++
	return f.keyPairs, nil
}

type fakeAuthIndex struct {
	siteURLs         map[string]string
	addrInfos        map[string]peer.AddrInfo
	authorizedSpaces map[string][]core.Principal
}

func (f *fakeAuthIndex) Put(context.Context, blocks.Block) error {
	panic("unexpected Put call")
}

func (f *fakeAuthIndex) PutMany(context.Context, []blocks.Block) error {
	panic("unexpected PutMany call")
}

func (f *fakeAuthIndex) GetAuthorizedSpacesForPeer(context.Context, peer.ID, []blob.IRI) ([]core.Principal, error) {
	panic("unexpected GetAuthorizedSpacesForPeer call")
}

func (f *fakeAuthIndex) GetSiteURL(_ context.Context, space core.Principal) (string, error) {
	return f.siteURLs[space.String()], nil
}

func (f *fakeAuthIndex) ResolveSiteURL(_ context.Context, siteURL string) (peer.AddrInfo, error) {
	addrInfo, ok := f.addrInfos[siteURL]
	if !ok {
		return peer.AddrInfo{}, fmt.Errorf("missing site URL %q", siteURL)
	}
	return addrInfo, nil
}

func (f *fakeAuthIndex) GetAuthorizedSpaces(_ context.Context, accounts []core.Principal) ([]core.Principal, error) {
	if len(accounts) != 1 {
		return nil, fmt.Errorf("expected exactly one account, got %d", len(accounts))
	}
	return f.authorizedSpaces[accounts[0].String()], nil
}

func (f *fakeAuthIndex) FindProvidersAsync(context.Context, cid.Cid, int) <-chan peer.AddrInfo {
	panic("unexpected FindProvidersAsync call")
}
