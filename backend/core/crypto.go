package core

import (
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"encoding/binary"
	"fmt"
	"io"
	"math/big"
	"seed/backend/util/must"
	"seed/backend/util/unsafeutil"

	"github.com/libp2p/go-libp2p/core/crypto"
	"github.com/libp2p/go-libp2p/core/crypto/pb"
	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/multiformats/go-multibase"
	"github.com/multiformats/go-multicodec"
)

// Signer signs data and produces cryptographic signature.
type Signer interface {
	Sign([]byte) (Signature, error)
	SignatureSize() int
}

// Verifier checks that signature corresponds to the data.
type Verifier interface {
	Verify(data []byte, s Signature) error
	SignatureSize() int
}

// Signature is a cryptographic signature of some piece of data.
type Signature []byte

// KeyType is an alias for key types defined in Libp2p's crypto package.
type KeyType int

// Key types.
const (
	Ed25519 KeyType = KeyType(pb.KeyType_Ed25519)
	ECDSA   KeyType = KeyType(pb.KeyType_ECDSA)
)

var (
	ed25519Spec = registerSpec(&keySpec{
		KeyType:               Ed25519,
		PrincipalCode:         multicodec.Ed25519Pub,
		PrincipalVarintPrefix: binary.AppendUvarint(nil, uint64(multicodec.Ed25519Pub)),
		SignatureSize:         ed25519.SignatureSize,
		PublicKeySize:         ed25519.PublicKeySize,
		SignFunc: func(key any, data []byte) (Signature, error) {
			k := key.(ed25519.PrivateKey)
			return ed25519.Sign(k, data), nil
		},
		VerifyFunc: func(key any, data []byte, sig Signature) error {
			k := key.(ed25519.PublicKey)
			if !ed25519.Verify(k, data, sig) {
				return fmt.Errorf("invalid signature")
			}
			return nil
		},
		PubRawBytesFunc: func(key any) []byte {
			k := key.(ed25519.PublicKey)
			return k
		},
		PubEqualFunc: func(akey, bkey any) bool {
			return akey.(ed25519.PublicKey).Equal(bkey.(ed25519.PublicKey))
		},
		PubLibp2pFunc: func(key any) crypto.PubKey {
			return must.Do2(crypto.UnmarshalEd25519PublicKey(key.(ed25519.PublicKey)))
		},
	})

	ecdsaSpec = registerSpec(&keySpec{
		KeyType:               ECDSA,
		PrincipalCode:         multicodec.P256Pub,
		PrincipalVarintPrefix: binary.AppendUvarint(nil, uint64(multicodec.P256Pub)),
		SignatureSize:         64,
		PublicKeySize:         33, // Compressed ECDSA public key
		SignFunc: func(key any, data []byte) (Signature, error) {
			k := key.(*ecdsa.PrivateKey)
			sum := sha256.Sum256(data)
			r, s, err := ecdsa.Sign(rand.Reader, k, sum[:])
			if err != nil {
				return nil, err
			}
			out := make([]byte, 64)
			r.FillBytes(out[:32])
			s.FillBytes(out[32:])
			return out, nil
		},
		VerifyFunc: func(key any, data []byte, sig Signature) error {
			r, s := new(big.Int).SetBytes(sig[:32]), new(big.Int).SetBytes(sig[32:])
			sum := sha256.Sum256(data)

			k := key.(ecdsa.PublicKey)

			if !ecdsa.Verify(&k, sum[:], r, s) {
				return fmt.Errorf("invalid signature")
			}
			return nil
		},
		PubRawBytesFunc: func(key any) []byte {
			k := key.(ecdsa.PublicKey)
			return elliptic.MarshalCompressed(k.Curve, k.X, k.Y)
		},
		PubEqualFunc: func(akey any, bkey any) bool {
			a := akey.(ecdsa.PublicKey)
			b := bkey.(ecdsa.PublicKey)
			return a.Equal(b)
		},
		PubLibp2pFunc: func(key any) crypto.PubKey {
			return must.Do2(crypto.ECDSAPublicKeyFromPubKey(key.(ecdsa.PublicKey)))
		},
	})

	specByCodec = make(map[multicodec.Code]*keySpec)
	specByType  = make(map[KeyType]*keySpec)
)

func registerSpec(in *keySpec) *keySpec {
	if specByCodec[in.PrincipalCode] != nil || specByType[in.KeyType] != nil {
		panic("spec already registered")
	}
	specByCodec[in.PrincipalCode] = in
	specByType[in.KeyType] = in
	return in
}

type keySpec struct {
	KeyType               KeyType
	PrincipalCode         multicodec.Code
	PrincipalVarintPrefix []byte
	SignatureSize         int
	PublicKeySize         int
	SignFunc              func(key any, data []byte) (Signature, error)
	VerifyFunc            func(key any, data []byte, sig Signature) error
	PubRawBytesFunc       func(key any) []byte
	PubEqualFunc          func(akey, bkey any) bool
	PubLibp2pFunc         func(key any) crypto.PubKey
}

// KeyPair is a "union" type that represents our supported private key types.
type KeyPair struct {
	inner any // concrete value specific to the key type
	spec  *keySpec
	PublicKey

	// This value will be cached after the first access.
	pid peer.ID
}

// NewKeyPair creates our KeyPair wrapper from an existing private key.
func NewKeyPair[T *ecdsa.PrivateKey | ed25519.PrivateKey](key T) *KeyPair {
	switch key := any(key).(type) {
	case *ecdsa.PrivateKey:
		return &KeyPair{
			inner:     key,
			spec:      ecdsaSpec,
			PublicKey: NewPublicKey(key.PublicKey),
		}
	case ed25519.PrivateKey:
		return &KeyPair{
			inner:     key,
			spec:      ed25519Spec,
			PublicKey: NewPublicKey(key.Public().(ed25519.PublicKey)),
		}
	default:
		panic(fmt.Errorf("BUG: unhandled key type %T", key))
	}
}

// PublicKey is a public key of a key pair.
type PublicKey struct {
	inner any
	spec  *keySpec
}

// NewPublicKey creates a new "union" PublicKey type from an existing public key instance.
func NewPublicKey[T ed25519.PublicKey | ecdsa.PublicKey](key T) PublicKey {
	switch key := any(key).(type) {
	case ecdsa.PublicKey:
		// PeerID encoding is not supported.
		return PublicKey{
			inner: key,
			spec:  ecdsaSpec,
		}
	case ed25519.PublicKey:
		return PublicKey{
			inner: key,
			spec:  ed25519Spec,
		}
	default:
		panic(fmt.Errorf("BUG: unhandled key type %T", key))
	}
}

// PublicKeyFromLibp2p creates a new PublicKey from a libp2p public key.
func PublicKeyFromLibp2p(pub crypto.PubKey) PublicKey {
	switch pk := pub.(type) {
	case *crypto.Ed25519PublicKey:
		return NewPublicKey(ed25519PubKeyCaster.Cast(pk).pub)
	case *crypto.ECDSAPublicKey:
		return NewPublicKey(*p256PubKeyCaster.Cast(pk).pub)
	default:
		panic(fmt.Errorf("unsupported public key type %T", pub))
	}
}

// GenerateKeyPair creates a new random key pair of the specified type.
func GenerateKeyPair(kt KeyType, rng io.Reader) (*KeyPair, error) {
	if rng == nil {
		rng = rand.Reader
	}

	switch kt {
	case Ed25519:
		_, priv, err := ed25519.GenerateKey(rng)
		if err != nil {
			return nil, err
		}
		return NewKeyPair(priv), nil
	case ECDSA:
		priv, err := ecdsa.GenerateKey(elliptic.P224(), rng)
		if err != nil {
			return nil, err
		}
		return NewKeyPair(priv), nil
	default:
		return nil, fmt.Errorf("unsupported key type %v", kt)
	}
}

// KeyPairFromLibp2p creates a new KeyPair from a libp2p private key.
func KeyPairFromLibp2p(priv crypto.PrivKey) (*KeyPair, error) {
	switch pk := priv.(type) {
	case *crypto.Ed25519PrivateKey:
		return NewKeyPair(ed25519PrivKeyCaster.Cast(pk).priv), nil
	case *crypto.ECDSAPrivateKey:
		return NewKeyPair(p256PrivKeyCaster.Cast(pk).priv), nil
	default:
		return nil, fmt.Errorf("unsupported private key type %T", priv)
	}
}

// Libp2pKey creates transforms the key pair into a libp2p key.
func (kp *KeyPair) Libp2pKey() crypto.PrivKey {
	if kp == nil {
		return nil
	}
	switch inner := kp.inner.(type) {
	case ed25519.PrivateKey:
		return must.Do2(crypto.UnmarshalEd25519PrivateKey(inner))
	case *ecdsa.PrivateKey:
		priv, _, err := crypto.ECDSAKeyPairFromKey(inner)
		if err != nil {
			panic(err)
		}
		return priv
	default:
		panic(fmt.Errorf("BUG: invalid inner private key type %T", inner))
	}
}

// SignatureSize implements [Signer].
func (kp *KeyPair) SignatureSize() int {
	return kp.spec.SignatureSize
}

// Sign implements [Signer].
func (kp *KeyPair) Sign(data []byte) (Signature, error) {
	return kp.spec.SignFunc(kp.inner, data)
}

// PeerID returns the peer ID of the key pair.
func (kp *KeyPair) PeerID() peer.ID {
	if kp.pid == "" {
		pid, err := peer.IDFromPrivateKey(kp.Libp2pKey())
		if err != nil {
			panic(err)
		}
		kp.pid = pid
	}

	return kp.pid
}

// MarshalBinary implements [encoding.BinaryMarshaler].
// It uses libp2p encoding for compatibility reasons.
// It's mostly internal and may be changed in the future.
func (kp *KeyPair) MarshalBinary() ([]byte, error) {
	return crypto.MarshalPrivateKey(kp.Libp2pKey())
}

// UnmarshalBinary implements [encoding.BinaryUnmarshaler].
// It uses libp2p encoding for compatibility reasons.
// It's mostly internal and may be changed in the future.
func (kp *KeyPair) UnmarshalBinary(in []byte) (err error) {
	if kp == nil {
		panic("BUG: can't unmarshal into non-nil key pair")
	}

	if len(in) == 0 {
		return fmt.Errorf("can't decode empty private key")
	}

	priv, err := crypto.UnmarshalPrivateKey(in)
	if err != nil {
		return fmt.Errorf("failed to unmarshal libp2p private key: %w", err)
	}

	k, err := KeyPairFromLibp2p(priv)
	if err != nil {
		return fmt.Errorf("KeyPairFromLibp2p failed: %w", err)
	}

	*kp = *k
	return nil
}

// Verify implements [Verifier].
func (p PublicKey) Verify(data []byte, sig Signature) error {
	if len(sig) != p.spec.SignatureSize {
		return fmt.Errorf("signature size mismatch: expected %d, got %d", p.spec.SignatureSize, len(sig))
	}

	return p.spec.VerifyFunc(p.inner, data, sig)
}

// Principal returns the byte packed representation of the public key.
func (p PublicKey) Principal() Principal {
	return Principal(p.Bytes())
}

// ActorID is a 56-bit replica/actor/origin ID
// that we use in our CRDT Op IDs.
// 56 bits should be enough to avoid collisions for our use case,
// because each OpID also contains a millisecond timestamp,
// and it's more compatible with other environments, like JS, that may not work well with uint64.
// It's derived from the public key of the actor, by hashing it with sha256,
// and taking the first 56 bits of the hash as a *little-endian* unsigned integer.
type ActorID uint64

// ActorID returns a derived ActorID from the principal.
// It performs calculations, so it's better to cache the result if it's used multiple times.
func (p PublicKey) ActorID() ActorID {
	sum := sha256.Sum256(p.Bytes())
	sum[7] = 0 // clearing the last byte because we only want 56 bits.
	return ActorID(binary.LittleEndian.Uint64(sum[:8]))
}

// String implements [fmt.Stringer].
func (p PublicKey) String() string {
	buf := p.Bytes()
	s, err := multibase.Encode(multibase.Base58BTC, buf)
	if err != nil {
		panic(err)
	}
	return s
}

// IsZero checks if the public key is a zero value.
func (p PublicKey) IsZero() bool {
	return p.inner == nil
}

// Bytes returns the byte representation of a public key.
// We use <multicodec-varint><raw-public-key-bytes> format.
// If [PublicKey] is zero value, the result is a nil slice.
func (p PublicKey) Bytes() []byte {
	if p.inner == nil {
		return nil
	}

	raw := p.spec.PubRawBytesFunc(p.inner)
	out := make([]byte, 0, len(p.spec.PrincipalVarintPrefix)+len(raw))
	out = append(out, p.spec.PrincipalVarintPrefix...)
	out = append(out, raw...)
	return out
}

// Explode is a legacy function that returns the multicodec of the key and the remaining raw bytes of the key.
func (p PublicKey) Explode() (multicodec.Code, []byte) {
	return p.spec.PrincipalCode, p.Bytes()[len(p.spec.PrincipalVarintPrefix):]
}

// Equal checks if two public keys are equal.
func (p PublicKey) Equal(pp PublicKey) bool {
	if p.spec != pp.spec {
		return false
	}

	return p.spec.PubEqualFunc(p.inner, pp.inner)
}

// Libp2pKey creates a libp2p public key from the public key.
func (p PublicKey) Libp2pKey() crypto.PubKey {
	return p.spec.PubLibp2pFunc(p.inner)
}

// SignatureSize implements [Verifier].
func (p PublicKey) SignatureSize() int {
	return p.spec.SignatureSize
}

// UnmarshalBinary implements [encoding.BinaryUnmarshaler].
func (p *PublicKey) UnmarshalBinary(data []byte) error {
	codec, n := binary.Uvarint(data)
	raw := data[n:]
	switch multicodec.Code(codec) {
	case multicodec.Ed25519Pub:
		if len(raw) != ed25519Spec.PublicKeySize {
			return fmt.Errorf("invalid ed25519 public key size: expected %d, got %d", ed25519Spec.PublicKeySize, len(raw))
		}
		*p = NewPublicKey(ed25519.PublicKey(data[n:]))
		return nil
	case multicodec.P256Pub:
		if len(raw) != ecdsaSpec.PublicKeySize {
			return fmt.Errorf("invalid ECDSA public key size: expected %d, got %d", ecdsaSpec.PublicKeySize, len(raw))
		}

		x, y := elliptic.UnmarshalCompressed(elliptic.P256(), data[n:])
		pk := ecdsa.PublicKey{
			Curve: elliptic.P256(),
			X:     x,
			Y:     y,
		}
		*p = NewPublicKey(pk)
		return nil
	default:
		return fmt.Errorf("unsupported public key codec %d", multicodec.Code(codec))
	}
}

// MarshalBinary implements [encoding.BinaryMarshaler].
// It's the same as [PublicKey.Bytes], but also returns an error to conform with the interface.
func (p PublicKey) MarshalBinary() ([]byte, error) {
	return p.Bytes(), nil
}

// DecodePublicKey decodes a public key from encoded bytes or string.
func DecodePublicKey[T string | []byte | Principal](raw T) (pk PublicKey, err error) {
	if len(raw) == 0 {
		return pk, fmt.Errorf("can't decode empty public key")
	}

	switch in := any(raw).(type) {
	case string:
		_, bytes, err := multibase.Decode(in)
		if err != nil {
			return pk, err
		}
		return pk, pk.UnmarshalBinary(bytes)
	case []byte:
		return pk, pk.UnmarshalBinary(in)
	case Principal:
		return pk, pk.UnmarshalBinary(in)
	default:
		panic("BUG: invalid type")
	}
}

var (
	p256PrivKeyCaster = unsafeutil.NewCaster(crypto.ECDSAPrivateKey{}, struct{ priv *ecdsa.PrivateKey }{})
	p256PubKeyCaster  = unsafeutil.NewCaster(crypto.ECDSAPublicKey{}, struct{ pub *ecdsa.PublicKey }{})

	ed25519PrivKeyCaster = unsafeutil.NewCaster(crypto.Ed25519PrivateKey{}, struct{ priv ed25519.PrivateKey }{})
	ed25519PubKeyCaster  = unsafeutil.NewCaster(crypto.Ed25519PublicKey{}, struct{ pub ed25519.PublicKey }{})
)
