# Permanent Data

Hypermedia content is expressed in a graph of connected [IPFS](./ipfs.md) files/blobs. Each blob is identified by a [CID](./cid.md).

To understand the data of our network, you should first review the [Hypermedia concepts](./concepts.md), which will be heavily referenced.

## Structured Data

You will start to read content via structured data blobs, which are encoded using the [IPLD DAG-CBOR encoding](https://ipld.io/specs/codecs/dag-cbor/spec/). These blobs can be converted to JSON for easier readability, and our docs will generally show you the structured data in JSON format.

Each of our structured data blobs contain a `@type` field, which designate how they should be interpreted.

### [Change](./blob-change.md)

The Change Blob is used to describe how a document changes or is created.

### [Ref](./blob-ref.md)

The Ref Blob is used by a document owner or contributer to point to the most recent version, according to the author, at the time of authoring.

### [Capability](./blob-capability.md)

The Capability Blob is created by accounts to grant priveliges for another account to access or control an additional document (or tree of documents).

### [Comment](./blob-comment.md)

A Comment Blob is content that is created from a single author. It is created in the context of a specific document, possibly in reply to another comment, which may form a tree of commentary.

## Other IPFS files

The structured data may refer to raw IPFS files, generally as a string prefixed with `ipfs://`. This is used when images, videos, or other files are included in documents and comments.

These files are inserted directly into IPFS and are then referenced by their CID.