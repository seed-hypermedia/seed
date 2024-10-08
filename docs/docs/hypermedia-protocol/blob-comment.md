# Comment Blob

A Comment Blob is content that is created from a single author. It is created in the context of a specific document, possibly in reply to another comment, which may form a tree of commentary.

## Blob Map Field

- `@type: 'Comment'`
- `capability`
- `author`
- `space`
- `path`
- `version`
- `threadRoot`
- `replyParent`
- `body`
- `ts` - [Timestamp](./timestamp.md) when this Comment was created
- `sig` - [Hypermedia Signature](./signature.md) of the other fields, signed by the `author`
