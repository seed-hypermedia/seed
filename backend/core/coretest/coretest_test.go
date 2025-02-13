package coretest

import (
	"seed/backend/core"
	"testing"

	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/stretchr/testify/require"
)

func TestKeys(t *testing.T) {
	alice := NewTester("alice")

	pid, err := peer.IDFromPrivateKey(alice.Device.Libp2pKey())
	require.NoError(t, err)

	require.True(t, alice.Device.PeerID() == pid)
}

func TestEncoding(t *testing.T) {
	alice := NewTester("alice")

	data, err := alice.Account.PublicKey.MarshalBinary()
	require.NoError(t, err)

	var pub core.PublicKey
	require.NoError(t, pub.UnmarshalBinary(data))

	require.True(t, pub.Equal(alice.Account.PublicKey))
	require.Equal(t, alice.Account.String(), pub.String())
}
