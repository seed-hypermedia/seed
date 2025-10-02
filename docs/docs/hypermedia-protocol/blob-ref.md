# Ref Blob

The Ref Blob is used by a document owner or contributer to point to the most recent version, according to the author, at the time of authoring.

## Blob Map Field

- `@type: 'Ref'`
- `space` - The Account ID
- `path` - The path for this document, within the Space
- `genesisBlob` - The first Change in the chain of changes for this Document
- `capability` - Reference to the Capability Blob,
- `heads` - List of References to Chagne CIDs that represent current Version
- `author` - [Raw Account ID](./raw-account-id.md) of the creator of the Ref
- `ts` - [Timestamp](./timestamp.md) when this Ref was created
- `sig` - [Hypermedia Signature](./signature.md) of the other fields, signed by the `author`

## Document Addressing

The Ref is created to show the latest version for a specific document.

## Capability

If the `author` is not

## Heads

The heads represent the Version of the document. They are [links](./ipld-link.md) refer to a set of [Change Blobs](./blob-change.md).
