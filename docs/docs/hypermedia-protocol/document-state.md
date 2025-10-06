# Document State

A snapshot (or version) of a document may be represented with the following state:

- `metadata`
- `content`

## Document Metadata

The document `metadata` may include the following fields to help describe the purpose of the document and how it should be treated.

- `name` - The title of this document. Or if this is the Home Document, the name of this Account
- `cover` - the `ipfs://` url of the cover image for the document. The cover image is displayed at full width at the top of the document.
- `thumbnail` - the `ipfs://` url of the square image that is used as the thumbnail for this document or account.

## Document Content

Every document will contain a `content` list of [Block Nodes](./block-node.md).

## Example Document

`TODO - show an example document value here`
