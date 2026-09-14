---
name: "Example: Geo point"
summary: A latitude/longitude coordinate with an optional altitude.
schemaDefinition: ipfs://bafyreiccubrx57av4ytuknpdb56evn7s2fgdpu352ww7hdahjevbmyxnx4
---
This document describes the **example/geo** type — an example schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:mS5UKnHt -->

# Shape <!-- id:q-FnSm14 -->

A **closed struct** with these fields: <!-- id:R0FMLE19 -->
  - `lat` _(required)_ — [float](../schema/float.md) <!-- id:5a0NrCBo -->
  - `lng` _(required)_ — [float](../schema/float.md) <!-- id:k9oKIATS -->
  - `altitude` — [integer](../schema/integer.md) <!-- id:-HE-U6Db -->

# Depends on <!-- id:7PVAW069 -->

- [float](../schema/float.md) <!-- id:WAYPjFZV -->
- [integer](../schema/integer.md) <!-- id:aL-GB7jv -->
