---
name: Visibility
summary: The visibility of a Ref or Comment, empty for public and "Private" for private, from which every Change and file it links inherits its own visibility.
---
**Visibility** says who may see a piece of content. Only two values exist. The empty string means public. `Private` means the content is handed only to the [space](./protocol/spaces.md) owner, to keys the owner granted access, and to the space's [site](./protocol/sites.md). [Privacy](./protocol/privacy.md) has the exact rules, which differ for HTTP and for [peer sync](./protocol/network.md). <!-- id:eJZsyhDa -->

This page defines the **visibility** value type: a string with two allowed values. [Ref](./ref.md) and [Comment](./comment.md) [blobs](./protocol/blobs.md) carry it. Its formal schema is attached to this [document](./protocol/documents.md) as the `schemaDefinition` key of its metadata, so the app can show it. <!-- id:_Usl-W2U -->

Only Refs and Comments carry the field. [Changes](./change.md) and [files](./protocol/files.md) have no visibility of their own. They become public when a public Ref or Comment links to them. Otherwise they stay private. The order in which the blobs arrive does not matter. A document's visibility is the value on the newest Ref of its current generation. A private Ref must name a path of one segment. A [comment](./protocol/comments.md) carries its own visibility, usually copied from the document it is about. The [daemon](./software/daemon.md) refuses to prepare the first Change of a new private document, except in its tests, and its own `CreateRef` always writes public Refs. So through the daemon, private visibility applies only to documents that are already private. [Privacy](./protocol/privacy.md) has the model. <!-- id:8SNo7uW9 -->

# See also <!-- id:r5i9GC9F -->

- [Privacy](./protocol/privacy.md): the private document model. <!-- id:qSWY01UJ -->
- [ref](./ref.md): the blob whose visibility sets a document's. <!-- id:SwE-8GaF -->
- [comment](./comment.md): comments carry their own visibility. <!-- id:IpEEKo-M -->
- [role](./role.md): which writers can read private content. <!-- id:s9W1K0v8 -->
- [Catalogue of types](./schema/types.md): every type in the library.
