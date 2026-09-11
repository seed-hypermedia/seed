---
name: "Example: Geo point"
summary: A latitude/longitude coordinate with an optional altitude.
schemaDefinition: ipfs://bafyreibkuuj2ayqbxno5jpmkudk3hesood5cx6jzfzm7cgb4vf35fkl4ku
---
This document describes the **example-geo** type — an example schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:mS5UKnHt -->

# Shape <!-- id:q-FnSm14 -->

A **closed struct** with these fields: <!-- id:R0FMLE19 -->
  - `lat` _(required)_ — [float](./hypermedia-float.md) <!-- id:5a0NrCBo -->
  - `lng` _(required)_ — [float](./hypermedia-float.md) <!-- id:k9oKIATS -->
  - `altitude` — [integer](./hypermedia-integer.md) <!-- id:-HE-U6Db -->

# Depends on <!-- id:7PVAW069 -->

- [float](./hypermedia-float.md) <!-- id:WAYPjFZV -->
- [integer](./hypermedia-integer.md) <!-- id:aL-GB7jv -->
