---
name: Discriminated Union
summary: A type that is one of a fixed set of variant shapes, told apart by a discriminant.
---
**Discriminated union**: a type that is "one of" a fixed set of [variant](./variant.md) shapes, told apart by a discriminant. In the [meta-schema](../schema.md) the discriminant is the `type` tag, plus three structural tests: the node has `anyOf`, the node has `var`, or `type` names a schema instead of a kind. It is written with [`anyOf`](./anyof.md). [The schema language](./schema-language.md) has the details. <!-- id:Bg10mEhX -->

# See also <!-- id:iDcn4PME -->

- [Variant](./variant.md): the members of the meta-schema union. <!-- id:YBrgfl6- -->
- [Union schema](./anyof.md): the `anyOf` keyword. <!-- id:HL0iMNN7 -->
- [Literal schema](./literal-schema.md): the `type` tag of each blob is a literal. <!-- id:MMs6AWol -->
- [Blob](../blob.md): signed blobs form a discriminated union on `type`. <!-- id:WpHLhbJi -->
