package blob

import (
	"fmt"
	"seed/backend/ipfs"

	"github.com/ipfs/go-cid"
	dagpb "github.com/ipld/go-codec-dagpb"
	"github.com/ipld/go-ipld-prime"
	"github.com/ipld/go-ipld-prime/datamodel"
	cidlink "github.com/ipld/go-ipld-prime/linking/cid"
	"github.com/ipld/go-ipld-prime/traversal"
	"github.com/multiformats/go-multicodec"
)

// TypeDagPB is the type for DAG-PB blobs.
const TypeDagPB Type = "DagPB"

func init() {
	registerIndexer(TypeDagPB,
		func(c cid.Cid, data []byte) (eb Encoded[datamodel.Node], err error) {
			codec, _ := ipfs.DecodeCID(c)
			if codec != multicodec.DagPb {
				return eb, errSkipIndexing
			}

			b := dagpb.Type.PBNode.NewBuilder()
			if err := dagpb.DecodeBytes(b, data); err != nil {
				return eb, fmt.Errorf("failed to decode dagpb node %s: %w", c, err)
			}

			v := b.Build()

			eb.CID = c
			eb.Data = data
			eb.Decoded = v
			return eb, nil
		},
		indexDagPB,
	)
}

func indexDagPB(ictx *indexingCtx, _ int64, eb Encoded[datamodel.Node]) error {
	c, v := eb.CID, eb.Decoded

	sb := newSimpleStructuralBlob(c, TypeDagPB)

	if err := traversal.WalkLocal(v, func(_ traversal.Progress, n ipld.Node) error {
		pblink, ok := n.(dagpb.PBLink)
		if !ok {
			return nil
		}

		target, ok := pblink.Hash.Link().(cidlink.Link)
		if !ok {
			return fmt.Errorf("link is not CID: %v", pblink.Hash)
		}

		linkType := "dagpb/chunk"
		if pblink.Name.Exists() {
			if name := pblink.Name.Must().String(); name != "" {
				linkType = "dagpb/" + name
			}
		}

		sb.AddBlobLink(linkType, target.Cid)
		return nil
	}); err != nil {
		return err
	}

	return ictx.SaveBlob(sb)
}
