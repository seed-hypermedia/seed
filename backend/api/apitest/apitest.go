// Package apitest contains helper for testing the APIs.
package apitest

import (
	"fmt"
	"seed/backend/core"
	documents "seed/backend/genproto/documents/v3alpha"

	"google.golang.org/protobuf/types/known/emptypb"
)

// ChangeBuilder is a helper for conveniently building document changes for the API.
type ChangeBuilder struct {
	req *documents.CreateDocumentChangeRequest
}

// NewChangeBuilder creates a new ChangeBuilder.
func NewChangeBuilder(account core.Principal, path, baseVersion, keyName string) *ChangeBuilder {
	return &ChangeBuilder{
		req: &documents.CreateDocumentChangeRequest{
			Account:        account.String(),
			Path:           path,
			BaseVersion:    baseVersion,
			SigningKeyName: keyName,
		},
	}
}

// SetCapability sets the capability.
func (b *ChangeBuilder) SetCapability(cpbID string) *ChangeBuilder {
	b.req.Capability = cpbID
	return b
}

// SetMetadata adds a SetMetadata change to the request.
func (b *ChangeBuilder) SetMetadata(key, value string) *ChangeBuilder {
	b.req.Changes = append(b.req.Changes, &documents.DocumentChange{
		Op: &documents.DocumentChange_SetMetadata_{
			SetMetadata: &documents.DocumentChange_SetMetadata{Key: key, Value: value},
		},
	})
	return b
}

// SetAttribute adds a SetAttribute change to the request.
func (b *ChangeBuilder) SetAttribute(blockID string, key []string, value any) *ChangeBuilder {
	op := &documents.DocumentChange_SetAttribute_{
		SetAttribute: &documents.DocumentChange_SetAttribute{
			BlockId: blockID,
			Key:     key,
		},
	}

	switch vv := value.(type) {
	case string:
		op.SetAttribute.Value = &documents.DocumentChange_SetAttribute_StringValue{StringValue: vv}
	case int:
		op.SetAttribute.Value = &documents.DocumentChange_SetAttribute_IntValue{IntValue: int64(vv)}
	case int64:
		op.SetAttribute.Value = &documents.DocumentChange_SetAttribute_IntValue{IntValue: vv}
	case bool:
		op.SetAttribute.Value = &documents.DocumentChange_SetAttribute_BoolValue{BoolValue: vv}
	case nil:
		op.SetAttribute.Value = &documents.DocumentChange_SetAttribute_NullValue{NullValue: &emptypb.Empty{}}
	default:
		panic(fmt.Errorf("unsupported attribute value type %T: %v", value, value))
	}

	b.req.Changes = append(b.req.Changes, &documents.DocumentChange{
		Op: op,
	})

	return b
}

// MoveBlock adds a MoveBlock change to the request.
func (b *ChangeBuilder) MoveBlock(blockID, parent, leftSibling string) *ChangeBuilder {
	b.req.Changes = append(b.req.Changes, &documents.DocumentChange{
		Op: &documents.DocumentChange_MoveBlock_{
			MoveBlock: &documents.DocumentChange_MoveBlock{BlockId: blockID, Parent: parent, LeftSibling: leftSibling},
		},
	})
	return b
}

// ReplaceBlock adds a ReplaceBlock change to the request.
func (b *ChangeBuilder) ReplaceBlock(block, btype, text string, annotations ...*documents.Annotation) *ChangeBuilder {
	b.req.Changes = append(b.req.Changes, &documents.DocumentChange{
		Op: &documents.DocumentChange_ReplaceBlock{
			ReplaceBlock: &documents.Block{
				Id:          block,
				Type:        btype,
				Text:        text,
				Annotations: annotations,
			},
		},
	})
	return b
}

// DeleteBlock adds a DeleteBlock change to the request.
func (b *ChangeBuilder) DeleteBlock(block string) *ChangeBuilder {
	b.req.Changes = append(b.req.Changes, &documents.DocumentChange{
		Op: &documents.DocumentChange_DeleteBlock{DeleteBlock: block},
	})
	return b
}

// Build returns the built request.
func (b *ChangeBuilder) Build() *documents.CreateDocumentChangeRequest {
	return b.req
}
