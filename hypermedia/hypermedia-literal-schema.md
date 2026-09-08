---
name: Literal schema
summary: The variant for a literal — a schema that accepts exactly one value, with a description of what that value means.
schemaDefinition: ipfs://bafyreieu4px6arlawybmsw4utelan5ob55xgvyzmyde5hbqhpapwwnbb7y
---
A literal schema accepts exactly one value. Most of the time it is written as the value itself — `"draft"`, `1`, `true`, `null` — and needs no variant at all: a bare string, integer, boolean, or null is a schema. This variant is the long form, `{value, description}`, for a literal that deserves an explanation, such as one choice among several in a union. <!-- id:1xTsRaHa -->

A fixed set of choices is a union of literals: `{"anyOf": ["draft", {"value": "published", "description": "Visible to everyone"}, "archived"]}`. The editors show such a union as a dropdown, with each description beside its option. A field pinned to one value — the `type` tag of every signed blob, the `key` of every RPC method — is simply that literal: `"type": {"value": "Change", "required": true}`. <!-- id:CvYPTOfS -->

A literal can only be a [value](./hypermedia-value.md): a string, an integer, a boolean, or null. A map literal would be indistinguishable from a schema, and a float compares badly. <!-- id:6Nz5fcWH -->

# Shape <!-- id:QwSwJe4s -->

A **closed struct** with these fields: <!-- id:UzbQr_7l -->
  - `value` _(required)_ — [value](./hypermedia-value.md) — The one value this schema accepts: a string, integer, boolean, or null. <!-- id:m35Nau7E -->
  - `description` — `string` — What this value means, for people and for the editors that offer it. <!-- id:Mg4EK18j -->

# Depends on <!-- id:hLYzugBc -->

- [value](./hypermedia-value.md) <!-- id:zhwCgPs9 -->
