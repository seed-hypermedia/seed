package mttnet

import (
	"seed/backend/core/coretest"
	"seed/backend/testutil"
	"seed/backend/util/must"
	"testing"
	"time"

	"github.com/libp2p/go-libp2p/core/connmgr"
	"github.com/libp2p/go-libp2p/core/peer"
	cmgrimpl "github.com/libp2p/go-libp2p/p2p/net/connmgr"
)

func TestUnsafeConnManager(t *testing.T) {
	// This test checks that our terrible unsafe hack with connection manager works.
	// We want to know the protected tags for each peer, but this info is not exposed by the connection manager.
	// So we use unsafe hacks with reflection, to get access to those fields.
	// This test will panic and fail miserably if those fields that we use change somehow with newer versions of libp2p.

	alice := coretest.NewTester("alice")
	bob := coretest.NewTester("bob")

	cmgr := unwrapConnManager(must.Do2(cmgrimpl.NewConnManager(5, 10)))

	cmgr.Protect(alice.Device.PeerID(), "mytag")
	cmgr.TagPeer(bob.Device.PeerID(), "mymytag", 10)

	allPeers := []peer.ID{alice.Device.PeerID(), bob.Device.PeerID()}

	want := connManagerInfo{
		TotalPeers: 2,
		ShownPeers: 2,
		PeersPerTag: map[string]int{
			"mymytag": 1,
		},
		PeersPerProtection: map[string]int{
			"mytag": 1,
		},
		Peers: []connManagerPeerInfo{
			{
				PeerID:  alice.Device.PeerID(),
				TagInfo: nil,
				ProtectedTags: []string{
					"mytag",
				},
			},
			{
				PeerID: bob.Device.PeerID(),
				TagInfo: &connmgr.TagInfo{
					Value: 10,
					Tags: map[string]int{
						"mymytag": 10,
					},
					Conns: map[string]time.Time{},
				},
				ProtectedTags: nil,
			},
		},
	}

	got := getConnManagerInfo(allPeers, cmgr)

	testutil.StructsEqual(want, got).
		IgnoreFields(connmgr.TagInfo{}, "FirstSeen").
		Compare(t, "connManagerInfo must match")
}
