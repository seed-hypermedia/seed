package index

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/url"
	"seed/backend/core"
	documents "seed/backend/genproto/documents/v1alpha"
	"seed/backend/hlc"
	"seed/backend/ipfs"
	"seed/backend/util/must"
	"time"

	"github.com/ipfs/go-cid"
	cbornode "github.com/ipfs/go-ipld-cbor"
	"github.com/multiformats/go-multicodec"
	"google.golang.org/protobuf/encoding/protojson"
)

var ProfileGenesisEpoch = must.Do2(time.ParseInLocation(time.RFC3339, "2024-01-01T00:00:00Z", time.UTC)).UnixMicro()

func init() {
	cbornode.RegisterCborType(Change{})
	cbornode.RegisterCborType(ChangeUnsigned{})
}

const blobTypeChange blobType = "Change"

type Change struct {
	ChangeUnsigned
	Sig core.Signature `refmt:"sig,omitempty"`
}

func NewChange(kp core.KeyPair, deps []cid.Cid, action string, payload map[string]any, ts int64) (eb EncodedBlob[*Change], err error) {
	cu := ChangeUnsigned{
		Type:    blobTypeChange,
		Deps:    deps,
		Action:  action,
		Payload: payload,
		Author:  kp.Principal(),
		Ts:      ts,
	}

	cc, err := cu.Sign(kp)
	if err != nil {
		return eb, err
	}

	return encodeBlob(cc)
}

type ChangeUnsigned struct {
	Type    blobType       `refmt:"@type"`
	Deps    []cid.Cid      `refmt:"deps,omitempty"`
	Action  string         `refmt:"action"`
	Payload map[string]any `refmt:"payload"`
	Author  core.Principal `refmt:"author"`
	Ts      int64          `refmt:"ts"`
}

func (c *ChangeUnsigned) Sign(kp core.KeyPair) (cc *Change, err error) {
	if !c.Author.Equal(kp.Principal()) {
		return nil, fmt.Errorf("author mismatch when signing")
	}

	data, err := cbornode.DumpObject(c)
	if err != nil {
		return nil, err
	}

	sig, err := kp.Sign(data)
	if err != nil {
		return nil, err
	}

	return &Change{
		ChangeUnsigned: *c,
		Sig:            sig,
	}, nil
}

func init() {
	matcher := makeCBORTypeMatch(blobTypeChange)

	registerIndexer(blobTypeChange,
		func(c cid.Cid, data []byte) (*Change, error) {
			codec, _ := ipfs.DecodeCID(c)
			if codec != multicodec.DagCbor || !bytes.Contains(data, matcher) {
				return nil, errSkipIndexing
			}

			v := &Change{}
			if err := cbornode.DecodeInto(data, v); err != nil {
				return nil, err
			}

			return v, nil
		},
		indexChange,
	)
}

func indexChange(ictx *indexingCtx, id int64, c cid.Cid, v *Change) error {
	// TODO(burdiyan): ensure there's only one change that brings an entity into life.

	author := v.Author

	var sb StructuralBlob
	{
		var resourceTime time.Time
		if v.Action == "Create" {
			resourceTime = hlc.Timestamp(v.Ts).Time()
		}
		sb = newStructuralBlob(c, string(blobTypeChange), author, hlc.Timestamp(v.Ts).Time(), "", cid.Undef, author, resourceTime)
	}

	// TODO(burdiyan): ensure deps are indexed, not just known.
	// Although in practice deps must always be indexed first, but need to make sure.
	for _, dep := range v.Deps {
		if err := ictx.AssertBlobData(dep); err != nil {
			return fmt.Errorf("missing causal dependency %s of change %s", dep, c)
		}

		sb.AddBlobLink("change/dep", dep)
	}

	// TODO(burdiyan): remove this when all the tests are fixed. Sometimes CBOR codec decodes into
	// different types than what was encoded, and we might not have accounted for that during indexing.
	// So we re-encode the patch here to make sure.
	// This is of course very wasteful.
	// EDIT: actually re-encoding is probably not a bad idea to enforce the canonical encoding, and hash correctness.
	// But it would probably need to happen in some other layer, and more generalized.
	{
		data, err := cbornode.DumpObject(v.Payload)
		if err != nil {
			return err
		}
		v.Payload = nil

		if err := cbornode.DecodeInto(data, &v.Payload); err != nil {
			return err
		}
	}

	if v.Payload["metadata"] != nil {
		for k, v := range v.Payload["metadata"].(map[string]any) {
			vs, ok := v.(string)
			if !ok {
				continue
			}

			u, err := url.Parse(vs)
			if err != nil {
				continue
			}

			if u.Scheme != "ipfs" {
				continue
			}

			c, err := cid.Decode(u.Host)
			if err != nil {
				continue
			}

			sb.AddBlobLink("metadata/"+k, c)

			// TODO(hm24): index other relevant metadata for list response and so on.
		}
	}

	blocks, ok := v.Payload["blocks"].(map[string]any)
	if ok {
		for id, blk := range blocks {
			v, ok := blk.(map[string]any)["#map"]
			if !ok {
				continue
			}
			// This is a very bad way to convert an opaque map into a block struct.
			// TODO(burdiyan): we should do better than this. This is ugly as hell.
			data, err := json.Marshal(v)
			if err != nil {
				return err
			}
			blk := &documents.Block{}
			if err := protojson.Unmarshal(data, blk); err != nil {
				return err
			}
			blk.Id = id
			blk.Revision = c.String()
			if err := indexURL(&sb, ictx.log, blk.Id, "doc/"+blk.Type, blk.Ref); err != nil {
				return err
			}

			for _, ann := range blk.Annotations {
				if err := indexURL(&sb, ictx.log, blk.Id, "doc/"+ann.Type, ann.Ref); err != nil {
					return err
				}
			}
		}
	}

	index, ok := v.Payload["index"].(map[string]any)
	if ok {
		for key, v := range index {
			heads, ok := v.([]cid.Cid)
			if !ok {
				continue
			}
			for _, head := range heads {
				sb.AddBlobLink("index/"+key, head)
			}
		}
	}
	type meta struct {
		Title string `json:"title"`
	}

	attrs, ok := v.Payload["metadata"].(map[string]any)
	if ok {
		title, ok := attrs["title"]
		if !ok {
			alias, ok := attrs["alias"]
			if ok {
				sb.Meta = meta{Title: alias.(string)}
			} else {
				name, ok := attrs["name"]
				if ok {
					sb.Meta = meta{Title: name.(string)}
				}
			}
		} else {
			sb.Meta = meta{Title: title.(string)}
		}
	}
	return ictx.SaveBlob(id, sb)
}
