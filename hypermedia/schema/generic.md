---
name: Generic
summary: A schema parameterized over a type.
---
**Generic**: a schema parameterized over a type. You declare it with `params` (named type parameters, each with a default). You use a parameter with [`var`](./var-schema.md), a type-variable reference such as `{ "var": "B" }`. You instantiate the generic with `args`: `{ "type": X, "args": { "B": … } }`. The parameter passes through references and falls back to its default when unbound. The worked example is `Change<Block>` ([`change`](../change.md)), instantiated as [`example/myapp-change`](../example/myapp-change.md). [The schema language](./schema-language.md) has the details. <!-- id:srZ8LHVL -->

# See also <!-- id:YavMNM84 -->

- [Var schema](./var-schema.md): the type-variable reference. <!-- id:cpSN4cA1 -->
- [Change](../change.md): the library's generic `Change<Block>`. <!-- id:hLHFPu8i -->
- [Extension](./extension.md): the other way to reuse a schema. <!-- id:-AjBpHrg -->
- [The schema language](./schema-language.md): the full vocabulary. <!-- id:_sq5nqE_ -->
