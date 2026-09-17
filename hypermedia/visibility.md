---
name: Visibility
summary: The visibility of a Ref or Comment, empty for public and "Private" for private, from which every Change and file it links inherits its own visibility.
schemaDefinition: ipfs://bafyreiadi3rmadehyfsby7yojvnrjbfxy6fwusrqaseod5z3n3uzcq37da
---
Visibility says who may see a resource. Only two values exist: the empty string, meaning public, and `Private`, meaning only the space owner, its writers and its site may read it. <!-- id:eJZsyhDa -->

This page defines the **visibility** value type, a string with two allowed values, carried by [Ref](./ref.md) and [Comment](./comment.md) blobs. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it. <!-- id:_Usl-W2U -->

Only Refs and Comments carry the field. Changes and files have no visibility of their own: they become public by propagation when a public Ref or Comment links to them, and stay private otherwise, whatever order the blobs arrive in. A document's effective visibility is the value on the newest Ref of its current generation. A private Ref must name a single-segment path, and a comment carries its own visibility, usually copied from the document it targets. As of September 2026 the daemon refuses to prepare the first change of a new private document outside its tests and its own `CreateRef` always writes public Refs, so private visibility applies to documents that were already private; the model and its direction are in [Privacy](./protocol/privacy.md). <!-- id:8SNo7uW9 -->

# Shape <!-- id:GHhmRztM -->

Kind: `string`. One of: , `Private`. <!-- id:cmT7iNGC -->
