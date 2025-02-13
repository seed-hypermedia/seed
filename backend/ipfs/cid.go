package ipfs

import (
	"encoding/binary"

	"github.com/ipfs/go-cid"
	"github.com/multiformats/go-multicodec"
	multihash "github.com/multiformats/go-multihash"
)

// NewCID creates a new CID from data.
func NewCID(codec, hashType uint64, data []byte) (cid.Cid, error) {
	mh, err := multihash.Sum(data, hashType, -1)
	if err != nil {
		return cid.Undef, err
	}

	return cid.NewCidV1(codec, mh), nil
}

// MustNewCID creates a new CID from data and panics if it fails.
func MustNewCID[T ~uint64](codec, hashType T, data []byte) cid.Cid {
	c, err := NewCID(uint64(codec), uint64(hashType), data)
	if err != nil {
		panic(err)
	}
	return c
}

// DecodeCID reads the CID multicodec and the multihash part of it.
func DecodeCID(c cid.Cid) (multicodec.Code, multihash.Multihash) {
	data := c.Bytes()

	if c.Version() == 0 {
		return cid.DagProtobuf, multihash.Multihash(data)
	}

	var pos int

	_, n := binary.Uvarint(data) // read CID version
	pos += n

	codec, n := binary.Uvarint(data[pos:])
	pos += n

	return multicodec.Code(codec), data[pos:]
}
