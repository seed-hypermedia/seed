---
name: "Example: Geo Point"
summary: "A latitude and longitude coordinate with an optional altitude."
schemaDefinition: ipfs://bafyreifbx3soi6px5xh4jdtkd3pqlglqe6uvpatnl6vkheedr7pv3bgkxq
---
A coordinate: [float](../float.md) `lat` and `lng`, and an optional [integer](../integer.md) `altitude`. A [place](./place-doc.md) links to one for its coordinates.

This page describes the **example/geo** type, one of the [example schemas](../example.md). The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it and create values of this type. <!-- id:mS5UKnHt -->

# Shape <!-- id:q-FnSm14 -->

A **closed struct** with these fields: <!-- id:R0FMLE19 -->
  - `lat` _(required)_: [float](../float.md) <!-- id:5a0NrCBo -->
  - `lng` _(required)_: [float](../float.md) <!-- id:k9oKIATS -->
  - `altitude`: [integer](../integer.md) <!-- id:-HE-U6Db -->

# Depends on <!-- id:7PVAW069 -->

- [float](../float.md) <!-- id:WAYPjFZV -->
- [integer](../integer.md) <!-- id:aL-GB7jv -->

# See also

- [place-doc](./place-doc.md): links to a geo point.
- [address](./address.md): another small struct.
- [Float](../float.md): the float type.
- [Examples](../example.md): every example, grouped by feature.
