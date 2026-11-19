---
name: Generic
summary: A generic is a schema with a blank for a type, which you fill in when you use the schema.
---
A **generic** is a schema with a blank for a type. You fill in the blank when you use the schema. For example, [`change`](../change.md) is `Change<Block>`: a change that works for any [block](../protocol/blocks.md) type you give it. <!-- id:srZ8LHVL -->

A generic has three parts:

- **Declare** the blanks with `params`. Each parameter has a name and a default type.
- **Use** a parameter with [`var`](./var-schema.md), such as `{ "var": "B" }`.
- **Fill in** the parameters with `args`: `{ "type": X, "args": { "B": … } }`.

A parameter passes through references to other schemas. When nothing fills it in, it uses its default.

[`example/myapp-change`](../example/myapp-change.md) fills in the `Block` parameter of `change`. [The schema language](./schema-language.md) has the details.

# See also <!-- id:YavMNM84 -->

- [Var schema](./var-schema.md): the type-variable reference. <!-- id:cpSN4cA1 -->
- [Change](../change.md): the library's generic `Change<Block>`. <!-- id:hLHFPu8i -->
- [Extension](./extension.md): the other way to reuse a schema. <!-- id:-AjBpHrg -->
- [The schema language](./schema-language.md): the full vocabulary. <!-- id:_sq5nqE_ -->
