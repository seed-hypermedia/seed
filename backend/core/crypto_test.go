package core

import (
	"crypto/rand"
	"encoding"
	"seed/backend/util/must"
	"testing"

	"github.com/stretchr/testify/require"
)

// Ensure interface implementations.
var (
	_ Signer                     = (*KeyPair)(nil)
	_ Verifier                   = (*KeyPair)(nil)
	_ Verifier                   = PublicKey{}
	_ encoding.BinaryMarshaler   = PublicKey{}
	_ encoding.BinaryMarshaler   = (*KeyPair)(nil)
	_ encoding.BinaryUnmarshaler = (*KeyPair)(nil)
)

func TestDIDKeyCompatibility(t *testing.T) {
	do := func(in string) {
		t.Helper()

		pk, err := DecodePublicKey(in)
		require.NoError(t, err)
		require.Equal(t, in, pk.String(), "string round trip must match")
	}

	// Ed25519 keys from DID Key spec.
	do("z6MkiTBz1ymuepAQ4HEHYSF1H8quG5GLVVQR3djdX3mDooWp")
	do("z6MkjchhfUsD6mmvni8mCdXHw216Xrm9bQe2mBH1P5RDjVJG")
	do("z6MknGc3ocHs3zdPiJbnaaqDi58NGb4pk1Sp9WxWufuXSdxf")

	// P-256 keys from DID Key spec.
	do("zDnaerDaTF5BXEavCrfRZEk316dpbLsfPDZ3WJ5hRTPFU2169")
	do("zDnaerx9CtbPJ1q36T5Ln5wYt3MQYeGRG5ehnPAmxcf5mDZpv")
}

func TestECDSA_RoundTrip(t *testing.T) {
	kp, err := GenerateKeyPair(ECDSA, rand.Reader)
	require.NoError(t, err)
	data := []byte("Hello world!")

	sig, err := kp.Sign(data)
	require.NoError(t, err)

	require.NoError(t, kp.Verify(data, sig))
}

func TestECDSA_WebCrypto(t *testing.T) {
	// Data generated in the browser with Web Crypto API.
	privJWK := `{"crv":"P-256","d":"MFWkbkbbIb38ZIbBlrjgaxrT-0X7270G-g3RcT7pwjE","ext":true,"key_ops":["sign"],"kty":"EC","x":"h-BAUytJE173PKebhfzQGRcW2Q30jsU_fAc9EwrsZwU","y":"Klzh8OBpmty3SNvaOFXxCKvVRVO5q4dfUTXaJJYaoWs"}`
	wantPubKey := []byte{2, 153, 9, 67, 23, 220, 91, 7, 233, 191, 199, 73, 16, 79, 67, 203, 51, 99, 246, 120, 191, 38, 112, 190, 255, 162, 60, 149, 171, 16, 202, 5, 9}
	wantSig := []byte{173, 103, 66, 75, 3, 124, 24, 252, 159, 172, 88, 94, 200, 123, 83, 13, 240, 230, 67, 94, 109, 61, 81, 105, 92, 209, 131, 86, 52, 56, 141, 65, 151, 62, 193, 53, 182, 231, 113, 41, 130, 169, 12, 88, 154, 252, 100, 242, 185, 193, 181, 67, 201, 75, 163, 150, 163, 217, 147, 100, 39, 104, 98, 192}
	data := []byte("Hello world!")

	_ = privJWK

	var pk PublicKey
	{
		var raw []byte
		raw = append(raw, ecdsaSpec.PrincipalVarintPrefix...)
		raw = append(raw, wantPubKey...)
		pk = must.Do2(DecodePublicKey(raw))
		require.Equal(t, raw, pk.Bytes())
	}

	require.NoError(t, pk.Verify(data, wantSig))

	// var pk Principal
	// pk = append(pk, pubKeyCodecBytes[multicodec.P256Pub]...)
	// pk = append(pk, pubKey...)

	// require.NoError(t, pk.Verify(cleartext, sig))
}
