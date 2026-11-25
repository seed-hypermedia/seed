---
name: Self-Description
summary: Self-description means that the meta-schema, the schema that describes all schemas, also describes itself correctly.
---
**Self-description** means that the [meta-schema](../schema.md) describes itself. The meta-schema is the schema that says what a valid schema looks like. It is a schema too, so it must pass its own check, and it does. <!-- id:Ext9Hcb0 -->

The check goes in three steps:

- The meta-schema is a union, so it matches its own union variant ([`anyOf`](./anyof.md)).
- Each item in its `anyOf` names another schema, so each item matches its [include](./include-schema.md) variant.
- The schemas those items name match the other [variants](./variant.md).

[The schema language](./schema-language.md) shows the check.

# See also <!-- id:vuJf3PdD -->

- [Variant](./variant.md): the members of the meta-schema union. <!-- id:wDyUk8li -->
- [Fixpoint problem](./fixpoint-problem.md): why that self-reference has to be a name. <!-- id:ua8lv1UD -->
- [References and naming](./references.md): why the meta-schema is the axiom of the system. <!-- id:q6W29OEF -->
