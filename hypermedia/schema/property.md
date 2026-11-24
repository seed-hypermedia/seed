---
name: Property
summary: One field of a struct, holding its value schema, whether a value must include it, a description of what it is for, and the default a new value starts with.
---
A **property** is one field of a [struct](../struct.md). A [struct schema](./struct-schema.md) lists its fields under `properties`, one property per field name. A property wraps a [schema](../schema.md) and is not a schema itself. <!-- id:kLdsYe2_ -->

A property has four keys:

- `value` is the schema that the field's value must match.
- `required` says whether a value of the struct must include the field.
- `description` says what the field is for. The editors show it next to the field.
- `default` is the value a new struct starts with for the field.

For example, `"surname": {"value": {"type": "hm://hyper.media/string"}, "required": true}` is a required text field called `surname`.

This page defines the **schema/property** type. The type's formal schema is attached to this page as the `schemaDefinition` in its [metadata](../metadata.md).

```json <!-- id:xVOMLks1 -->
// a task: status starts as "todo", priority starts at 2, and due starts out absent
{ "type": "struct",
  "properties": {
    "status":   { "value": { "anyOf": ["todo", "doing", "done"] }, "required": true, "default": "todo" },
    "priority": { "value": { "type": "integer", "minimum": 1, "maximum": 3 }, "default": 2 },
    "due":      { "value": { "type": "date" } } } }
```

# Defaults <!-- id:V2fx8oaq -->

A default only initializes. When an editor creates a new value of the struct, it writes a copy of each default into that value. From then on the field is ordinary data: the author can change it or remove it, and what gets saved is the value itself. Nothing reads the schema later to fill a gap. <!-- id:CZJa96uS -->
  - **A default must match its property.** The default is checked against the property's own `value` schema. A string default on an integer field is an error in the schema, reported by the schema editor, `schema validate` and an [agent](../agent.md)'s `write`. The [meta-schema](../schema.md) cannot state this rule, because the type of `default` depends on the key beside it, so it is a separate check. <!-- id:bTD9MWth -->
  - **Existing values never change.** Adding a default to a schema, or changing one, changes no value that already exists. A [document](../protocol/documents.md) that lacks the field still lacks it. Editors do not fill it in when the document is opened, and [validation](./how-it-works.md) does not read the default. <!-- id:Knhkejlq -->
  - **Any value can be a default.** That includes `null`, `false`, `0`, an empty string and an empty list. A property with no `default` key has no default. <!-- id:-uhK4ejE -->

## Required and optional <!-- id:gBbqxVA7 -->

`required` is a rule about values: a value must include the field. `default` is a starting point for new values. They are separate, and each combination means one thing. <!-- id:5cKQ8Xqj -->

<!-- id:90BMkiXk -->
| property <!-- col:I_imqVO3 --> | a new value <!-- col:fRwEUxSe --> | a value without the field <!-- col:nhq3py_4 --> <!-- id:8gCc_nJq --> |
| --- | --- | --- |
| required, with a default | starts with the default | invalid: the field is missing <!-- id:f8O6i73j --> |
| required, no default | starts with an empty value of the field's kind, for the author to fill | invalid: the field is missing <!-- id:SuG4-ABb --> |
| optional, with a default | starts with the default, and the author may remove it | valid <!-- id:1W8Ab6aT --> |
| optional, no default | leaves the field out | valid <!-- id:ntOD7ggf --> |

A default does not make a required field optional. A value that lacks a required field is invalid whether or not the property has a default. <!-- id:2V_3Yl74 -->

## Structs, lists, links and unions <!-- id:kI4rivBj -->

  - **Nested structs.** A default on a struct-valued property is the whole nested value, used as written. It is not merged with the defaults of the nested struct's own properties, and it must be a valid value of that struct. A required struct property with no default is built from the nested struct's own properties, so their defaults apply there. <!-- id:EBH0gEMD -->
  - **Lists.** A default on a list property is the whole list. A list with no default starts empty. Each item added later starts from the item schema, so a list of structs gives every new item that struct's defaults. <!-- id:_iorhcR3 -->
  - **Links and references.** The default is the reference itself: a [link](../link.md) to a [CID](../cid.md), or an `hm://` or `ipfs://` URL string. It is copied into the new value like any other default. It is never fetched, and a `target` stays advisory. Every new value then points at the same thing, which suits a shared parent or a common template. <!-- id:kGy0oOLU -->
  - **Unions.** The default must match one of the union's variants. A union of [literals](./literal-schema.md) takes one of its members. <!-- id:ChnWlf7P -->
  - **Extension.** A default travels with its property. An [extension](./extension.md) inherits the parent's defaults. Restating a property replaces it whole: give it a new default to change the default, or leave `default` out to drop it. <!-- id:U10-xx9_ -->

## Where defaults apply <!-- id:gF9XH2Wo -->

Every surface starts a new value the same way. <!-- id:Q7nz9zfv -->
  - **In the [Seed app](../software/desktop.md)**, a new [typed document](./typed-documents.md) gets its defaults when its draft opens, and you see them as filled rows in the Attributes tab. A new object made from a schema, a new linked object, a new list item and a field you add to a struct all start from their defaults too. <!-- id:qfAJNVp8 -->
  - **With the [CLI](../build/cli.md)**, `document create` sets the defaults of the document's effective schema for every attribute you did not pass, and says which ones. `--no-defaults` turns that off. `document update` never applies defaults. <!-- id:7ztDL16F -->
  - **For an agent**, `write` of a new document does the same and returns the values it set as `defaultsApplied`. An update never applies defaults. <!-- id:94opYO37 -->
  - **In code**, `seedValue(schema)` from `@seed-hypermedia/client/schema-engine` returns the starting value, `propertyDefaults(schema)` returns only the declared defaults, and `validateDefaults(schema)` checks them. `newDocumentDefaults(client, id, metadata)` from `schema-resolve` returns what a new document should add. <!-- id:WSrmt1aN -->

The worked example is [task-doc](../example/task-doc.md). <!-- id:6aoOk4dD -->

# See also <!-- id:QjhOSVQr -->

- [Struct schema](./struct-schema.md): the variant that holds properties. <!-- id:XM4Yuuo- -->
- [Closed map](./closed-map.md): a struct rejects keys it has no property for. <!-- id:cIxFafFB -->
- [Extension](./extension.md): adds properties to a parent schema. <!-- id:9mvkwJHp -->
- [Typed documents](./typed-documents.md): how the editors turn properties into fields. <!-- id:UXu7sHvc -->
- [task-doc](../example/task-doc.md): an attributes schema with defaults. <!-- id:uzG55OV3 -->
