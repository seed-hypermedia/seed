---
name: Variable Schema
summary: "A type-variable reference, written { \"var\": \"<name>\" }, that matches whatever a generic's parameter is bound to."
---
A var schema is a type variable inside a [generic](./generic.md). It matches whatever schema the generic's parameter is bound to. <!-- id:GaCjwOry -->

This document describes the **schema/var-schema** type, one [variant](./variant.md) of the [meta-schema](../schema.md). Its formal schema is attached as the `schemaDefinition` in this document's [metadata](../metadata.md), so the app can show it and create values of this type. [Typed documents](./typed-documents.md) explains how that works. <!-- id:V8YaGKHo -->

# See also <!-- id:lsmIzExr -->

- [Generic](./generic.md): `params`, `var` and `args` together. <!-- id:b2WWl50S -->
- [Change](../change.md): `Change<Block>` is the library's generic. <!-- id:IaCLUAV8 -->
- [The schema language](./schema-language.md): the full vocabulary. <!-- id:7wrpP5Ci -->
- [Variant](./variant.md): the members of the meta-schema union. <!-- id:InyyiDts -->
