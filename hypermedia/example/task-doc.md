---
name: "Example: Task Document"
summary: "A document type for a task that shows property defaults: a new task starts as todo with priority 2, no tags and an unfinished checklist."
---
A [document type](../schema/typed-documents.md) for a task, built to show property [defaults](../schema/property.md). Create a [document](../protocol/documents.md) of this type and it starts with a `status` of `todo`, a `priority` of 2, an empty list of `tags` and a `checklist` that is not done. You can change or remove any of them, and what you publish is the value you left there. <!-- id:Zk5HwC3n -->

Each field shows one case: <!-- id:Pe1GyU7r -->
  - `status` is required and has a default, so a new task starts as `todo`. A task that lacks a status is still invalid. <!-- id:Mv6AdX2j -->
  - `priority` and `tags` are optional and have defaults, so a new task includes them and you may remove them. <!-- id:Jc4RnL9t -->
  - `checklist` is required and has no default of its own. A new task builds it from its own fields: `done` defaults to `false`, and `steps` starts as an empty list. <!-- id:Fx8SqK0b -->
  - `due` is optional and has no default, so a new task leaves it out. <!-- id:Bu3EoW7i -->

A task that already exists keeps the values it has. If this type later gains a default, or changes one, no published task changes. <!-- id:Oy2NhV6m -->

This page describes the **example/task-doc** type, one of the [example schemas](../example.md). The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it and create values of this type. <!-- id:Ta9LpI4s -->

# See also <!-- id:Xr7CjZ1g -->

- [Property](../schema/property.md): what a default means for required and optional fields, nested [structs](../struct.md), lists and links. <!-- id:Dn5FmQ8k -->
- [Typed documents](../schema/typed-documents.md): `attributesSchema` and `childAttributesSchema`. <!-- id:Vh0WtB3e -->
- [task-status](./task-status.md): the status union. <!-- id:Ei6YuG2p -->
- [person-doc](./person-doc.md): a document type without defaults. <!-- id:Sq4KzA9d -->
- [Examples](../example.md): every example, grouped by feature. <!-- id:Ng1OxR5w -->
