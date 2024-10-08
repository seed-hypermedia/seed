# Permanent Data

Hypermedia content is expressed in a graph of connected [IPFS](./ipfs) files/blobs. Each blob is identified by a [CID](./cid).

To understand the data of our network, you should first review the [Hypermedia concepts](./concepts), which will be heavily referenced.

## Structured Data

You will start to read content via structured data blobs, which are encoded using IPLD DAG-CBOR. These blobs can be converted to JSON for easier readability, and our docs will generally show you the structured data in JSON format.

Each of our structured data blobs contain a `@type` field, which designate how they should be interpreted.

### Change

The change blob is used to describe how a document changes or is created.

- `@type: 'Change'`
- author
- deps
- depth
- genesis
- opts
- sig
- ts

### Ref

### Capability

### Comment


## Other IPFS files

The structured data may refer to raw IPFS files, generally as a string prefixed with `ipfs://`. This is used when images, videos, or other files are included in documents and comments.

These files are inserted directly into IPFS and are then referenced by their CID.