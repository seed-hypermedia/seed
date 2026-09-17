---
name: "Example: Geo Point"
summary: A latitude/longitude coordinate with an optional altitude.
schemaDefinition: ipfs://bafyreifbx3soi6px5xh4jdtkd3pqlglqe6uvpatnl6vkheedr7pv3bgkxq
---
This document describes the **example/geo** type — an example schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:mS5UKnHt -->

# Shape <!-- id:q-FnSm14 -->

A **closed struct** with these fields: <!-- id:R0FMLE19 -->
  - `lat` _(required)_: [float](../float.md) <!-- id:5a0NrCBo -->
  - `lng` _(required)_: [float](../float.md) <!-- id:k9oKIATS -->
  - `altitude`: [integer](../integer.md) <!-- id:-HE-U6Db -->

# Depends on <!-- id:7PVAW069 -->

- [float](../float.md) <!-- id:WAYPjFZV -->
- [integer](../integer.md) <!-- id:aL-GB7jv -->
