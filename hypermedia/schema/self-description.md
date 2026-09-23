---
name: Self-Description
summary: "The property that the meta-schema is a valid instance of itself: its union, include, and other variants each validate the schema that defines them."
---
**Self-description**: the [meta-schema](../schema.md) is a valid instance of itself. `schema` matches its own union variant ([`anyOf`](./anyof.md)). The items in its `anyOf` match its [include](./include-schema.md) variant, and the schemas those items name match the other variants. [The schema language](./schema-language.md) shows the check. <!-- id:Ext9Hcb0 -->

# See also <!-- id:vuJf3PdD -->

- [Variant](./variant.md): the members of the meta-schema union. <!-- id:wDyUk8li -->
- [Fixpoint problem](./fixpoint-problem.md): why that self-reference has to be a name. <!-- id:ua8lv1UD -->
- [References and naming](./references.md): why the meta-schema is the axiom of the system. <!-- id:q6W29OEF -->
