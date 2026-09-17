---
name: "Example: Registry"
summary: "A map from ids to person links: Map<Link<Person>>."
schemaDefinition: ipfs://bafyreib3njsnmqlbllaiphcvhke4zqxme6gzl75afztprvbrggbdltee5q
---
An open [map](../map.md) whose values are typed [links](../link.md) to [person](./person.md): `Map<Link<person>>`.

This page describes the **example/registry** type, one of the [example schemas](../example.md). The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it and create values of this type. <!-- id:cW-WMC_r -->

# Shape <!-- id:7KOpTiq_ -->

An **open map**. Every value: `link` → [example/person](./person.md). <!-- id:b5qLt404 -->

# Depends on <!-- id:IUK3dNSa -->

- [example/person](./person.md) <!-- id:N37AJThA -->

# See also

- [counts](./counts.md): a map of integers.
- [Link](../link.md): typed links.
- [person](./person.md): the link target.
- [Examples](../example.md): every example, grouped by feature.
