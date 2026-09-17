---
name: Visibility
summary: The visibility of a Ref or Comment, empty for public and "Private" for private, from which every Change and file it links inherits its own visibility.
schemaDefinition: ipfs://bafyreiadi3rmadehyfsby7yojvnrjbfxy6fwusrqaseod5z3n3uzcq37da
---
**Visibility** says who may see a resource. Only two values exist: the empty string, meaning public, and `Private`, meaning only the space owner, its writers and its [site](./protocol/sites.md) may read it. <!-- id:eJZsyhDa -->

This page defines the **visibility** value type, a string with two allowed values, carried by [Ref](./ref.md) and [Comment](./comment.md) blobs. Its formal schema is attached as the `schemaDefinition` in this document's metadata, so the app can show it. <!-- id:_Usl-W2U -->

Only Refs and Comments carry the field. [Changes](./change.md) and [files](./protocol/files.md) have no visibility of their own. They become public by propagation when a public Ref or Comment links to them, and stay private otherwise, whatever order the blobs arrive in. A document's effective visibility is the value on the newest Ref of its current generation. A private Ref must name a single-segment path. A comment carries its own visibility, usually copied from the document it targets. As of September 2026 the daemon refuses to prepare the first change of a new private document outside its tests, and its own `CreateRef` always writes public Refs. So private visibility applies to documents that were already private. [Privacy](./protocol/privacy.md) has the model and its direction. <!-- id:8SNo7uW9 -->

# Shape <!-- id:GHhmRztM -->

Kind: `string`. One of: , `Private`. <!-- id:cmT7iNGC -->

# See also <!-- id:r5i9GC9F -->

- [Privacy](./protocol/privacy.md): the private document model. <!-- id:qSWY01UJ -->
- [ref](./ref.md): the blob whose visibility sets a document's. <!-- id:SwE-8GaF -->
- [comment](./comment.md): comments carry their own visibility. <!-- id:IpEEKo-M -->
- [role](./role.md): which writers can read private content. <!-- id:s9W1K0v8 -->
