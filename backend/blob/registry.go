package blob

import (
	"bytes"
	"errors"
	"fmt"

	"github.com/fxamacker/cbor/v2"
	"github.com/ipfs/go-cid"
)

var errSkipIndexing = errors.New("skip indexing")

// indexFunc is a type of function that indexes a blob.
// Different blob types can register their own index function with the globa registry.
type indexFunc func(ictx *indexingCtx, id int64, c cid.Cid, data []byte) error

// This is a global registry of indexers.
// We have a map to avoid registering multiple functions for the same blob type.
// We have a list because all the indexers are called sequentially and it's faster than iterating over map by values.
// See registerIndexer for more info.
var (
	indexersMap  = map[blobType]int{}
	indexersList []indexFunc
)

// registerIndexer registers an indexing function for the given blob type.
// The decodeFunc should parse the raw bytes and attempt to decode them into a concrete type.
// All the indexer functions are called for every blob, so decodeFunc should return errSkipIndexing
// if the raw blob data doesn't match its expectations.
// It should return an error if data does match but fails to decode.
// The indexFunc does the actual indexing work with the concrete type.
func registerIndexer[T any](
	bt blobType,
	decodeFunc func(cid.Cid, []byte) (decoded T, err error), // !ok means skip indexing, but no error.
	indexFunc func(ictx *indexingCtx, id int64, c cid.Cid, decoded T) error,
) {
	if _, ok := indexersMap[bt]; ok {
		panic(fmt.Sprintf("RegisterIndexer: already registered: %s", bt))
	}

	idxfn := func(ictx *indexingCtx, id int64, c cid.Cid, data []byte) error {
		decoded, err := decodeFunc(c, data)
		if errors.Is(err, errSkipIndexing) {
			return nil
		}
		if err != nil {
			return err
		}

		return indexFunc(ictx, id, c, decoded)
	}

	indexersList = append(indexersList, idxfn)
	indexersMap[bt] = len(indexersList) - 1
}

// makeCBORTypeMatch returns a subslice of CBOR bytes that could be used to match
// our CBOR blob types with `type` field. If we find this subslice
// we can attempt to decode the blob as CBOR data into the corresponding concrete type.
func makeCBORTypeMatch(blobType blobType) []byte {
	var b bytes.Buffer
	if err := cbor.MarshalToBuffer("type", &b); err != nil {
		panic(err)
	}

	if err := cbor.MarshalToBuffer(blobType, &b); err != nil {
		panic(err)
	}

	return b.Bytes()
}
