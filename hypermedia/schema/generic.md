---
name: Generic
summary: a schema parameterized over a type.
---
**Generic**: a schema parameterized over a type. Declared with `params` (named type parameters, each with a default), used via `var` (a type-variable reference, `{ "var": "B" }`), and instantiated with `args` (`{ "type": X, "args": { "B": … } }`). The parameter threads through references and defaults when unbound. Worked example: `Change<Block>` (`change`) instantiated as `example/myapp-change`. ([the schema language](./schema-language.md)) <!-- id:srZ8LHVL -->
