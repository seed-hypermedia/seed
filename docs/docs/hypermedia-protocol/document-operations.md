# Document Operations

## Set Metadata

`"op": "setMetadata"`

Attributes:
- `field`
- `value`

## Move Block

`"op": "moveBlock"`

Attributes:

- `"block": <BlockId>`
- `"location": "?@?"`
- `"parent": ""`

## Replace Block

`"op": "ReplaceBlock"`

Attributes are equal to the full [Block](./document-blocks) value. The block ID is used to specify which block is being replaced.