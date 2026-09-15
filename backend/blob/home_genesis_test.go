package blob

import (
	"encoding/hex"
	"strings"
	"testing"

	"seed/backend/core"

	"github.com/ipfs/go-cid"
	cbornode "github.com/ipfs/go-ipld-cbor"
	"github.com/multiformats/go-multicodec"
	"github.com/multiformats/go-multihash"
	"github.com/stretchr/testify/require"
)

// The home document's genesis is a wire-format contract shared with the client SDK.
//
// ensureProfileGenesis (documents API) and the SDK's createHomeGenesisChange must produce the
// same bytes for the same key: an empty Change {ts: 0, sig, type, signer}, signed over the
// encoding with a zeroed signature. The daemon addresses blobs by blake2b-256 and the SDK by
// sha256, so the same bytes carry two CIDs; both are pinned here and, with the same values, in
// frontend/packages/client/src/home-genesis.test.ts. Change one without the other and an
// account's home document forks between devices.
//
// Key: the shared test fixture account (test-fixtures/account.json).
const (
	homeGenesisFixtureMnemonic = "legal winner thank year wave sausage worth useful legal winner thank yellow"
	homeGenesisFixtureAccount  = "z6MkhMSRCyK9KkAzTmzTKSfuNMaEuYZUJacWmbqiHYkCQgSW"
	homeGenesisGoldenBytes     = "a462747300637369675840c07500a616d134a9e1f65828df3d106b5d36a88db2bb8d90f958c23b3eb009c455298a9fe4b878621fd4791f46603bf632e1bd6ef76dc614a30dae30d93fd50a6474797065664368616e6765667369676e65725822ed012b154dea9ea72d6c636ec820845c615f99469bb15d2091048a79c4416c5ffc2b"
	homeGenesisGoldenSDKCID    = "bafyreibhn2gdntqwdbxbc57nkoyi67zhsmiu4sgwxenfcfucqe2mljn5w4"
	homeGenesisGoldenDaemonCID = "bafy2bzaceatflan6p5gb3polaggn6znslbr2mfre77anuni6ukxcnzuziy4g2"
)

func TestHomeGenesisMatchesClientSDK(t *testing.T) {
	kp, err := core.KeyPairFromMnemonic(strings.Fields(homeGenesisFixtureMnemonic), "")
	require.NoError(t, err)
	require.Equal(t, homeGenesisFixtureAccount, kp.Principal().String(), "fixture key must derive the fixture account")

	genesis, err := NewChange(kp, cid.Undef, nil, 0, ChangeBody{}, ZeroUnixTime())
	require.NoError(t, err)

	require.Equal(t, homeGenesisGoldenBytes, hex.EncodeToString(genesis.Data), "home genesis bytes must match the SDK golden")
	require.Equal(t, homeGenesisGoldenDaemonCID, genesis.CID.String(), "daemon addresses the home genesis by blake2b-256")

	sha, err := multihash.Sum(genesis.Data, multihash.SHA2_256, -1)
	require.NoError(t, err)
	require.Equal(t, homeGenesisGoldenSDKCID, cid.NewCidV1(uint64(multicodec.DagCbor), sha).String(), "the SDK addresses the same bytes by sha256")

	// Exactly an empty change: no body, genesis, deps or depth on the wire.
	var decoded map[string]any
	require.NoError(t, cbornode.DecodeInto(genesis.Data, &decoded))
	keys := make([]string, 0, len(decoded))
	for k := range decoded {
		keys = append(keys, k)
	}
	require.ElementsMatch(t, []string{"ts", "sig", "type", "signer"}, keys)
	require.EqualValues(t, 0, decoded["ts"])
	require.Equal(t, "Change", decoded["type"])
}
