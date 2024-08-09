package index

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

const blobTypeDagPB blobType = "DagPB"

func init() {
	registerIndexer(blobTypeDagPB,
		func(c cid.Cid, data []byte) (datamodel.Node, error) {
			codec, _ := ipfs.DecodeCID(c)
			if codec != multicodec.DagPb {
				return nil, errSkipIndexing
			}

			b := dagpb.Type.PBNode.NewBuilder()
			if err := dagpb.DecodeBytes(b, data); err != nil {
				return nil, fmt.Errorf("failed to decode dagpb node %s: %w", c, err)
			}

			v := b.Build()
			return v, nil
		},
		indexDagPB,
	)
}

func indexDagPB(ictx *indexingCtx, id int64, c cid.Cid, v datamodel.Node) error {
	sb := newSimpleStructuralBlob(c, string(blobTypeDagPB))

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

	return ictx.SaveBlob(id, sb)
}
