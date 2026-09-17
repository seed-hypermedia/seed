---
name: "Example: Person Document"
summary: "A document type for a person: an attributes schema requiring a surname with an optional given name, bound per page or to every child of a folder."
schemaDefinition: ipfs://bafyreid3u27vuo2wr5aqmb6ozb6vnoxd7hcxg4r7pd47wdcbtoo35hubgu
---
A [document type](../schema/typed-documents.md) for a person: an attributes schema that requires a `surname` and allows an optional `givenName`. A page whose `attributesSchema` names this document must carry a surname. A folder whose `childAttributesSchema` names it types every page beneath it. <!-- id:axdEuJ33 -->

This page describes the **example/person-doc** type, one of the [example schemas](../example.md). The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it and create values of this type. <!-- id:WdsUDf3r -->

# Shape <!-- id:bStR0Oxc -->

A **closed struct** with these fields: <!-- id:Zw6v2bIk -->
  - `surname` _(required)_: [string](../string.md) <!-- id:6xa2fWed -->
  - `givenName`: [string](../string.md) <!-- id:D_qvqihl -->

# Depends on <!-- id:ZbLY5eTj -->

- [string](../string.md) <!-- id:HGDaIkqh -->

# See also <!-- id:3tReXDbH -->

- [Typed documents](../schema/typed-documents.md): `attributesSchema` and `childAttributesSchema`. <!-- id:V7vVd2h3 -->
- [person](./person.md): the struct version of a person. <!-- id:WZ2zUfVK -->
- [World Builder](../schema/world-builder.md): more document types. <!-- id:1RhiROnN -->
- [Examples](../example.md): every example, grouped by feature. <!-- id:4W3fXN2o -->
