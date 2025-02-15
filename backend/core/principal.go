package core

import (
	"crypto/sha256"
	"encoding/binary"
	"unsafe"

	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/multiformats/go-multibase"
	"github.com/multiformats/go-multicodec"
)

// Principal is a packed, typed, binary public key representation.
// It's the same as what [PublicKey.Bytes] returns.
// It's used when the full parsed public key structure is not needed.
type Principal []byte

// ActorID returns a derived ActorID from the principal.
// It performs calculations, so it's better to cache the result if it's used multiple times.
func (p Principal) ActorID() ActorID {
	sum := sha256.Sum256(p)
	sum[7] = 0 // clearing the last byte because we only want 56 bits.
	return ActorID(binary.LittleEndian.Uint64(sum[:8]))
}

// PeerID returns the Libp2p PeerID representation of a key.
func (p Principal) PeerID() (peer.ID, error) {
	pk, err := DecodePublicKey(p)
	if err != nil {
		return "", err
	}
	_ = pk
	panic("TODO")

	// return pk.PeerID(), nil
}

// Explode splits the principal into it's multicodec and raw key bytes.
func (p Principal) Explode() (multicodec.Code, []byte) {
	code, n := binary.Uvarint(p)
	return multicodec.Code(code), p[n:]
}

// String encodes Principal as a string, using base58btc encoding as defined in DID Key spec.
func (p Principal) String() string {
	if len(p) == 0 {
		return ""
	}

	s, err := multibase.Encode(multibase.Base58BTC, p)
	if err != nil {
		panic(err)
	}
	return s
}

// UnsafeString casts raw bytes to a without copying.
// Useful for using as map key.
func (p Principal) UnsafeString() string {
	return unsafe.String(&p[0], len(p))
}

// Equal checks if two principals are equal.
func (p Principal) Equal(pp Principal) bool {
	return p.UnsafeString() == pp.UnsafeString()
}

// Parse the packed public key into the full [PublicKey] structure.
func (p Principal) Parse() (PublicKey, error) {
	return DecodePublicKey(p)
}

// MarshalText implements encoding.TextMarshaler.
func (p Principal) MarshalText() ([]byte, error) {
	return []byte(p.String()), nil
}

// UnmarshalText implements encoding.TextUnmarshaler.
func (p *Principal) UnmarshalText(data []byte) error {
	pp, err := DecodePrincipal(string(data))
	if err != nil {
		return err
	}
	*p = pp
	return nil
}

// DecodePrincipal decodes the principal from its string representation.
func DecodePrincipal[T string | []byte](raw T) (Principal, error) {
	pk, err := DecodePublicKey(raw)
	if err != nil {
		return nil, err
	}

	return pk.Principal(), nil
}
