---
name: Discriminated Union
summary: A discriminated union is a type that is one of a fixed set of shapes, where one field or test tells which shape a value has.
---
A **discriminated union** is a type that is one of a fixed set of shapes. Something in each value tells which shape it has. That something is called the discriminant. For example, every signed [blob](../protocol/blobs.md) has a `type` field: `"Change"` means the value is a [change](../change.md), and `"Comment"` means it is a [comment](../protocol/comments.md). <!-- id:Bg10mEhX -->

Each shape is a [variant](./variant.md). You write a discriminated union with [`anyOf`](./anyof.md), one arm per variant.

In the [meta-schema](../schema.md) the discriminant is the `type` tag, plus six other tests:

- the node has `anyOf`,
- the node has `allOf`,
- the node has `var`,
- the node has `value`,
- `type` names a schema instead of a [kind](./kind.md),
- the node is a bare value and not a map.

[The schema language](./schema-language.md) has the details.

# See also <!-- id:iDcn4PME -->

- [Variant](./variant.md): the members of the meta-schema union. <!-- id:YBrgfl6- -->
- [Union schema](./anyof.md): the `anyOf` keyword. <!-- id:HL0iMNN7 -->
- [Literal schema](./literal-schema.md): the `type` tag of each blob is a literal. <!-- id:MMs6AWol -->
- [Blob](../blob.md): signed blobs form a discriminated union on `type`. <!-- id:WpHLhbJi -->
