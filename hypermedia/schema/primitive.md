---
name: Primitive
summary: 'One of the library schemas `<kind>.schema.json`, each exactly `{ "type": <kind> }`, such as `string` or `boolean`.'
---
**Primitive**: one of the library schemas `<kind>.schema.json`, each exactly `{ "type": <kind> }` (for example `string` or `boolean`). It is the canonical, content-addressed block for a [kind](./kind.md). A field says what it is by naming one: `{ "type": "hm://…/string" }` names the kind and references that block at once, with the same key that names any other schema. A primitive is an _instance_ of the [meta-schema](../schema.md). A [variant](./variant.md) is different: it is a _shape_ in the union that makes up the meta-schema. [The data model](./data-model.md) lists the kinds. <!-- id:3HfWQq4T -->

# See also <!-- id:z2W239gM -->

- [Kind](./kind.md): the nine value types. <!-- id:0w-qvAzT -->
- [The data model](./data-model.md): what each kind holds. <!-- id:wNC0Kqjp -->
- [Scalar schema](./scalar-schema.md): a kind narrowed by constraints. <!-- id:r3aQwmKh -->
- [Include schema](./include-schema.md): how naming a schema with `type` works. <!-- id:DxOBszkm -->
- [String](../string.md): one primitive's page. <!-- id:iZnYnlTZ -->
