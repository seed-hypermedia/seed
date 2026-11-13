---
name: "Example: Task Status"
summary: "The state of a task: todo, doing, or done."
---
The state of a task: a [union](../schema/anyof.md) of three [literals](../schema/literal-schema.md), `todo`, `doing` and `done`. [task-doc](./task-doc.md) uses it, and starts every new task as `todo`. <!-- id:59GjzNU0 -->

This page describes the **example/task-status** type, one of the [example schemas](../example.md). The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it and create values of this type. <!-- id:tS4mQw2a -->

# See also <!-- id:Yb7KcR1e -->

- [Literal schema](../schema/literal-schema.md): schemas that accept one value. <!-- id:Hd3PzN8u -->
- [task-doc](./task-doc.md): uses this type, with a default. <!-- id:Lq9VxJ5c -->
- [status](./status.md): another union of literals. <!-- id:Wg2TfM6o -->
- [Examples](../example.md): every example, grouped by feature. <!-- id:Rn8BsD4y -->
