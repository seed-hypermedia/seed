# Document Operations

Each document operation takes the following format:

```json
{
    "op": "SetAttributes",
    "attributes": {
        "name": "New Document Name"
    }
}
```

The `op` is used to specify which operation is being used. The `attributes` will mean different things, depending on the operation.

## Set Metadata Operation

`"op": "SetMetadata"`

Attributes is a Map of new [Document Metadata](./document-state.md#document-metadata) fields that will be set.

## Move Block Operation

`"op": "MoveBlock"`

Attributes:

- `"block": <BlockId>`
- `"location": "?@?"`
- `"parent": ""`

## Replace Block Operation

`"op": "ReplaceBlock"`

Attributes are equal to the full [Block](./document-blocks.md) value. The block ID is used to specify which block is being replaced.