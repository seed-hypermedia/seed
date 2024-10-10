# Change Blob

The Change Blob is used to describe how a document changes or is created.

## Blob Map Field

- `@type: 'Change'`
- `author` - Raw Account ID of the creator of the change
- `deps` - List of [Links](./ipld-link.md) to the previous Change Blobs
- `depth` - ???
- `genesis` - [Link](./ipld-link.md) of the last Change Blob in the chain
- `ops` - List of [Document Operations](./document-operations.md)
- `ts` - [Timestamp](./timestamp.md) when this Change was created
- `sig` - [Hypermedia Signature](./signature.md) of the other fields, signed by the `author`


## Dependencies

Previous Change Blobs of the Document.

## Operations

List of [Document Operations](./document-operations.md) which will modify the [Document State](./document-state.md) after interpreting the Change.