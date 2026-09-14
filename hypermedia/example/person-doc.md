---
name: "Example: Person Document"
summary: "A document that describes a person: an attributes schema requiring a `surname`, with an optional `givenName`. A page whose `attributesSchema` names th"
schemaDefinition: ipfs://bafyreib37phzmkr5gyqeng37keyfcqnpg2nqyimmgkvte42zj5a7ae5w2m
---
A document that describes a person: an attributes schema requiring a `surname`, with an optional `givenName`. A page whose `attributesSchema` names this document must carry a surname; a folder whose `childAttributesSchema` names it types every page beneath it. <!-- id:axdEuJ33 -->

This document describes the **example/person-doc** type — an example schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:WdsUDf3r -->

# Shape <!-- id:bStR0Oxc -->

A **closed struct** with these fields: <!-- id:Zw6v2bIk -->
  - `surname` _(required)_ — [string](../string.md) <!-- id:6xa2fWed -->
  - `givenName` — [string](../string.md) <!-- id:D_qvqihl -->

# Depends on <!-- id:ZbLY5eTj -->

- [string](../string.md) <!-- id:HGDaIkqh -->
