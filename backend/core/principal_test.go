package core

import (
	"crypto/rand"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestPrincipalUnsafeString(t *testing.T) {
	// Hardcoded key generated offline.
	me, err := DecodePrincipal("z6Mkv1LjkRosErBhmqrkmb5sDxXNs6EzBDSD8ktywpYLLGuC")
	require.NoError(t, err)
	require.Equal(t, string(me), string(me.UnsafeString()))
}

func TestPrincipalPeerID(t *testing.T) {
	keyPair, err := GenerateKeyPair(Ed25519, rand.Reader)
	require.NoError(t, err)

	got, err := keyPair.Principal().PeerID()
	require.NoError(t, err)
	require.Equal(t, keyPair.PeerID(), got)
}

func TestPrincipalPeerIDRejectsUnsupportedECDSA(t *testing.T) {
	keyPair, err := GenerateKeyPair(ECDSA, rand.Reader)
	require.NoError(t, err)

	_, err = keyPair.Principal().PeerID()
	require.Error(t, err)
}

func TestPrincipalPeerIDRejectsInvalidPrincipal(t *testing.T) {
	_, err := Principal("not a principal").PeerID()
	require.Error(t, err)
}
