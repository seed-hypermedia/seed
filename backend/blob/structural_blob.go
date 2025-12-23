package blob

import (
	"seed/backend/core"
	"time"

	"github.com/ipfs/go-cid"
)

type structuralBlob struct {
	CID         cid.Cid
	Type        Type
	Author      core.Principal
	Ts          time.Time
	GenesisBlob cid.Cid
	Resource    struct {
		ID          IRI
		Owner       core.Principal
		GenesisBlob cid.Cid
		CreateTime  time.Time
	}
	BlobLinks     []blobLink
	ResourceLinks []resourceLink
	ExtraAttrs    any
	Visibility    Visibility
	// VisibilitySpaces are the principals who own/control this blob for private visibility.
	// Only set for private blobs. For public blobs, this is empty.
	// A blob can have multiple visibility spaces (e.g., a comment owned by both signer and target doc space).
	VisibilitySpaces []core.Principal
}

func newStructuralBlob(
	id cid.Cid,
	blobType Type,
	author core.Principal,
	ts time.Time,
	resource IRI,
	resourceGenesis cid.Cid,
	resourceOwner core.Principal,
	resourceTimestamp time.Time,
	visibility Visibility,
	visibilitySpaces []core.Principal,
) structuralBlob {
	sb := structuralBlob{
		CID:              id,
		Type:             blobType,
		Author:           author,
		Ts:               ts,
		Visibility:       visibility,
		VisibilitySpaces: visibilitySpaces,
	}
	sb.Resource.ID = resource
	sb.Resource.Owner = resourceOwner
	sb.Resource.CreateTime = resourceTimestamp
	sb.Resource.GenesisBlob = resourceGenesis

	return sb
}

func newSimpleStructuralBlob(id cid.Cid, blobType Type, visibility Visibility) structuralBlob {
	return structuralBlob{CID: id, Type: blobType, Visibility: visibility}
}

func (sb *structuralBlob) AddBlobLink(linkType string, target cid.Cid) {
	sb.BlobLinks = append(sb.BlobLinks, blobLink{Type: linkType, Target: target})
}

func (sb *structuralBlob) AddResourceLink(linkType string, target IRI, isPinned bool, meta any) {
	sb.ResourceLinks = append(sb.ResourceLinks, resourceLink{Type: linkType, Target: target, IsPinned: isPinned, Meta: meta})
}

type blobLink struct {
	Type   string
	Target cid.Cid
}

type resourceLink struct {
	Type     string
	Target   IRI
	IsPinned bool
	Meta     any
}
